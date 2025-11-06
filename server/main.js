import { Meteor } from 'meteor/meteor';
import { getNetworkInfo } from './blockchain.js';
import {
  updateDailyTransactionCount,
  updateWeeklyActiveAddresses,
  updateTVL,
  backfillDailyTransactionHistory,
  backfillWeeklyActiveAddressHistory,
  backfillBridgeActivity,
  getDailyTransactionsHistory
} from './kpis.js';
import { startScheduledJobs } from './scheduler.js';
import './publications.js';
import '../imports/api/methods.js';

Meteor.startup(async () => {
  console.log('🎉 PartyHouse Analytics starting...');

  // Test blockchain connection
  try {
    const networkInfo = await getNetworkInfo();
    console.log('✅ Blockchain connection successful!');
    console.log(`   Network: ${networkInfo.name}`);
    console.log(`   Chain ID: ${networkInfo.chainId}`);
    console.log(`   Current Block: ${networkInfo.blockNumber}`);
    console.log(`   Explorer: ${networkInfo.explorer}`);
  } catch (error) {
    console.error('❌ Blockchain connection failed:', error.message);
  }

  // Fetch initial KPI data
  console.log('🔄 Fetching initial KPI data...');
  try {
    await updateDailyTransactionCount();
    await updateTVL();
  } catch (error) {
    console.error('❌ Initial KPI fetch failed:', error.message);
  }

  // Check if we have enough historical data, if not, backfill
  try {
    const existingData = await getDailyTransactionsHistory(7);
    if (existingData.length < 7) {
      console.log(`📈 Backfilling historical data (found ${existingData.length}/7 days)...`);
      await backfillDailyTransactionHistory(7);
      await backfillWeeklyActiveAddressHistory(7);
    } else {
      console.log('✅ Historical data already available');
    }
  } catch (error) {
    console.error('❌ Backfill check failed:', error.message);
  }

  // Backfill all KPI data (respects settings configuration)
  try {
    console.log('📊 Starting comprehensive KPI backfill (addresses, bridge activity, etc.)...');
    await backfillBridgeActivity();
  } catch (error) {
    console.error('❌ KPI backfill failed:', error.message);
  }

  // Start scheduled jobs for periodic KPI updates
  await startScheduledJobs();
});
