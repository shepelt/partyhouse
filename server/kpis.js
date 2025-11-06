import { Meteor } from 'meteor/meteor';
import { getProvider, getBlock } from './blockchain.js';
import {
  DailyTransactionsCollection,
  WeeklyActiveAddressesCollection,
  AddressActivityCollection,
  TvlCollection,
  BridgeActivityCollection
} from '../imports/api/collections.js';

// Cache ETH price for 5 minutes to avoid rate limiting
let ethPriceCache = { price: null, timestamp: 0 };
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Blockscout API base URL
const BLOCKSCOUT_API = 'https://sepolia-explorer.hpp.io/api/v2';

/**
 * Get active network configuration
 */
function getActiveNetworkConfig() {
  const hppSettings = Meteor.settings.hpp;
  if (!hppSettings) {
    throw new Error('HPP configuration not found in settings');
  }

  const activeNetwork = hppSettings.activeNetwork || 'sepolia';
  const config = hppSettings.networks?.[activeNetwork];

  if (!config) {
    throw new Error(`Network configuration for '${activeNetwork}' not found in settings`);
  }

  return config;
}

/**
 * Get current ETH price in USD from CoinGecko
 * Uses 5-minute cache to avoid rate limiting
 */
export async function getEthPrice() {
  try {
    const now = Date.now();

    // Return cached price if still valid
    if (ethPriceCache.price && (now - ethPriceCache.timestamp) < PRICE_CACHE_TTL) {
      return ethPriceCache.price;
    }

    // Fetch new price from CoinGecko (free API, no key needed)
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json();
    const price = data.ethereum?.usd;

    if (!price) {
      throw new Error('ETH price not found in response');
    }

    // Update cache
    ethPriceCache = { price, timestamp: now };

    return price;
  } catch (error) {
    console.error('Error fetching ETH price:', error.message);

    // Return cached price if available, even if expired
    if (ethPriceCache.price) {
      console.log('Using stale cached ETH price');
      return ethPriceCache.price;
    }

    // Fallback to a reasonable default if no cache available
    return 3000; // Rough ETH price estimate as fallback
  }
}

/**
 * Fetch deposit amount from internal transactions for a Type 105 transaction
 * Returns the value from the first internal transfer from 0x0000...0000
 */
async function fetchDepositAmount(txHash) {
  try {
    const url = `${BLOCKSCOUT_API}/transactions/${txHash}/internal-transactions`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Failed to fetch internal txs for ${txHash}: ${response.status}`);
      return 0;
    }

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      return 0;
    }

    // Find the first internal transfer from 0x0000...0000 (canonical deposit amount)
    const depositTransfer = data.items.find(tx =>
      tx.from.hash === '0x0000000000000000000000000000000000000000'
    );

    if (depositTransfer && depositTransfer.value) {
      // Convert from wei string to ETH number
      const valueInWei = BigInt(depositTransfer.value);
      const valueInEth = Number(valueInWei) / 1e18;
      return valueInEth;
    }

    return 0;
  } catch (error) {
    console.error(`Error fetching internal txs for ${txHash}:`, error.message);
    return 0;
  }
}

/**
 * Calculate daily transactions from stored activity data
 * Counts transactions recorded in AddressActivityCollection for today
 */
export async function calculateDailyTransactions() {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count all address activities (transactions) for today
    const count = await AddressActivityCollection.find({
      timestamp: { $gte: today, $lt: tomorrow }
    }).countAsync();

    console.log(`✅ Daily transactions: ${count}`);
    return { count };
  } catch (error) {
    console.error('Error calculating daily transactions:', error.message);
    return { count: 0 };
  }
}

/**
 * Get or create daily transactions record for today
 * Fast version - calculates from existing activity data
 */
export async function getTodayTransactions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    // Calculate current count from existing collection data
    const stats = await calculateDailyTransactions();

    // Store snapshot in database (historical time series)
    await DailyTransactionsCollection.insertAsync({
      date: today,
      count: stats.count,
      timestamp: new Date(),
      updatedAt: new Date()
    });

    return {
      date: today,
      count: stats.count,
      updatedAt: new Date()
    };
  } catch (error) {
    console.error('Error getting daily transactions:', error.message);

    // Fallback to most recent cached data for today if calculation fails
    const record = await DailyTransactionsCollection.findOneAsync(
      { date: today },
      { sort: { timestamp: -1 } }
    );
    if (record) {
      return record;
    }

    // Return zero if no cached data
    return {
      date: today,
      count: 0,
      updatedAt: new Date()
    };
  }
}

/**
 * Update daily transaction count from blockchain data
 * Just calls getTodayTransactions() to recalculate and store
 */
export async function updateDailyTransactionCount() {
  try {
    const result = await getTodayTransactions();
    console.log(`📊 Updated daily transactions: ${result.count}`);
    return result.count;
  } catch (error) {
    console.error('Error updating daily transaction count:', error.message);
    return 0;
  }
}

// System addresses to exclude from KPI calculations (ArbOS, null address, etc.)
// Note: We record all addresses in the database, but filter them out during aggregation queries
const SYSTEM_ADDRESSES = [
  '0x0000000000000000000000000000000000000000', // Null address
  '0x0000000000000000000000000000000000000001', // ArbOS precompile
  '0x0000000000000000000000000000000000000002', // ArbRetryableTx precompile (old)
  '0x0000000000000000000000000000000000000064', // ArbRetryableTx precompile
  '0x0000000000000000000000000000000000000065', // ArbGasInfo precompile
  '0x0000000000000000000000000000000000000066', // ArbAddressTable precompile
  '0x0000000000000000000000000000000000000067', // ArbStatistics precompile
  '0x0000000000000000000000000000000000000068', // ArbOwner precompile
  '0x000000000000000000000000000000000000006b', // ArbAggregator precompile
  '0x000000000000000000000000000000000000006c', // ArbFunctionTable precompile
  '0x000000000000000000000000000000000000006d', // ArbosTest precompile
  '0x000000000000000000000000000000000000006e', // ArbSys precompile
  '0x000000000000000000000000000000000000006f', // ArbInfo precompile
  '0x0000000000000000000000000000000000000070', // ArbOwnerPublic precompile
  '0x0000000000000000000000000000000000000071', // ArbDebug precompile
  '0x0000000000000000000000000000000000000072', // ArbWasm precompile
  '0x0000000000000000000000000000000000000073', // ArbWasmCache precompile
  '0x00000000000000000000000000000000000a4b05', // NodeInterface precompile
];

/**
 * Process new blocks incrementally and store address activity
 * Returns: number of new blocks processed
 */
export async function processNewBlocks() {
  try {
    const provider = getProvider();
    const currentBlock = await provider.getBlockNumber();

    // Get last processed block from collection
    const lastActivity = await AddressActivityCollection.findOneAsync(
      {},
      { sort: { blockNumber: -1 }, limit: 1 }
    );

    const startBlock = lastActivity ? lastActivity.blockNumber + 1 : Math.max(0, currentBlock - 100);

    if (startBlock > currentBlock) {
      console.log('Already up to date at block', currentBlock);
      return 0;
    }

    console.log(`Processing blocks ${startBlock} to ${currentBlock}...`);

    let addressesAdded = 0;
    for (let i = startBlock; i <= currentBlock; i++) {
      const block = await getBlock(i);

      if (block && block.transactions) {
        const blockTimestamp = block.timestamp ? new Date(block.timestamp * 1000) : new Date();

        for (const txHash of block.transactions) {
          try {
            const tx = await provider.getTransaction(txHash);
            if (tx && tx.from) {
              // Insert address activity record (record everything)
              await AddressActivityCollection.insertAsync({
                address: tx.from.toLowerCase(),
                timestamp: blockTimestamp,
                blockNumber: i
              });
              addressesAdded++;

              // Detect bridge deposits (L1→L2)
              // Arbitrum Orbit uses type 105 for L1→L2 deposits
              if (tx.type === 105) {
                // For deposit transactions, fetch the actual value from internal transactions
                try {
                  const receipt = await provider.getTransactionReceipt(txHash);

                  // Fetch deposit amount from internal transactions
                  const depositAmount = await fetchDepositAmount(txHash);

                  await BridgeActivityCollection.insertAsync({
                    txHash: txHash,
                    type: 'deposit',
                    from: tx.from.toLowerCase(),
                    to: tx.to ? tx.to.toLowerCase() : null,
                    value: depositAmount, // Fetched from internal transactions
                    timestamp: blockTimestamp,
                    blockNumber: i,
                    l2TxHash: txHash
                  });

                  depositsDetected++;
                } catch (receiptError) {
                  // Continue even if receipt fetch fails
                }
              }

              // Detect withdrawals (L2→L1)
              // Withdrawals call the ArbSys precompile
              const ARBSYS_ADDRESS = '0x0000000000000000000000000000000000000064';
              if (tx.to && tx.to.toLowerCase() === ARBSYS_ADDRESS && tx.value && Number(tx.value) > 0) {
                await BridgeActivityCollection.insertAsync({
                  txHash: txHash,
                  type: 'withdrawal',
                  from: tx.from.toLowerCase(),
                  to: ARBSYS_ADDRESS,
                  value: Number(tx.value) / 1e18, // Convert to ETH
                  timestamp: blockTimestamp,
                  blockNumber: i,
                  l2TxHash: txHash
                });
              }
            }
          } catch (txError) {
            continue;
          }
        }
      }

      if ((i - startBlock + 1) % 100 === 0) {
        console.log(`  Processed ${i - startBlock + 1} blocks...`);
      }
    }

    console.log(`✅ Processed ${currentBlock - startBlock + 1} new blocks, added ${addressesAdded} address activities`);
    return currentBlock - startBlock + 1;
  } catch (error) {
    console.error('Error processing new blocks:', error.message);
    return 0;
  }
}

/**
 * Calculate weekly active addresses from stored activity data
 * Simply counts unique addresses in last 7 days
 * Returns: { count }
 */
export async function calculateWeeklyActiveAddresses() {
  try {
    // Query for addresses active in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Use MongoDB aggregation to count distinct addresses (excluding system addresses)
    const pipeline = [
      { $match: {
          timestamp: { $gte: sevenDaysAgo },
          address: { $nin: SYSTEM_ADDRESSES }
        }
      },
      { $group: { _id: '$address' } },
      { $count: 'uniqueAddresses' }
    ];

    const result = await AddressActivityCollection.rawCollection().aggregate(pipeline).toArray();
    const count = result.length > 0 ? result[0].uniqueAddresses : 0;

    console.log(`✅ Weekly active addresses: ${count}`);

    return { count };
  } catch (error) {
    console.error('Error calculating weekly active addresses:', error.message);
    return { count: 0 };
  }
}

/**
 * Get detailed list of weekly active addresses with activity stats
 * Returns: Array of { address, txCount, firstSeen, lastSeen }
 */
export async function getWeeklyActiveAddressDetails() {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Aggregate address activity with stats (excluding system addresses)
    const pipeline = [
      { $match: {
          timestamp: { $gte: sevenDaysAgo },
          address: { $nin: SYSTEM_ADDRESSES }
        }
      },
      {
        $group: {
          _id: '$address',
          txCount: { $sum: 1 },
          firstSeen: { $min: '$timestamp' },
          lastSeen: { $max: '$timestamp' }
        }
      },
      {
        $project: {
          _id: 0,
          address: '$_id',
          txCount: 1,
          firstSeen: 1,
          lastSeen: 1
        }
      },
      { $sort: { txCount: -1 } }
    ];

    const addresses = await AddressActivityCollection.rawCollection().aggregate(pipeline).toArray();
    return addresses;
  } catch (error) {
    console.error('Error getting address details:', error.message);
    return [];
  }
}

/**
 * Get or update weekly active addresses record
 * Fast version - just returns cached data and calculates from existing records
 */
export async function getWeeklyActiveAddresses() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    // Calculate current count from existing collection data
    const stats = await calculateWeeklyActiveAddresses();

    // Store snapshot in database (historical time series)
    const record = {
      date: today,
      count: stats.count,
      timestamp: new Date(),
      updatedAt: new Date()
    };

    await WeeklyActiveAddressesCollection.insertAsync(record);

    return record;
  } catch (error) {
    console.error('Error getting weekly active addresses:', error.message);

    // Fallback to most recent cached data
    const record = await WeeklyActiveAddressesCollection.findOneAsync(
      {},
      { sort: { timestamp: -1 } }
    );

    if (record) {
      return record;
    }

    return {
      date: today,
      count: 0,
      updatedAt: new Date()
    };
  }
}

/**
 * Update weekly active addresses by processing new blocks
 * This is the slow version that should be called by background jobs only
 */
export async function updateWeeklyActiveAddresses() {
  try {
    // Process any new blocks first
    await processNewBlocks();

    // Then get the updated count
    return await getWeeklyActiveAddresses();
  } catch (error) {
    console.error('Error updating weekly active addresses:', error.message);
    return await getWeeklyActiveAddresses(); // Return cached data on error
  }
}

/**
 * Get Total Value Locked (TVL) from cached data
 * Fast version - just returns latest snapshot from database
 */
export async function getTVL() {
  try {
    // Get latest TVL snapshot from database
    const record = await TvlCollection.findOneAsync(
      {},
      { sort: { timestamp: -1 } }
    );

    if (record) {
      return {
        tvlInETH: record.tvlInETH,
        tvlInUSD: record.tvlInUSD,
        updatedAt: record.updatedAt
      };
    }

    // Return zero if no cached data
    return {
      tvlInETH: 0,
      tvlInUSD: null,
      updatedAt: new Date()
    };
  } catch (error) {
    console.error('Error getting TVL:', error.message);
    return {
      tvlInETH: 0,
      tvlInUSD: null,
      updatedAt: new Date()
    };
  }
}

/**
 * Update Total Value Locked (TVL) by querying L1 bridge
 * Slow version - queries L1 bridge contract (should be called by background jobs only)
 */
export async function updateTVL() {
  try {
    const { ethers } = await import('ethers');

    // Get L1 configuration from active network
    const networkConfig = getActiveNetworkConfig();
    const l1Config = networkConfig.l1;
    if (!l1Config || !l1Config.bridgeContract || !l1Config.rpcEndpoint) {
      console.error('L1 configuration missing in settings');
      return await getTVL(); // Return cached data on error
    }

    // Connect to L1 (Sepolia) - ethers v5 syntax
    const l1Provider = new ethers.providers.JsonRpcProvider(l1Config.rpcEndpoint);

    // Query ETH balance of bridge contract on L1
    const bridgeBalance = await l1Provider.getBalance(l1Config.bridgeContract);

    // Convert from wei to ETH
    const tvlInETH = Number(bridgeBalance) / 1e18;

    // Get current ETH price and calculate USD value
    const ethPrice = await getEthPrice();
    const tvlInUSD = tvlInETH * ethPrice;

    console.log(`✅ Bridge TVL: ${tvlInETH.toFixed(4)} ETH ($${tvlInUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}) (locked in L1 bridge)`);

    // Store snapshot in database
    await TvlCollection.insertAsync({
      timestamp: new Date(),
      tvlInETH,
      tvlInUSD,
      updatedAt: new Date()
    });

    return {
      tvlInETH,
      tvlInUSD,
      updatedAt: new Date()
    };
  } catch (error) {
    console.error('Error updating TVL:', error.message);
    return await getTVL(); // Return cached data on error
  }
}

/**
 * @deprecated Use getTVL() for fast cached data or updateTVL() for background updates
 */
export async function calculateTVL() {
  return await getTVL();
}

/**
 * Calculate bridge activity from actual bridge transactions
 * Returns: { deposits, withdrawals, netFlow, totalActivity }
 */
export async function calculateBridgeActivityFromTransactions() {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Get deposits in last 24h
    const deposits = await BridgeActivityCollection.find({
      type: 'deposit',
      timestamp: { $gte: twentyFourHoursAgo }
    }).fetchAsync();

    // Get withdrawals in last 24h
    const withdrawals = await BridgeActivityCollection.find({
      type: 'withdrawal',
      timestamp: { $gte: twentyFourHoursAgo }
    }).fetchAsync();

    const totalDeposits = deposits.reduce((sum, d) => sum + d.value, 0);
    const totalWithdrawals = withdrawals.reduce((sum, w) => sum + w.value, 0);
    const netFlow = totalDeposits - totalWithdrawals;
    const totalActivity = totalDeposits + totalWithdrawals;

    console.log(`✅ Bridge activity (24h): ${deposits.length} deposits (${totalDeposits.toFixed(4)} ETH), ${withdrawals.length} withdrawals (${totalWithdrawals.toFixed(4)} ETH)`);

    return {
      deposits: totalDeposits,
      withdrawals: totalWithdrawals,
      netFlow,
      totalActivity,
      depositCount: deposits.length,
      withdrawalCount: withdrawals.length
    };
  } catch (error) {
    console.error('Error calculating bridge activity from transactions:', error.message);
    return {
      deposits: 0,
      withdrawals: 0,
      netFlow: 0,
      totalActivity: 0,
      depositCount: 0,
      withdrawalCount: 0
    };
  }
}

/**
 * Calculate 24h bridge volume in USD
 * Returns total value flowing through the bridge (deposits + withdrawals)
 */
export async function calculateBridgeVolume() {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Get withdrawals in last 24h (these have actual ETH values)
    const withdrawals = await BridgeActivityCollection.find({
      type: 'withdrawal',
      timestamp: { $gte: twentyFourHoursAgo }
    }).fetchAsync();

    // Get deposits in last 24h (now includes actual ETH values from internal txs)
    const deposits = await BridgeActivityCollection.find({
      type: 'deposit',
      timestamp: { $gte: twentyFourHoursAgo }
    }).fetchAsync();

    // Calculate total withdrawal value in ETH
    const totalWithdrawalsETH = withdrawals.reduce((sum, w) => sum + w.value, 0);

    // Calculate total deposit value in ETH
    const totalDepositsETH = deposits.reduce((sum, d) => sum + d.value, 0);

    // Get ETH price for USD conversion
    const ethPrice = await getEthPrice();

    // Total volume is deposits + withdrawals
    const totalVolumeETH = totalDepositsETH + totalWithdrawalsETH;
    const volumeUSD = totalVolumeETH * ethPrice;

    console.log(`✅ Bridge volume (24h): ${deposits.length} deposits (${totalDepositsETH.toFixed(4)} ETH), ${withdrawals.length} withdrawals (${totalWithdrawalsETH.toFixed(4)} ETH) = $${volumeUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

    return {
      depositCount: deposits.length,
      withdrawalCount: withdrawals.length,
      depositsETH: totalDepositsETH,
      withdrawalsETH: totalWithdrawalsETH,
      totalVolumeETH,
      volumeUSD,
      ethPrice
    };
  } catch (error) {
    console.error('Error calculating bridge volume:', error.message);
    return {
      depositCount: 0,
      withdrawalCount: 0,
      withdrawalsETH: 0,
      volumeUSD: 0,
      ethPrice: 0
    };
  }
}

/**
 * Calculate bridge activity (deposits + withdrawals) in last 24 hours
 * Based on TVL snapshots - positive change = net deposits, negative = net withdrawals
 * Returns: { deposits, withdrawals, netFlow }
 * @deprecated Use calculateBridgeActivityFromTransactions() for real transaction data
 */
export async function calculateBridgeActivity() {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Get current TVL
    const currentSnapshot = await TvlCollection.findOneAsync(
      {},
      { sort: { timestamp: -1 }, limit: 1 }
    );

    // Get TVL from 24h ago (closest snapshot)
    const oldSnapshot = await TvlCollection.findOneAsync(
      { timestamp: { $lte: twentyFourHoursAgo } },
      { sort: { timestamp: -1 }, limit: 1 }
    );

    if (!currentSnapshot || !oldSnapshot) {
      console.log('⚠️  Not enough TVL data for bridge activity calculation');
      return {
        deposits: 0,
        withdrawals: 0,
        netFlow: 0,
        totalActivity: 0
      };
    }

    const netFlow = currentSnapshot.tvlInETH - oldSnapshot.tvlInETH;

    // Net flow tells us deposits minus withdrawals
    // For simplicity, show absolute net flow as "activity"
    const totalActivity = Math.abs(netFlow);

    console.log(`✅ Bridge activity (24h): ${totalActivity.toFixed(4)} ETH net flow`);

    return {
      deposits: netFlow > 0 ? netFlow : 0,
      withdrawals: netFlow < 0 ? Math.abs(netFlow) : 0,
      netFlow,
      totalActivity
    };
  } catch (error) {
    console.error('Error calculating bridge activity:', error.message);
    return {
      deposits: 0,
      withdrawals: 0,
      netFlow: 0,
      totalActivity: 0
    };
  }
}

/**
 * Get historical daily transaction data for charts
 * Returns last N days (one snapshot per day)
 */
export async function getDailyTransactionsHistory(days = 7) {
  try {
    // Use aggregation to get the latest snapshot for each unique date
    const pipeline = [
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$date',
          count: { $first: '$count' },
          timestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: days },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1,
          timestamp: 1
        }
      }
    ];

    const records = await DailyTransactionsCollection.rawCollection().aggregate(pipeline).toArray();

    return records.map(r => ({
      date: r.date,
      count: r.count,
      timestamp: r.timestamp
    }));
  } catch (error) {
    console.error('Error fetching transaction history:', error.message);
    return [];
  }
}

/**
 * Get historical weekly active addresses data for charts
 * Returns last N days (one snapshot per day)
 */
export async function getWeeklyActiveAddressesHistory(days = 7) {
  try {
    // Use aggregation to get the latest snapshot for each unique date
    const pipeline = [
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$date',
          count: { $first: '$count' },
          timestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: days },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1,
          timestamp: 1
        }
      }
    ];

    const records = await WeeklyActiveAddressesCollection.rawCollection().aggregate(pipeline).toArray();

    return records.map(r => ({
      date: r.date,
      count: r.count,
      timestamp: r.timestamp
    }));
  } catch (error) {
    console.error('Error fetching address history:', error.message);
    return [];
  }
}

/**
 * Backfill historical snapshots for daily transactions
 * Creates snapshots for the last N days based on existing transaction data
 */
export async function backfillDailyTransactionHistory(days = 7) {
  try {
    const now = new Date();
    let snapshotsCreated = 0;

    // Create snapshots for each of the last N days
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);

      // Count transactions for this day from AddressActivityCollection
      const count = await AddressActivityCollection.find({
        timestamp: { $gte: date, $lt: nextDay }
      }).countAsync();

      // Store snapshot
      await DailyTransactionsCollection.insertAsync({
        date: date,
        count: count,
        timestamp: new Date(date.getTime() + 12 * 60 * 60 * 1000), // Noon of that day
        updatedAt: new Date()
      });

      snapshotsCreated++;
      console.log(`  Created snapshot for ${date.toDateString()}: ${count} transactions`);
    }

    console.log(`✅ Backfilled ${snapshotsCreated} daily transaction snapshots`);
    return snapshotsCreated;
  } catch (error) {
    console.error('Error backfilling daily transaction history:', error.message);
    return 0;
  }
}

/**
 * Backfill historical snapshots for weekly active addresses
 * Creates snapshots for the last N days based on existing address activity data
 */
export async function backfillWeeklyActiveAddressHistory(days = 7) {
  try {
    const now = new Date();
    let snapshotsCreated = 0;

    // Create snapshots for each of the last N days
    for (let i = 0; i < days; i++) {
      const snapshotDate = new Date(now);
      snapshotDate.setDate(snapshotDate.getDate() - i);
      snapshotDate.setHours(0, 0, 0, 0);

      // Calculate 7 days before this snapshot date
      const sevenDaysBefore = new Date(snapshotDate);
      sevenDaysBefore.setDate(sevenDaysBefore.getDate() - 7);

      // End of snapshot day (so we include the full day)
      const snapshotEndOfDay = new Date(snapshotDate);
      snapshotEndOfDay.setDate(snapshotEndOfDay.getDate() + 1);

      // Count unique addresses in the 7-day window (up to and including snapshot date)
      const pipeline = [
        {
          $match: {
            timestamp: { $gte: sevenDaysBefore, $lt: snapshotEndOfDay },
            address: { $nin: SYSTEM_ADDRESSES }
          }
        },
        { $group: { _id: '$address' } },
        { $count: 'uniqueAddresses' }
      ];

      const result = await AddressActivityCollection.rawCollection().aggregate(pipeline).toArray();
      const count = result.length > 0 ? result[0].uniqueAddresses : 0;

      // Store snapshot
      await WeeklyActiveAddressesCollection.insertAsync({
        date: snapshotDate,
        count: count,
        timestamp: new Date(snapshotDate.getTime() + 12 * 60 * 60 * 1000), // Noon of that day
        updatedAt: new Date()
      });

      snapshotsCreated++;
      console.log(`  Created snapshot for ${snapshotDate.toDateString()}: ${count} active addresses`);
    }

    console.log(`✅ Backfilled ${snapshotsCreated} weekly active address snapshots`);
    return snapshotsCreated;
  } catch (error) {
    console.error('Error backfilling weekly active address history:', error.message);
    return 0;
  }
}

/**
 * Backfill historical TVL snapshots using current value
 * Since we can't query historical bridge balances, we use the current TVL for all past days
 */
export async function backfillTvlHistory(days = 7) {
  try {
    // Get current TVL
    const currentTvl = await getTVL();
    if (!currentTvl || currentTvl.tvlInETH === 0) {
      console.log('⚠️  No current TVL data to backfill');
      return 0;
    }

    const now = new Date();
    let snapshotsCreated = 0;

    // Create snapshots for each of the last N days using current TVL value
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(12, 0, 0, 0); // Noon

      // Store snapshot with current TVL value
      await TvlCollection.insertAsync({
        timestamp: date,
        tvlInETH: currentTvl.tvlInETH,
        tvlInUSD: currentTvl.tvlInUSD,
        updatedAt: new Date()
      });

      snapshotsCreated++;
      console.log(`  Created TVL snapshot for ${date.toDateString()}: ${currentTvl.tvlInETH.toFixed(4)} ETH`);
    }

    console.log(`✅ Backfilled ${snapshotsCreated} TVL snapshots (using current value)`);
    return snapshotsCreated;
  } catch (error) {
    console.error('Error backfilling TVL history:', error.message);
    return 0;
  }
}

/**
 * Backfill all KPI data by scanning historical blocks
 * Scans blocks for:
 * - Address activity (for weekly active addresses)
 * - Bridge deposits (type 105 transactions)
 * - Bridge withdrawals (ArbSys precompile calls)
 *
 * Respects settings.hpp.backfill.bridgeActivity configuration:
 * - blockCount: -1 = scan from genesis, 0 = skip backfill, >0 = scan last N blocks
 */
export async function backfillBridgeActivity() {
  try {
    // Check if backfill is enabled
    const backfillConfig = Meteor.settings.hpp?.backfill?.bridgeActivity;
    if (!backfillConfig?.enabled) {
      console.log('⚠️  KPI backfill is disabled in settings');
      return { addressesAdded: 0, depositsFound: 0, withdrawalsFound: 0, blocksScanned: 0 };
    }

    const blockCount = backfillConfig.blockCount || 0;
    if (blockCount === 0) {
      console.log('⚠️  KPI backfill blockCount is 0 (skipping)');
      return { addressesAdded: 0, depositsFound: 0, withdrawalsFound: 0, blocksScanned: 0 };
    }

    const provider = getProvider();
    const ARBSYS_ADDRESS = '0x0000000000000000000000000000000000000064';

    // Determine start and end blocks
    let startBlock;
    let endBlock;

    if (blockCount === -1) {
      // Scan from genesis (or resume from last processed block)
      endBlock = await provider.getBlockNumber();

      // Check if we have any existing address activity data
      const lastProcessed = await AddressActivityCollection.findOneAsync(
        {},
        { sort: { blockNumber: -1 }, limit: 1 }
      );

      if (lastProcessed && lastProcessed.blockNumber > 1) {
        startBlock = lastProcessed.blockNumber + 1;
        console.log(`📍 Resuming backfill from block ${startBlock} to ${endBlock}...`);
        console.log(`   (Previously processed up to block ${lastProcessed.blockNumber})`);
      } else {
        startBlock = 1;
        console.log(`🔍 Backfilling all KPIs from genesis (block 1) to current block ${endBlock}...`);
      }
    } else {
      // Scan last N blocks (always fresh scan, no resume)
      endBlock = await provider.getBlockNumber();
      startBlock = Math.max(1, endBlock - blockCount + 1);
      console.log(`🔍 Backfilling all KPIs for last ${blockCount} blocks (${startBlock} to ${endBlock})...`);
    }

    const totalBlocks = endBlock - startBlock + 1;

    let addressesAdded = 0;
    let depositsFound = 0;
    let withdrawalsFound = 0;

    // Scan blocks and collect ALL KPI data in a single pass
    for (let i = startBlock; i <= endBlock; i++) {
      try {
        const block = await provider.getBlock(i);

        if (block && block.transactions && block.transactions.length > 0) {
          const blockTimestamp = block.timestamp ? new Date(block.timestamp * 1000) : new Date();

          for (const txHash of block.transactions) {
            try {
              const tx = await provider.getTransaction(txHash);

              if (!tx || !tx.from) continue;

              // 1. Record address activity (for weekly active addresses)
              try {
                await AddressActivityCollection.insertAsync({
                  address: tx.from.toLowerCase(),
                  timestamp: blockTimestamp,
                  blockNumber: i
                });
                addressesAdded++;
              } catch (addressError) {
                // Might already exist, continue
              }

              // 2. Detect bridge deposits (type 105)
              if (tx.type === 105) {
                try {
                  const existing = await BridgeActivityCollection.findOneAsync({ txHash });
                  if (!existing) {
                    // Fetch deposit amount from internal transactions
                    const depositAmount = await fetchDepositAmount(txHash);

                    await BridgeActivityCollection.insertAsync({
                      txHash: txHash,
                      type: 'deposit',
                      from: tx.from.toLowerCase(),
                      to: tx.to ? tx.to.toLowerCase() : null,
                      value: depositAmount, // Fetched from internal transactions
                      timestamp: blockTimestamp,
                      blockNumber: i,
                      l2TxHash: txHash
                    });
                    depositsFound++;
                  }
                } catch (depositError) {
                  // Continue on error
                }
              }

              // 3. Detect withdrawals (to ArbSys)
              if (tx.to && tx.to.toLowerCase() === ARBSYS_ADDRESS && tx.value && Number(tx.value) > 0) {
                try {
                  const existing = await BridgeActivityCollection.findOneAsync({ txHash });
                  if (!existing) {
                    await BridgeActivityCollection.insertAsync({
                      txHash: txHash,
                      type: 'withdrawal',
                      from: tx.from.toLowerCase(),
                      to: ARBSYS_ADDRESS,
                      value: Number(tx.value) / 1e18,
                      timestamp: blockTimestamp,
                      blockNumber: i,
                      l2TxHash: txHash
                    });
                    withdrawalsFound++;
                  }
                } catch (withdrawalError) {
                  // Continue on error
                }
              }
            } catch (txError) {
              // Skip transactions that fail to fetch
              continue;
            }
          }
        }

        // Progress update every 100 blocks
        if ((i - startBlock + 1) % 100 === 0) {
          console.log(`  Scanned ${i - startBlock + 1}/${totalBlocks} blocks... (${addressesAdded} addresses, ${depositsFound} deposits, ${withdrawalsFound} withdrawals)`);
        }
      } catch (blockError) {
        // Skip blocks that fail to fetch
        continue;
      }
    }

    console.log(`✅ Backfill complete: ${addressesAdded} addresses, ${depositsFound} deposits, ${withdrawalsFound} withdrawals across ${totalBlocks} blocks`);
    return { addressesAdded, depositsFound, withdrawalsFound, blocksScanned: totalBlocks };
  } catch (error) {
    console.error('Error backfilling KPI data:', error.message);
    return { addressesAdded: 0, depositsFound: 0, withdrawalsFound: 0, blocksScanned: 0 };
  }
}

/**
 * Calculate historical bridge activity from actual bridge transactions
 * Returns daily bridge activity for the last N days
 */
export async function getBridgeActivityHistory(days = 7) {
  try {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    // Aggregate deposits by day
    const depositsPipeline = [
      {
        $match: {
          type: 'deposit',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
          totalValue: { $sum: '$value' }
        }
      },
      { $sort: { _id: 1 } }
    ];

    // Aggregate withdrawals by day
    const withdrawalsPipeline = [
      {
        $match: {
          type: 'withdrawal',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          count: { $sum: 1 },
          totalValue: { $sum: '$value' }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const depositsData = await BridgeActivityCollection.rawCollection().aggregate(depositsPipeline).toArray();
    const withdrawalsData = await BridgeActivityCollection.rawCollection().aggregate(withdrawalsPipeline).toArray();

    // Create a map for easy lookup
    const depositsMap = new Map(depositsData.map(d => [d._id, d]));
    const withdrawalsMap = new Map(withdrawalsData.map(w => [w._id, w]));

    // Build history array with ALL days in range (filling gaps with zeros)
    const activityHistory = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - (days - 1 - i));
      date.setHours(0, 0, 0, 0);

      const dateStr = date.toISOString().split('T')[0]; // Format: YYYY-MM-DD
      const deposits = depositsMap.get(dateStr) || { count: 0, totalValue: 0 };
      const withdrawals = withdrawalsMap.get(dateStr) || { count: 0, totalValue: 0 };

      activityHistory.push({
        date: dateStr,
        timestamp: new Date(dateStr + 'T12:00:00Z'), // Noon UTC
        depositCount: deposits.count,
        deposits: deposits.totalValue,
        withdrawalCount: withdrawals.count,
        withdrawals: withdrawals.totalValue,
        netFlow: deposits.totalValue - withdrawals.totalValue,
        // Use transaction count as activity metric since deposit values are 0
        totalActivity: deposits.count + withdrawals.count
      });
    }

    return activityHistory;
  } catch (error) {
    console.error('Error calculating bridge activity history:', error.message);
    return [];
  }
}

/**
 * Get historical TVL data for charts
 * Returns last N days (one snapshot per day)
 */
export async function getTvlHistory(days = 7) {
  try {
    // TVL doesn't have a 'date' field, so group by day from timestamp
    const pipeline = [
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          tvlInETH: { $first: '$tvlInETH' },
          tvlInUSD: { $first: '$tvlInUSD' },
          timestamp: { $first: '$timestamp' }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: days },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          tvlInETH: 1,
          tvlInUSD: 1,
          timestamp: 1
        }
      }
    ];

    const records = await TvlCollection.rawCollection().aggregate(pipeline).toArray();

    return records.map(r => ({
      tvlInETH: r.tvlInETH,
      tvlInUSD: r.tvlInUSD,
      timestamp: r.timestamp
    }));
  } catch (error) {
    console.error('Error fetching TVL history:', error.message);
    return [];
  }
}

/**
 * Get historical bridge volume data (USD) for charts
 * Returns last N days of total bridge volume (deposits + withdrawals in USD)
 */
export async function getBridgeVolumeHistory(days = 7) {
  try {
    const ethPrice = await getEthPrice();
    const now = new Date();
    const activityHistory = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - (days - 1 - i));
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      // Get deposits for this day
      const deposits = await BridgeActivityCollection.find({
        type: 'deposit',
        timestamp: { $gte: date, $lt: nextDate }
      }).fetchAsync();

      // Get withdrawals for this day
      const withdrawals = await BridgeActivityCollection.find({
        type: 'withdrawal',
        timestamp: { $gte: date, $lt: nextDate }
      }).fetchAsync();

      const depositETH = deposits.reduce((sum, d) => sum + d.value, 0);
      const withdrawalETH = withdrawals.reduce((sum, w) => sum + w.value, 0);
      const totalVolumeETH = depositETH + withdrawalETH;
      const volumeUSD = totalVolumeETH * ethPrice;

      activityHistory.push({
        date: date.toISOString().split('T')[0],
        timestamp: date,
        volumeUSD,
        volumeETH: totalVolumeETH,
        depositCount: deposits.length,
        withdrawalCount: withdrawals.length
      });
    }

    return activityHistory;
  } catch (error) {
    console.error('Error calculating bridge volume history:', error.message);
    return [];
  }
}

/**
 * Backfill deposit amounts from internal transactions
 * Fetches actual ETH deposit amounts for all Type 105 deposits with value=0
 */
export async function backfillDepositAmounts() {
  try {
    console.log('📊 Starting deposit amount backfill...');

    // Find all deposits with value = 0 (need to fetch amounts)
    const depositsToUpdate = await BridgeActivityCollection.find({
      type: 'deposit',
      value: 0
    }).fetchAsync();

    if (depositsToUpdate.length === 0) {
      console.log('✅ No deposits need amount backfill');
      return { updated: 0, errors: 0 };
    }

    console.log(`📍 Found ${depositsToUpdate.length} deposits to backfill`);

    let updated = 0;
    let errors = 0;

    for (const deposit of depositsToUpdate) {
      try {
        // Fetch deposit amount from internal transactions
        const amount = await fetchDepositAmount(deposit.txHash);

        if (amount > 0) {
          // Update the deposit record with the actual amount
          await BridgeActivityCollection.updateAsync(
            { _id: deposit._id },
            { $set: { value: amount } }
          );
          updated++;
          console.log(`  ✅ Updated ${deposit.txHash}: ${amount} ETH`);
        } else {
          errors++;
          console.log(`  ⚠️  No amount found for ${deposit.txHash}`);
        }

        // Rate limit: wait 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        errors++;
        console.error(`  ❌ Error updating ${deposit.txHash}:`, error.message);
      }
    }

    console.log(`✅ Deposit backfill complete: ${updated} updated, ${errors} errors`);
    return { updated, errors, total: depositsToUpdate.length };
  } catch (error) {
    console.error('Error in backfillDepositAmounts:', error.message);
    throw error;
  }
}
