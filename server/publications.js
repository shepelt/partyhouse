import { Meteor } from 'meteor/meteor';
import {
  DailyTransactionsCollection,
  WeeklyActiveAddressesCollection,
  TvlCollection,
  BridgeActivityCollection
} from '../imports/api/collections.js';

/**
 * Publish the latest daily transaction record (for current day)
 */
Meteor.publish('dailyTransactions.latest', function() {
  return DailyTransactionsCollection.find({}, {
    sort: { updatedAt: -1 },
    limit: 1
  });
});

/**
 * Publish daily transactions history for last N days
 */
Meteor.publish('dailyTransactions.history', function(days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return DailyTransactionsCollection.find(
    { date: { $gte: startDate } },
    { sort: { date: 1 } }
  );
});

/**
 * Publish the latest weekly active addresses record
 */
Meteor.publish('weeklyActiveAddresses.latest', function() {
  return WeeklyActiveAddressesCollection.find({}, {
    sort: { updatedAt: -1 },
    limit: 1
  });
});

/**
 * Publish weekly active addresses history for last N entries
 */
Meteor.publish('weeklyActiveAddresses.history', function(days = 7) {
  return WeeklyActiveAddressesCollection.find({}, {
    sort: { updatedAt: -1 },
    limit: days
  });
});

/**
 * Publish the latest TVL record
 */
Meteor.publish('tvl.latest', function() {
  return TvlCollection.find({}, {
    sort: { timestamp: -1 },
    limit: 1
  });
});

/**
 * Publish TVL history for last N records
 */
Meteor.publish('tvl.history', function(days = 7) {
  return TvlCollection.find({}, {
    sort: { timestamp: -1 },
    limit: days
  });
});

/**
 * Publish bridge activity for last 24 hours
 */
Meteor.publish('bridgeActivity.recent', function() {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  return BridgeActivityCollection.find(
    { timestamp: { $gte: twentyFourHoursAgo } },
    { sort: { timestamp: -1 } }
  );
});
