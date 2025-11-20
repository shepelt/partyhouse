import { Meteor } from 'meteor/meteor';
import { getNetworkInfo, getBlockNumber } from '../../server/blockchain.js';
import {
  getTodayTransactions,
  updateDailyTransactionCount,
  calculate24hTransactions,
  getWeeklyActiveAddresses,
  getWeeklyActiveAddressDetails,
  calculateTVL,
  calculateBridgeActivity,
  calculateBridgeActivityFromTransactions,
  calculateBridgeVolume,
  getBridgeActivity,
  getBridgeVolume,
  getDailyTransactionsHistory,
  getWeeklyActiveAddressesHistory,
  getTvlHistory,
  getBridgeActivityHistory,
  getBridgeVolumeHistory,
  backfillDailyTransactionHistory,
  backfillWeeklyActiveAddressHistory,
  backfillTvlHistory,
  backfillHistoricalData,
  backfillDepositAmounts
} from '../../server/kpis.js';

Meteor.methods({
  /**
   * Get current blockchain network information
   */
  async 'blockchain.getNetworkInfo'() {
    if (!this.isSimulation) {
      return await getNetworkInfo();
    }
  },

  /**
   * Get current block number
   */
  async 'blockchain.getBlockNumber'() {
    if (!this.isSimulation) {
      return await getBlockNumber();
    }
  },

  /**
   * Get today's transaction count (from Blockscout API)
   */
  async 'kpis.getTodayTransactions'() {
    if (!this.isSimulation) {
      return await getTodayTransactions();
    }
  },

  /**
   * Manually trigger KPI update from Blockscout (for testing)
   */
  async 'kpis.updateDailyTransactionCount'() {
    if (!this.isSimulation) {
      return await updateDailyTransactionCount();
    }
  },

  /**
   * Get transactions in last 24 hours
   */
  async 'kpis.get24hTransactions'() {
    if (!this.isSimulation) {
      return await calculate24hTransactions();
    }
  },

  /**
   * Get weekly active addresses count
   */
  async 'kpis.getWeeklyActiveAddresses'() {
    if (!this.isSimulation) {
      return await getWeeklyActiveAddresses();
    }
  },

  /**
   * Get detailed list of weekly active addresses
   */
  async 'kpis.getWeeklyActiveAddressDetails'() {
    if (!this.isSimulation) {
      return await getWeeklyActiveAddressDetails();
    }
  },

  /**
   * Calculate Total Value Locked (TVL)
   */
  async 'kpis.calculateTVL'() {
    if (!this.isSimulation) {
      return await calculateTVL();
    }
  },

  /**
   * Get bridge activity (deposits/withdrawals in 24h)
   * Returns cached data - no price fetching, instant response!
   */
  async 'kpis.getBridgeActivity'() {
    if (!this.isSimulation) {
      return await getBridgeActivity();
    }
  },

  /**
   * Get 24h bridge volume in USD
   * Returns cached data - no price fetching, instant response!
   */
  async 'kpis.getBridgeVolume'() {
    if (!this.isSimulation) {
      return await getBridgeVolume();
    }
  },

  /**
   * Get historical daily transactions data
   */
  async 'kpis.getDailyTransactionsHistory'(days = 7) {
    if (!this.isSimulation) {
      return await getDailyTransactionsHistory(days);
    }
  },

  /**
   * Get historical weekly active addresses data
   */
  async 'kpis.getWeeklyActiveAddressesHistory'(days = 7) {
    if (!this.isSimulation) {
      return await getWeeklyActiveAddressesHistory(days);
    }
  },

  /**
   * Get historical TVL data
   */
  async 'kpis.getTvlHistory'(days = 7) {
    if (!this.isSimulation) {
      return await getTvlHistory(days);
    }
  },

  /**
   * Get historical bridge activity data (calculated from TVL changes)
   */
  async 'kpis.getBridgeActivityHistory'(days = 7) {
    if (!this.isSimulation) {
      return await getBridgeActivityHistory(days);
    }
  },

  /**
   * Get historical bridge volume data in USD
   */
  async 'kpis.getBridgeVolumeHistory'(days = 7) {
    if (!this.isSimulation) {
      return await getBridgeVolumeHistory(days);
    }
  },

  /**
   * Backfill historical data for daily transactions
   */
  async 'kpis.backfillDailyTransactionHistory'(days = 7) {
    if (!this.isSimulation) {
      return await backfillDailyTransactionHistory(days);
    }
  },

  /**
   * Backfill historical data for weekly active addresses
   */
  async 'kpis.backfillWeeklyActiveAddressHistory'(days = 7) {
    if (!this.isSimulation) {
      return await backfillWeeklyActiveAddressHistory(days);
    }
  },

  /**
   * Backfill historical data for TVL (uses current value)
   */
  async 'kpis.backfillTvlHistory'(days = 7) {
    if (!this.isSimulation) {
      return await backfillTvlHistory(days);
    }
  },

  /**
   * Backfill historical KPI data by scanning past blocks
   * Scans blocks for address activity, deposits, withdrawals, and bridge activity
   */
  async 'kpis.backfillHistoricalData'() {
    if (!this.isSimulation) {
      return await backfillHistoricalData();
    }
  },

  /**
   * Backfill deposit amounts from internal transactions
   * Fetches actual ETH amounts for deposits that have value=0
   */
  async 'kpis.backfillDepositAmounts'() {
    if (!this.isSimulation) {
      return await backfillDepositAmounts();
    }
  },

  /**
   * Check bridge activity data in database
   */
  async 'kpis.checkBridgeData'() {
    if (!this.isSimulation) {
      const { BridgeActivityCollection } = await import('../imports/api/collections.js');

      const totalRecords = await BridgeActivityCollection.find().countAsync();
      const erc20Count = await BridgeActivityCollection.find({ type: 'erc20_bridge' }).countAsync();
      const ethDepositCount = await BridgeActivityCollection.find({ type: 'deposit' }).countAsync();
      const withdrawalCount = await BridgeActivityCollection.find({ type: 'withdrawal' }).countAsync();

      const erc20Deposits = await BridgeActivityCollection.find({ type: 'erc20_bridge' }).fetchAsync();

      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentCount = await BridgeActivityCollection.find({
        timestamp: { $gte: twentyFourHoursAgo }
      }).countAsync();

      return {
        totalRecords,
        ethDepositCount,
        erc20Count,
        withdrawalCount,
        recentCount,
        erc20Deposits: erc20Deposits.map(d => ({
          asset: d.asset,
          value: d.value,
          blockNumber: d.blockNumber,
          timestamp: d.timestamp,
          txHash: d.txHash
        }))
      };
    }
  },

  /**
   * Check specific block for type 105 transactions
   */
  async 'kpis.checkBlock'(blockNumber) {
    if (!this.isSimulation) {
      const { getProvider } = await import('../../server/blockchain.js');
      const provider = getProvider();

      const block = await provider.getBlockWithTransactions(blockNumber);

      console.log(`\n=== Block ${blockNumber} Check ===`);
      console.log(`Timestamp: ${new Date(block.timestamp * 1000).toISOString()}`);
      console.log(`Total transactions: ${block.transactions.length}`);

      const type105Txs = block.transactions.filter(tx => tx.type === 105);
      console.log(`Type 105 transactions: ${type105Txs.length}`);

      const results = [];

      for (const tx of type105Txs) {
        console.log(`\nType 105 TX: ${tx.hash}`);
        console.log(`  From: ${tx.from}`);
        console.log(`  To: ${tx.to || 'null'}`);
        console.log(`  Value: ${tx.value?.toString()} wei`);

        const receipt = await provider.getTransactionReceipt(tx.hash);
        console.log(`  Logs: ${receipt.logs?.length || 0}`);

        const TRANSFER_EVENT = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        const transferLogs = receipt.logs.filter(log => log.topics[0] === TRANSFER_EVENT);
        console.log(`  Transfer events: ${transferLogs.length}`);

        transferLogs.forEach((log, i) => {
          console.log(`    Transfer ${i + 1}: token=${log.address}, data length=${log.data.length}`);
        });

        results.push({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value?.toString(),
          logsCount: receipt.logs?.length || 0,
          transferEventsCount: transferLogs.length,
          transferEvents: transferLogs.map(log => ({
            tokenAddress: log.address,
            data: log.data
          }))
        });
      }

      return { blockNumber, type105Count: type105Txs.length, transactions: results };
    }
  },

  /**
   * Backfill priceUSD for existing ERC-20 bridge records
   * Uses cached prices from TokenPricesCollection when available
   */
  async 'kpis.backfillErc20Prices'() {
    if (this.isSimulation) return;

    const { BridgeActivityCollection } = await import('/imports/api/collections');
    const { getTokenPrice } = await import('/server/kpis');

    // Find all ERC-20 records without priceUSD
    const records = await BridgeActivityCollection.find({
      type: 'erc20_bridge',
      priceUSD: { $exists: false }
    }).fetchAsync();

    console.log(`📊 Backfilling prices for ${records.length} ERC-20 records (will use cached prices when available)...`);

    let updated = 0;
    let skipped = 0;

    for (const record of records) {
      if (!record.asset) {
        skipped++;
        continue;
      }

      try {
        // getTokenPrice now checks cache first, then fetches if needed
        const price = await getTokenPrice(record.asset);
        if (price) {
          await BridgeActivityCollection.updateAsync(record._id, {
            $set: { priceUSD: price }
          });
          updated++;
          console.log(`  ✅ Updated ${record.asset}: $${price}`);
        } else {
          skipped++;
          console.log(`  ⚠️  No price found for ${record.asset}`);
        }
      } catch (err) {
        skipped++;
        console.warn(`  ❌ Failed to fetch price for ${record.asset}: ${err.message}`);
      }
    }

    const result = `Backfill complete: ${updated} updated, ${skipped} skipped`;
    console.log(`✅ ${result}`);
    return result;
  },

  /**
   * Manually set ERC-20 prices (use when CoinGecko is rate limited)
   */
  async 'kpis.setErc20PricesManual'(prices = { HPP: 0.068358 }) {
    if (this.isSimulation) return;

    const { BridgeActivityCollection } = await import('/imports/api/collections');

    let updated = 0;

    for (const [asset, price] of Object.entries(prices)) {
      const result = await BridgeActivityCollection.updateAsync(
        { type: 'erc20_bridge', asset: asset, priceUSD: { $exists: false } },
        { $set: { priceUSD: price } },
        { multi: true }
      );
      updated += result;
      console.log(`  ✅ Set ${asset} price to $${price} for ${result} records`);
    }

    const result = `Manually set prices for ${updated} records`;
    console.log(`✅ ${result}`);
    return result;
  },

  /**
   * Check ERC-20 bridge records (diagnostic)
   */
  async 'kpis.checkErc20Records'() {
    if (this.isSimulation) return;

    const { BridgeActivityCollection } = await import('/imports/api/collections');

    const records = await BridgeActivityCollection.find({
      type: 'erc20_bridge'
    }).fetchAsync();

    console.log(`Found ${records.length} ERC-20 records:`);
    records.forEach(r => {
      console.log(`  ${r.asset}: ${r.value} tokens, priceUSD: ${r.priceUSD || 'NOT SET'}, timestamp: ${r.timestamp}`);
    });

    return records.map(r => ({
      asset: r.asset,
      value: r.value,
      priceUSD: r.priceUSD,
      valueUSD: r.priceUSD ? r.value * r.priceUSD : null,
      timestamp: r.timestamp
    }));
  },
});
