import { Meteor } from 'meteor/meteor';
import {
  updateDailyTransactionCount,
  calculate24hTransactions,
  calculateTVL,
  calculateBridgeActivityFromTransactions,
  calculateBridgeVolume,
  updateWeeklyActiveAddresses
} from './kpis.js';

/**
 * Setup server-side scheduled jobs for periodic KPI updates
 * Called from Meteor.startup in main.js
 */
export async function startScheduledJobs() {
  console.log('🕐 Starting scheduled jobs...');

  // Run all updates immediately on startup
  console.log('🚀 Running initial KPI updates...');
  try {
    await Promise.all([
      calculate24hTransactions(),
      calculateTVL(),
      calculateBridgeActivityFromTransactions(),
      calculateBridgeVolume()
    ]);
    console.log('✅ Initial KPI updates complete');
  } catch (error) {
    console.error('❌ Error in initial KPI updates:', error.message);
  }

  // Update TVL every 5 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Running scheduled TVL update...');
      await calculateTVL();
    } catch (error) {
      console.error('❌ Error in scheduled TVL update:', error.message);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Update bridge activity every 5 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Running scheduled bridge activity update...');
      await calculateBridgeActivityFromTransactions();
    } catch (error) {
      console.error('❌ Error in scheduled bridge activity update:', error.message);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Update bridge volume every 5 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Running scheduled bridge volume update...');
      await calculateBridgeVolume();
    } catch (error) {
      console.error('❌ Error in scheduled bridge volume update:', error.message);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Update 24h transaction count every 5 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Running scheduled 24h transaction update...');
      await calculate24hTransactions();
    } catch (error) {
      console.error('❌ Error in scheduled 24h transaction update:', error.message);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Update daily transaction count every 10 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Running scheduled daily transaction update...');
      await updateDailyTransactionCount();
    } catch (error) {
      console.error('❌ Error in scheduled daily transaction update:', error.message);
    }
  }, 10 * 60 * 1000); // 10 minutes

  // Update weekly active addresses every 15 minutes
  setInterval(async () => {
    try {
      console.log('⏰ Running scheduled weekly active addresses update...');
      await updateWeeklyActiveAddresses();
    } catch (error) {
      console.error('❌ Error in scheduled weekly active addresses update:', error.message);
    }
  }, 15 * 60 * 1000); // 15 minutes

  console.log('✅ Scheduled jobs started');
}
