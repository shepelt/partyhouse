import { Mongo } from 'meteor/mongo';

/**
 * Daily Transactions Collection
 * Stores historical snapshots of daily transaction counts
 * Document: { date, count, timestamp, updatedAt }
 */
export const DailyTransactionsCollection = new Mongo.Collection('dailyTransactions');

/**
 * Weekly Active Addresses Collection
 * Stores historical snapshots of unique active addresses in rolling 7-day windows
 * Document: { date, count, timestamp, updatedAt }
 */
export const WeeklyActiveAddressesCollection = new Mongo.Collection('weeklyActiveAddresses');

/**
 * TVL Collection
 * Stores historical snapshots of Total Value Locked over time
 * Document: { timestamp, tvlInETH, tvlInUSD, updatedAt }
 */
export const TvlCollection = new Mongo.Collection('tvl');

/**
 * Bridge Activity Collection
 * Stores L1 deposit/withdrawal events
 */
export const BridgeActivityCollection = new Mongo.Collection('bridgeActivity');

/**
 * Transactions Collection
 * Stores raw transaction data for analysis
 */
export const TransactionsCollection = new Mongo.Collection('transactions');

/**
 * Address Activity Collection
 * Tracks each address activity with timestamp for efficient time-based queries
 * Document: { address, timestamp, blockNumber }
 */
export const AddressActivityCollection = new Mongo.Collection('addressActivity');
