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
  getDailyTransactionsHistory,
  getWeeklyActiveAddressesHistory,
  getTvlHistory,
  getBridgeActivityHistory,
  getBridgeVolumeHistory,
  backfillDailyTransactionHistory,
  backfillWeeklyActiveAddressHistory,
  backfillTvlHistory,
  backfillBridgeActivity,
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
   * Calculate bridge activity (deposits/withdrawals in 24h)
   * Now uses actual bridge transactions instead of TVL changes
   */
  async 'kpis.getBridgeActivity'() {
    if (!this.isSimulation) {
      return await calculateBridgeActivityFromTransactions();
    }
  },

  /**
   * Calculate 24h bridge volume in USD
   */
  async 'kpis.getBridgeVolume'() {
    if (!this.isSimulation) {
      return await calculateBridgeVolume();
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
   * Backfill bridge activity by scanning historical blocks
   * Scans all processed blocks for type 105 deposits and ArbSys withdrawals
   */
  async 'kpis.backfillBridgeActivity'() {
    if (!this.isSimulation) {
      return await backfillBridgeActivity();
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
});
