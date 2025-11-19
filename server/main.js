import { Meteor } from 'meteor/meteor';
import { getNetworkInfo } from './blockchain.js';
import {
  updateDailyTransactionCount,
  updateWeeklyActiveAddresses,
  updateTVL,
  backfillDailyTransactionHistory,
  backfillWeeklyActiveAddressHistory,
  backfillHistoricalData,
  getDailyTransactionsHistory,
  getTvlHistory,
  backfillTvlHistory
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

  // Backfill or process new blocks FIRST (before KPI updates that might populate the DB)
  try {
    // Import collections to check if we need full backfill
    const { AddressActivityCollection } = await import('../imports/api/collections.js');

    // DEBUG: Check immediately after import
    console.log('🔍 DEBUG: Checking database RIGHT after import...');
    const immediateCount = await AddressActivityCollection.find().countAsync();
    console.log(`🔍 DEBUG: Found ${immediateCount} records immediately after import`);

    // If we have records, sample a few to see what they are
    if (immediateCount > 0) {
      const sampleRecords = await AddressActivityCollection.find({}, { limit: 3, sort: { blockNumber: -1 } }).fetchAsync();
      console.log('🔍 DEBUG: Sample records (latest 3):');
      sampleRecords.forEach(record => {
        console.log(`   - Block ${record.blockNumber}, Address: ${record.address}, Timestamp: ${new Date(record.timestamp).toISOString()}`);
      });

      const oldestRecord = await AddressActivityCollection.findOneAsync({}, { sort: { blockNumber: 1 } });
      console.log(`🔍 DEBUG: Oldest record: Block ${oldestRecord.blockNumber}, Timestamp: ${new Date(oldestRecord.timestamp).toISOString()}`);
    }

    // Check if we have historical data already
    const activityCount = await AddressActivityCollection.find().countAsync();
    const backfillConfig = Meteor.settings.hpp?.backfill?.historicalData;
    const blockCount = backfillConfig?.blockCount || 10080;

    // Only do full backfill if database is mostly empty (less than 10% of target blocks)
    if (activityCount < blockCount * 0.1) {
      console.log(`📊 Database has minimal data (${activityCount} records). Running full backfill...`);
      await backfillHistoricalData();
    } else {
      console.log(`📊 Database has existing data (${activityCount} records). Processing new blocks only...`);
      const { processNewBlocks } = await import('./kpis.js');
      await processNewBlocks();
    }
  } catch (error) {
    console.error('❌ KPI data processing failed:', error.message);
  }

  // Fetch initial KPI data (after backfill/processing)
  console.log('🔄 Fetching initial KPI data...');
  try {
    await updateDailyTransactionCount();
    await updateTVL();
  } catch (error) {
    console.error('❌ Initial KPI fetch failed:', error.message);
  }

  // Check if we have enough historical data snapshots, if not, backfill
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

  // TVL historical backfill disabled (avoiding CoinGecko rate limits on startup)
  console.log('⚠️  TVL historical backfill disabled (avoiding CoinGecko rate limits on startup)');

  // Start scheduled jobs for periodic KPI updates
  await startScheduledJobs();
});
