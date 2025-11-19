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
    const config = getActiveNetworkConfig();
    const explorerApiUrl = `${config.blockExplorer}/api/v2`;
    const url = `${explorerApiUrl}/transactions/${txHash}/internal-transactions`;
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
 * Calculate transactions in last 24 hours from stored activity data
 * Counts transactions recorded in AddressActivityCollection in last 24h
 */
export async function calculate24hTransactions() {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Count all address activities (transactions) in last 24h
    const count = await AddressActivityCollection.find({
      timestamp: { $gte: twentyFourHoursAgo }
    }).countAsync();

    console.log(`✅ 24h transactions: ${count}`);
    return { count };
  } catch (error) {
    console.error('Error calculating 24h transactions:', error.message);
    return { count: 0 };
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
 * @param {number} forceStartBlock - Optional: override start block (for backfill)
 * Returns: number of new blocks processed
 */
export async function processNewBlocks(forceStartBlock = null) {
  try {
    const provider = getProvider();
    const currentBlock = await provider.getBlockNumber();

    let startBlock;
    if (forceStartBlock !== null) {
      // Use provided start block for backfill
      startBlock = forceStartBlock;
    } else {
      // Get last processed block from collection
      const lastActivity = await AddressActivityCollection.findOneAsync(
        {},
        { sort: { blockNumber: -1 }, limit: 1 }
      );
      startBlock = lastActivity ? lastActivity.blockNumber + 1 : Math.max(0, currentBlock - 100);
    }

    if (startBlock > currentBlock) {
      console.log('Already up to date at block', currentBlock);
      return 0;
    }

    const totalBlocks = currentBlock - startBlock + 1;
    console.log(`Processing blocks ${startBlock} to ${currentBlock} (${totalBlocks} blocks)...`);

    const BATCH_SIZE = 20; // Process 20 blocks in parallel
    let addressesAdded = 0;
    let depositsDetected = 0;
    const startTime = Date.now();

    // Process blocks in batches for better performance
    for (let batchStart = startBlock; batchStart <= currentBlock; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, currentBlock);
      const batchPromises = [];

      // Create parallel promises for this batch
      for (let i = batchStart; i <= batchEnd; i++) {
        batchPromises.push(processBlock(i, provider));
      }

      // Wait for all blocks in batch to complete
      const batchResults = await Promise.all(batchPromises);

      // Aggregate results
      for (const result of batchResults) {
        addressesAdded += result.addressesAdded;
        depositsDetected += result.depositsDetected;
      }

      // Log progress every 100 blocks with performance metrics
      if (batchEnd % 100 < BATCH_SIZE) {
        const processed = batchEnd - startBlock + 1;
        const elapsed = (Date.now() - startTime) / 1000; // seconds
        const blocksPerSec = (processed / elapsed).toFixed(1);
        const progress = ((processed / totalBlocks) * 100).toFixed(1);
        const remaining = totalBlocks - processed;
        const etaSeconds = remaining / parseFloat(blocksPerSec);
        const etaMinutes = (etaSeconds / 60).toFixed(1);

        console.log(`  Processed ${processed}/${totalBlocks} blocks (${progress}%) - ${blocksPerSec} blocks/sec - ETA: ${etaMinutes} min`);
      }
    }

    return addressesAdded;
  } catch (error) {
    console.error('Error in processNewBlocks:', error.message);
    return 0;
  }
}

/**
 * Process a single block (extracted for parallel processing)
 */
async function processBlock(blockNumber, provider) {
  let addressesAdded = 0;
  let depositsDetected = 0;

  try {
    const block = await getBlock(blockNumber);

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
              blockNumber: blockNumber
            });
            addressesAdded++;

            // Get network config once for this transaction
            const networkConfig = getActiveNetworkConfig();
            const l1Config = networkConfig?.l1;

            // Detect bridge deposits (L1→L2)
            // Arbitrum Orbit uses type 105 for L1→L2 deposits
            if (tx.type === 105) {
              console.log(`🔍 Found type 105 transaction in block ${blockNumber}: ${txHash}`);
              try {
                let isTokenDeposit = false;
                let tokenSymbol = null;
                let tokenAmount = 0;
                let tokenL1Address = null;
                let tokenL2Address = null;

                // Check if this is an ERC-20 token deposit by looking for L1 token addresses in calldata
                // Type 105 transactions encode the token info in calldata, not in Transfer events
                if (tx.data && l1Config?.erc20Tokens) {
                  const calldata = tx.data.toLowerCase();

                  for (const token of l1Config.erc20Tokens) {
                    if (token.l1Address) {
                      const l1AddrLower = token.l1Address.toLowerCase().replace('0x', '');

                      if (calldata.includes(l1AddrLower)) {
                        // Found L1 token address in calldata - this is a token deposit!
                        isTokenDeposit = true;
                        tokenSymbol = token.symbol;
                        tokenL1Address = token.l1Address;
                        tokenL2Address = token.l2Address;

                        // Parse amount from calldata
                        // For Arbitrum type 105 (submitRetryable), the token info is in the retryData parameter
                        // retryData contains finalizeInboundTransfer(token, from, to, amount, data)
                        // Amount is the 4th parameter (after function selector, token, from, to)
                        try {
                          const { ethers } = await import('ethers');

                          // Find the position of the L1 token address in calldata
                          const tokenPos = calldata.indexOf(l1AddrLower);

                          if (tokenPos > 0) {
                            // Amount is 3 parameters (192 chars / 96 bytes) after the token address
                            // Each parameter is 64 hex chars (32 bytes)
                            const amountPos = tokenPos + l1AddrLower.length + (64 * 2); // Skip 'from' and 'to' parameters

                            if (amountPos + 64 <= calldata.length) {
                              const amountHex = calldata.substring(amountPos, amountPos + 64);
                              const value = ethers.BigNumber.from('0x' + amountHex);
                              tokenAmount = Number(value) / Math.pow(10, token.decimals);

                              console.log(`  💰 Parsed amount: ${tokenAmount.toLocaleString()} ${tokenSymbol}`);
                            }
                          }
                        } catch (e) {
                          console.warn(`  ⚠️  Could not parse amount for ${tokenSymbol} deposit: ${e.message}`);
                        }

                        break;
                      }
                    }
                  }
                }

                if (isTokenDeposit && tokenSymbol) {
                  // ERC-20 token deposit
                  console.log(`  ✅ ERC-20 deposit detected: ${tokenAmount || '(amount unknown)'} ${tokenSymbol} in block ${blockNumber}`);
                  await BridgeActivityCollection.insertAsync({
                    txHash: txHash,
                    type: 'erc20_bridge',
                    asset: tokenSymbol,
                    tokenAddress: tokenL2Address || tokenL1Address,
                    from: tx.from.toLowerCase(),
                    to: tx.to ? tx.to.toLowerCase() : null,
                    value: tokenAmount,
                    timestamp: blockTimestamp,
                    blockNumber: blockNumber,
                    l2TxHash: txHash
                  });
                } else {
                  // ETH deposit
                  console.log(`  ℹ️  ETH deposit in block ${blockNumber}`);
                  const depositAmount = await fetchDepositAmount(txHash);

                  await BridgeActivityCollection.insertAsync({
                    txHash: txHash,
                    type: 'deposit',
                    asset: 'ETH',
                    from: tx.from.toLowerCase(),
                    to: tx.to ? tx.to.toLowerCase() : null,
                    value: depositAmount,
                    timestamp: blockTimestamp,
                    blockNumber: blockNumber,
                    l2TxHash: txHash
                  });
                }

                depositsDetected++;
              } catch (receiptError) {
                // Continue even if receipt fetch fails
                console.error(`  ❌ Error processing type 105 tx: ${receiptError.message}`);
              }
            }

            // Detect ERC-20 token bridge deposits (L1 gateway transactions - rare in L2 blocks)
            // Check if transaction is to any token gateway
            if (l1Config?.erc20Tokens && tx.to) {
              for (const token of l1Config.erc20Tokens) {
                if (token.gateway && tx.to.toLowerCase() === token.gateway.toLowerCase()) {
                  // This is a gateway transaction - parse amount from calldata
                  try {
                    const amount = await parseGatewayTransaction(tx, token);

                    await BridgeActivityCollection.insertAsync({
                      txHash: txHash,
                      type: 'erc20_bridge',
                      asset: token.symbol,
                      tokenAddress: token.l1Address,
                      from: tx.from.toLowerCase(),
                      to: tx.to.toLowerCase(),
                      value: amount, // ← Parsed from transaction data!
                      timestamp: blockTimestamp,
                      blockNumber: blockNumber,
                      l2TxHash: txHash
                    });
                  } catch (tokenError) {
                    // Continue on error
                  }
                  break;
                }
              }
            }

            // Detect withdrawals (L2→L1)
            const ARBSYS_ADDRESS = '0x0000000000000000000000000000000000000064';

            // ETH withdrawals - transactions to ArbSys with value
            if (tx.to && tx.to.toLowerCase() === ARBSYS_ADDRESS && tx.value && Number(tx.value) > 0) {
              await BridgeActivityCollection.insertAsync({
                txHash: txHash,
                type: 'withdrawal',
                asset: 'ETH',
                from: tx.from.toLowerCase(),
                to: ARBSYS_ADDRESS,
                value: Number(tx.value) / 1e18,
                timestamp: blockTimestamp,
                blockNumber: blockNumber,
                l2TxHash: txHash
              });
            }

            // ERC-20 withdrawals - check for transactions to L2 gateway contracts
            if (l1Config?.erc20Tokens && tx.to) {
              for (const token of l1Config.erc20Tokens) {
                if (token.l2Gateway && tx.to.toLowerCase() === token.l2Gateway.toLowerCase()) {
                  // Transaction to L2 gateway - likely a withdrawal
                  // Check receipt for token transfer events
                  try {
                    const receipt = await provider.getTransactionReceipt(txHash);
                    const TRANSFER_EVENT = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

                    if (receipt && receipt.logs) {
                      for (const log of receipt.logs) {
                        if (log.topics[0] === TRANSFER_EVENT &&
                            log.address.toLowerCase() === token.l2Address.toLowerCase()) {
                          // Parse withdrawal amount
                          const { ethers } = await import('ethers');
                          const amount = ethers.BigNumber.from(log.data);
                          const tokenAmount = Number(amount) / Math.pow(10, token.decimals);

                          await BridgeActivityCollection.insertAsync({
                            txHash: txHash,
                            type: 'withdrawal',
                            asset: token.symbol,
                            tokenAddress: token.l2Address,
                            from: tx.from.toLowerCase(),
                            to: tx.to.toLowerCase(),
                            value: tokenAmount,
                            timestamp: blockTimestamp,
                            blockNumber: blockNumber,
                            l2TxHash: txHash
                          });
                          break;
                        }
                      }
                    }
                  } catch (withdrawalError) {
                    // Continue on error
                  }
                  break;
                }
              }
            }
          }
        } catch (txError) {
          continue;
        }
      }
    }

    return { addressesAdded, depositsDetected };
  } catch (error) {
    console.error(`Error processing block ${blockNumber}:`, error.message);
    return { addressesAdded: 0, depositsDetected: 0 };
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

// Minimal ERC-20 ABI for balance queries
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

// Arbitrum Gateway ABI for parsing bridge transactions
const GATEWAY_ABI = [
  'function outboundTransfer(address _token, address _to, uint256 _amount, uint256 _maxGas, uint256 _gasPriceBid, bytes _data) payable returns (bytes)',
  'function finalizeInboundTransfer(address _token, address _from, address _to, uint256 _amount, bytes _data) payable'
];

/**
 * Parse ERC-20 token amount from gateway transaction
 * Returns amount in token units (not wei)
 */
async function parseGatewayTransaction(tx, token) {
  try {
    const { ethers } = await import('ethers');

    if (!tx.data || tx.data === '0x') {
      return 0;
    }

    // Create interface for decoding
    const iface = new ethers.utils.Interface(GATEWAY_ABI);

    try {
      // Try to decode as outboundTransfer (L1→L2 deposit)
      const decoded = iface.parseTransaction({ data: tx.data });

      if (decoded.name === 'outboundTransfer') {
        // Extract amount parameter (3rd parameter, index 2)
        const amountWei = decoded.args._amount || decoded.args[2];

        if (amountWei) {
          // Convert from wei/token units to actual amount
          const amount = Number(amountWei) / Math.pow(10, token.decimals);
          return amount;
        }
      } else if (decoded.name === 'finalizeInboundTransfer') {
        // This is a withdrawal finalization
        const amountWei = decoded.args._amount || decoded.args[3];

        if (amountWei) {
          const amount = Number(amountWei) / Math.pow(10, token.decimals);
          return amount;
        }
      }
    } catch (decodeError) {
      // Not a recognized gateway method
      return 0;
    }

    return 0;
  } catch (error) {
    console.error('Error parsing gateway transaction:', error.message);
    return 0;
  }
}

/**
 * Get token price in USD from configured price API
 */
async function getTokenPrice(symbol, retryCount = 0) {
  const MAX_RETRIES = 2;

  try {
    const hppSettings = Meteor.settings.hpp;
    const priceApi = hppSettings?.priceApi;

    if (!priceApi) {
      console.warn('Price API not configured in settings');
      return null;
    }

    const tokenId = priceApi.tokenIds?.[symbol];
    if (!tokenId) {
      // Token not mapped or explicitly set to null
      return null;
    }

    // Support different price API providers
    if (priceApi.provider === 'coingecko') {
      const url = `${priceApi.baseUrl}?ids=${tokenId}&vs_currencies=usd`;

      if (retryCount === 0) {
        console.log(`Fetching ${symbol} price from CoinGecko (tokenId: ${tokenId})...`);
      }

      const response = await fetch(url);

      if (!response.ok) {
        // Log the error response body for debugging
        let errorBody = '';
        try {
          errorBody = await response.text();
        } catch (e) {
          errorBody = '(could not read error body)';
        }

        // Handle 429 rate limiting with retry
        if (response.status === 429 && retryCount < MAX_RETRIES) {
          const retryAfter = response.headers.get('retry-after');
          const waitSeconds = retryAfter ? parseInt(retryAfter) : 30;

          console.warn(`⚠️  Rate limited fetching ${symbol} price (${response.status}). Waiting ${waitSeconds}s before retry ${retryCount + 1}/${MAX_RETRIES}...`);
          console.warn(`   URL: ${url}`);
          console.warn(`   Response: ${errorBody}`);
          await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

          return await getTokenPrice(symbol, retryCount + 1);
        }

        console.error(`❌ Failed to fetch ${symbol} price: ${response.status} ${response.statusText}`);
        console.error(`   URL: ${url}`);
        console.error(`   Response: ${errorBody}`);
        return null;
      }

      const data = await response.json();
      const price = data[tokenId]?.usd || null;

      if (price) {
        console.log(`✅ ${symbol} price: $${price}`);
      } else {
        console.warn(`⚠️  ${symbol} price not found in response:`, JSON.stringify(data));
      }

      return price;
    } else if (priceApi.provider === 'custom') {
      // For custom API, expect direct URL with {symbol} placeholder
      const url = priceApi.baseUrl.replace('{symbol}', symbol).replace('{tokenId}', tokenId);
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`Failed to fetch price for ${symbol} from custom API`);
        return null;
      }

      const data = await response.json();
      // Custom API should return { price: <usd_value> } or configure jsonPath in settings
      return data.price || data.usd || null;
    }

    console.warn(`Unsupported price API provider: ${priceApi.provider}`);
    return null;
  } catch (error) {
    console.error(`Error fetching price for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Get historical prices for a token from CoinGecko (free tier)
 * Returns a map of date strings to prices
 */
async function getHistoricalPrices(symbol, days = 7, retryCount = 0) {
  const MAX_RETRIES = 3;

  try {
    const hppSettings = Meteor.settings.hpp;
    const priceApi = hppSettings?.priceApi;

    if (!priceApi || priceApi.provider !== 'coingecko') {
      console.warn('Historical prices only supported for CoinGecko provider');
      return null;
    }

    const tokenId = priceApi.tokenIds?.[symbol];
    if (!tokenId) {
      return null;
    }

    // Use free market_chart endpoint
    const url = `https://api.coingecko.com/api/v3/coins/${tokenId}/market_chart?vs_currency=usd&days=${days}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      const retryAfter = response.headers.get('retry-after');
      const rateLimitReset = response.headers.get('x-ratelimit-reset');

      console.warn(`Failed to fetch historical prices for ${symbol}: ${response.status} ${response.statusText}`);
      console.warn(`  URL: ${url}`);
      console.warn(`  Response: ${errorText.substring(0, 200)}`);

      // Handle 429 rate limiting with retry
      if (response.status === 429 && retryAfter && retryCount < MAX_RETRIES) {
        const waitSeconds = parseInt(retryAfter);
        console.warn(`  Rate limited. Waiting ${waitSeconds} seconds before retry ${retryCount + 1}/${MAX_RETRIES}...`);

        // Wait for the specified retry-after period
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));

        // Retry the request
        return await getHistoricalPrices(symbol, days, retryCount + 1);
      }

      if (retryAfter) {
        console.warn(`  Retry-After: ${retryAfter} seconds`);
      }
      if (rateLimitReset) {
        const resetTime = new Date(parseInt(rateLimitReset) * 1000);
        console.warn(`  Rate Limit Resets: ${resetTime.toISOString()}`);
      }
      return null;
    }

    const data = await response.json();

    // Convert to map: date string -> price
    const priceMap = new Map();
    for (const [timestamp, price] of data.prices) {
      const date = new Date(timestamp);
      const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

      // Use the price closest to midnight for each day
      if (!priceMap.has(dateStr)) {
        priceMap.set(dateStr, price);
      }
    }

    return priceMap;
  } catch (error) {
    console.error(`Error fetching historical prices for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Update Total Value Locked (TVL) by querying L1 bridge and token balances
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

    // Connect to L1 - ethers v5 syntax
    const l1Provider = new ethers.providers.JsonRpcProvider(l1Config.rpcEndpoint);

    // Get current ETH price
    const ethPrice = await getEthPrice();

    // 1. Query ETH balance of bridge contract on L1
    const bridgeBalance = await l1Provider.getBalance(l1Config.bridgeContract);
    const ethAmount = Number(bridgeBalance) / 1e18;
    const ethValueUSD = ethAmount * ethPrice;

    let totalTvlUSD = ethValueUSD;
    let totalTvlETH = ethAmount; // ETH equivalent
    const tokenBreakdown = [
      {
        symbol: 'ETH',
        amount: ethAmount,
        valueUSD: ethValueUSD,
        price: ethPrice
      }
    ];

    // 2. Query ERC-20 token balances
    if (l1Config.erc20Tokens && l1Config.erc20Tokens.length > 0) {
      for (const token of l1Config.erc20Tokens) {
        try {
          // Skip if no L1 address (L2-only tokens)
          if (!token.l1Address) continue;

          const tokenContract = new ethers.Contract(
            token.l1Address,
            ERC20_ABI,
            l1Provider
          );

          // Query balance in gateway (if specified) or bridge contract
          const balanceTarget = token.gateway || l1Config.bridgeContract;
          console.log(`  Querying ${token.symbol} balance at ${balanceTarget}...`);
          const balance = await tokenContract.balanceOf(balanceTarget);
          const amount = Number(balance) / Math.pow(10, token.decimals);
          console.log(`  Raw balance: ${balance.toString()}, Amount: ${amount}`);

          // Get token price
          const price = await getTokenPrice(token.symbol);

          let valueUSD = null;
          if (price) {
            valueUSD = amount * price;
            totalTvlUSD += valueUSD;

            // Convert to ETH equivalent
            const ethEquivalent = valueUSD / ethPrice;
            totalTvlETH += ethEquivalent;
          }

          tokenBreakdown.push({
            symbol: token.symbol,
            name: token.name,
            amount,
            valueUSD,
            price
          });

          // Log token balance with appropriate message
          if (amount === 0) {
            console.log(`  ${token.symbol}: ${amount.toFixed(4)} (no balance)`);
          } else if (price) {
            console.log(`  ${token.symbol}: ${amount.toFixed(4)} ($${valueUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`);
          } else {
            console.log(`  ${token.symbol}: ${amount.toFixed(4)} (price unavailable)`);
          }
        } catch (tokenError) {
          console.error(`Error querying ${token.symbol}:`, tokenError.message);
        }
      }
    }

    console.log(`✅ Total Bridge TVL: $${totalTvlUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

    // Store snapshot in database
    await TvlCollection.insertAsync({
      timestamp: new Date(),
      tvlInETH: totalTvlETH,
      tvlInUSD: totalTvlUSD,
      tokenBreakdown,
      updatedAt: new Date()
    });

    return {
      tvlInETH: totalTvlETH,
      tvlInUSD: totalTvlUSD,
      tokenBreakdown,
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

    // Get all bridge activity in last 24h
    const withdrawals = await BridgeActivityCollection.find({
      type: 'withdrawal',
      timestamp: { $gte: twentyFourHoursAgo }
    }).fetchAsync();

    const ethDeposits = await BridgeActivityCollection.find({
      type: 'deposit',
      timestamp: { $gte: twentyFourHoursAgo }
    }).fetchAsync();

    const erc20Deposits = await BridgeActivityCollection.find({
      type: 'erc20_bridge',
      timestamp: { $gte: twentyFourHoursAgo }
    }).fetchAsync();

    // Get ETH price for conversions
    const ethPrice = await getEthPrice();

    // Calculate ETH deposits/withdrawals
    const totalWithdrawalsETH = withdrawals.reduce((sum, w) => sum + w.value, 0);
    const totalEthDepositsETH = ethDeposits.reduce((sum, d) => sum + d.value, 0);

    // Calculate total USD volume
    let totalVolumeUSD = (totalEthDepositsETH + totalWithdrawalsETH) * ethPrice;

    // Add ERC-20 token volume
    let erc20VolumeUSD = 0;
    for (const deposit of erc20Deposits) {
      const price = await getTokenPrice(deposit.asset);
      if (price && deposit.value) {
        const valueUSD = deposit.value * price;
        erc20VolumeUSD += valueUSD;
        totalVolumeUSD += valueUSD;
      }
    }

    const totalDeposits = ethDeposits.length + erc20Deposits.length;

    console.log(`✅ Bridge volume (24h): ${totalDeposits} deposits (${totalEthDepositsETH.toFixed(4)} ETH + ${erc20Deposits.length} tokens), ${withdrawals.length} withdrawals (${totalWithdrawalsETH.toFixed(4)} ETH) = $${totalVolumeUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);

    return {
      depositCount: totalDeposits,
      withdrawalCount: withdrawals.length,
      depositsETH: totalEthDepositsETH,
      withdrawalsETH: totalWithdrawalsETH,
      erc20VolumeUSD,
      totalVolumeETH: totalEthDepositsETH + totalWithdrawalsETH,
      volumeUSD: totalVolumeUSD,
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
    const { ethers } = await import('ethers');

    // Get current TVL for token breakdown
    const currentTvl = await getTVL();
    if (!currentTvl || currentTvl.tvlInETH === 0) {
      console.log('⚠️  No current TVL data to backfill');
      return 0;
    }

    // Get L1 configuration
    const networkConfig = getActiveNetworkConfig();
    const l1Config = networkConfig.l1;
    if (!l1Config || !l1Config.rpcEndpoint) {
      console.error('L1 configuration missing in settings');
      return 0;
    }

    // Fetch historical prices for all tokens (free tier supports up to 365 days)
    console.log('📊 Fetching historical prices...');
    const ethPriceHistory = await getHistoricalPrices('WETH', Math.max(days, 7));

    // Rate limit: wait 2 seconds after ETH price fetch
    await new Promise(resolve => setTimeout(resolve, 2000));

    const tokenPriceHistories = new Map();
    if (l1Config.erc20Tokens) {
      for (const token of l1Config.erc20Tokens) {
        if (token.l1Address) {
          const history = await getHistoricalPrices(token.symbol, Math.max(days, 7));
          if (history) {
            tokenPriceHistories.set(token.symbol, history);
          }
          // Rate limit: wait 2 seconds between requests to avoid 429 errors
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    const now = new Date();
    let snapshotsCreated = 0;

    // Get price from 7 days ago as fallback for older dates
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fallbackDateStr = sevenDaysAgo.toISOString().split('T')[0];
    const fallbackEthPrice = ethPriceHistory?.get(fallbackDateStr) || await getEthPrice();

    // Create snapshots for each of the last N days with historical prices
    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(12, 0, 0, 0); // Noon

      const dateStr = date.toISOString().split('T')[0];

      // Get ETH price for this date (use fallback if beyond 7 days)
      const ethPrice = ethPriceHistory?.get(dateStr) || fallbackEthPrice;

      // Use current token balances (simplified - could query historical if needed)
      const tokenBreakdown = currentTvl.tokenBreakdown || [];

      // Recalculate TVL with historical prices
      let totalTvlUSD = 0;
      const historicalBreakdown = [];

      for (const token of tokenBreakdown) {
        let price = token.price; // Default to current price

        if (token.symbol === 'ETH') {
          price = ethPrice;
        } else {
          const history = tokenPriceHistories.get(token.symbol);
          price = history?.get(dateStr) || history?.get(fallbackDateStr) || token.price;
        }

        const valueUSD = price ? token.amount * price : null;
        if (valueUSD) {
          totalTvlUSD += valueUSD;
        }

        historicalBreakdown.push({
          ...token,
          price,
          valueUSD
        });
      }

      const totalTvlETH = totalTvlUSD / ethPrice;

      // Store snapshot
      await TvlCollection.insertAsync({
        timestamp: date,
        tvlInETH: totalTvlETH,
        tvlInUSD: totalTvlUSD,
        tokenBreakdown: historicalBreakdown,
        updatedAt: new Date()
      });

      snapshotsCreated++;
      console.log(`  Created TVL snapshot for ${date.toDateString()}: ${totalTvlETH.toFixed(4)} ETH ($${totalTvlUSD.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`);
    }

    console.log(`✅ Backfilled ${snapshotsCreated} TVL snapshots with historical prices`);
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
 * Respects settings.hpp.backfill.historicalData configuration:
 * - blockCount: -1 = scan from genesis, 0 = skip backfill, >0 = scan last N blocks
 */
export async function backfillHistoricalData() {
  try {
    // Check if backfill is enabled
    const backfillConfig = Meteor.settings.hpp?.backfill?.historicalData;
    if (!backfillConfig?.enabled) {
      console.log('⚠️  KPI backfill is disabled in settings');
      return { addressesAdded: 0, depositsFound: 0, withdrawalsFound: 0, blocksScanned: 0 };
    }

    const blockCount = backfillConfig.blockCount || 0;
    if (blockCount === 0) {
      console.log('⚠️  KPI backfill blockCount is 0 (skipping)');
      return { addressesAdded: 0, depositsFound: 0, withdrawalsFound: 0, blocksScanned: 0 };
    }

    // Calculate start block based on settings
    const provider = getProvider();
    const currentBlock = await provider.getBlockNumber();

    let startBlock;
    if (blockCount === -1) {
      startBlock = 1; // Scan from genesis
    } else {
      startBlock = Math.max(1, currentBlock - blockCount + 1);
    }

    console.log(`🔍 Backfilling all KPIs for last ${blockCount} blocks (${startBlock} to ${currentBlock})...`);

    // Use the optimized parallel processNewBlocks() with specified start block
    const addressesAdded = await processNewBlocks(startBlock);

    return {
      addressesAdded,
      depositsFound: 0, // processNewBlocks handles this internally
      withdrawalsFound: 0,
      blocksScanned: addressesAdded
    };
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
