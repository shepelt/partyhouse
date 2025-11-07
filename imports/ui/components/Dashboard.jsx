import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import {
  DailyTransactionsCollection,
  WeeklyActiveAddressesCollection,
  TvlCollection
} from '../../api/collections';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { TrendingUp, Users, DollarSign, ArrowUpDown } from 'lucide-react';
import { KpiRow } from './KpiRow';

export const Dashboard = () => {
  // Get settings from public config
  const blockExplorer = Meteor.settings.public?.blockExplorer || 'https://explorer.hpp.io';
  const networkName = Meteor.settings.public?.networkName || 'HPP';

  // Modal state
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [addressDetails, setAddressDetails] = useState([]);

  // 24h transactions state
  const [transactions24h, setTransactions24h] = useState('---');

  // Network info state
  const [networkInfo, setNetworkInfo] = useState(null);

  // Bridge-related state (still using methods as they're calculated values, not stored directly)
  const [bridgeActivity, setBridgeActivity] = useState('---');
  const [bridgeVolume, setBridgeVolume] = useState('---');
  const [isLoadingBridge, setIsLoadingBridge] = useState(false);
  const [isLoadingVolume, setIsLoadingVolume] = useState(false);
  const [bridgeActivityHistory, setBridgeActivityHistory] = useState([]);
  const [bridgeVolumeHistory, setBridgeVolumeHistory] = useState([]);

  // Reactive data from subscriptions
  const { dailyTransactions, weeklyActiveAddresses, tvl, txHistory, addressHistory, tvlHistory, isLoading } = useTracker(() => {
    const days = 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const dailyTxSub = Meteor.subscribe('dailyTransactions.latest');
    const weeklyAddrSub = Meteor.subscribe('weeklyActiveAddresses.latest');
    const tvlSub = Meteor.subscribe('tvl.latest');
    const txHistorySub = Meteor.subscribe('dailyTransactions.history', days);
    const addrHistorySub = Meteor.subscribe('weeklyActiveAddresses.history', days);
    const tvlHistorySub = Meteor.subscribe('tvl.history', days);

    const isLoading = !dailyTxSub.ready() || !weeklyAddrSub.ready() || !tvlSub.ready();

    // Get latest records
    const latestDailyTx = DailyTransactionsCollection.findOne({}, { sort: { updatedAt: -1 } });
    const latestWeeklyAddr = WeeklyActiveAddressesCollection.findOne({}, { sort: { updatedAt: -1 } });
    const latestTvl = TvlCollection.findOne({}, { sort: { timestamp: -1 } });

    // Get historical data (matching the publication filters)
    const txHistoryData = DailyTransactionsCollection.find(
      { date: { $gte: startDate } },
      { sort: { date: 1 }, limit: days }
    ).fetch();
    const addrHistoryData = WeeklyActiveAddressesCollection.find(
      {},
      { sort: { updatedAt: -1 }, limit: days }
    ).fetch().reverse(); // Reverse to get chronological order
    const tvlHistoryData = TvlCollection.find(
      {},
      { sort: { timestamp: -1 }, limit: days }
    ).fetch().reverse(); // Reverse to get chronological order

    return {
      dailyTransactions: latestDailyTx?.count?.toLocaleString() || '---',
      weeklyActiveAddresses: latestWeeklyAddr?.count?.toLocaleString() || '---',
      tvl: latestTvl?.tvlInUSD
        ? `$${latestTvl.tvlInUSD.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
        : '---',
      txHistory: txHistoryData,
      addressHistory: addrHistoryData,
      tvlHistory: tvlHistoryData,
      isLoading
    };
  }, []);

  useEffect(() => {
    // Set page title based on network
    document.title = `PartyHouse Analytics - ${networkName}`;

    // Fetch network info
    Meteor.callAsync('blockchain.getNetworkInfo').then(setNetworkInfo).catch(console.error);

    // Update network info every 30 seconds
    const networkInterval = setInterval(() => {
      Meteor.callAsync('blockchain.getNetworkInfo').then(setNetworkInfo).catch(console.error);
    }, 30000);

    return () => {
      clearInterval(networkInterval);
    };
  }, [networkName]);

  useEffect(() => {
    // Fetch 24h transactions, bridge activity and volume (these are calculated on-demand, not stored in DB)
    fetch24hTransactions();
    fetchBridgeActivity();
    fetchBridgeVolume();
    fetchBridgeHistoricalData();

    // Update metrics every 5 minutes (matches server-side calculation schedule)
    const metricsInterval = setInterval(() => {
      fetch24hTransactions();
      fetchBridgeActivity();
      fetchBridgeVolume();
      fetchBridgeHistoricalData();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(metricsInterval);
    };
  }, []);

  const fetchBridgeHistoricalData = async () => {
    try {
      const [bridgeData, volumeData] = await Promise.all([
        Meteor.callAsync('kpis.getBridgeActivityHistory', 7),
        Meteor.callAsync('kpis.getBridgeVolumeHistory', 7)
      ]);

      setBridgeActivityHistory(bridgeData || []);
      setBridgeVolumeHistory(volumeData || []);
    } catch (error) {
      console.error('Error fetching bridge historical data:', error);
    }
  };

  const fetchBridgeActivity = async () => {
    try {
      setIsLoadingBridge(true);
      const result = await Meteor.callAsync('kpis.getBridgeActivity');
      if (result && result.depositCount !== undefined) {
        setBridgeActivity(`${result.depositCount} deposits, ${result.withdrawalCount} withdrawals`);
      }
    } catch (error) {
      console.error('Error fetching bridge activity:', error);
    } finally {
      setIsLoadingBridge(false);
    }
  };

  const fetchBridgeVolume = async () => {
    try {
      setIsLoadingVolume(true);
      const result = await Meteor.callAsync('kpis.getBridgeVolume');
      if (result && result.volumeUSD !== undefined) {
        setBridgeVolume(`$${result.volumeUSD.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0})}`);
      }
    } catch (error) {
      console.error('Error fetching bridge volume:', error);
    } finally {
      setIsLoadingVolume(false);
    }
  };

  const fetch24hTransactions = async () => {
    try {
      const result = await Meteor.callAsync('kpis.get24hTransactions');
      if (result && result.count !== undefined) {
        setTransactions24h(result.count.toLocaleString());
      }
    } catch (error) {
      console.error('Error fetching 24h transactions:', error);
    }
  };

  const handleAddressCardClick = async () => {
    try {
      const details = await Meteor.callAsync('kpis.getWeeklyActiveAddressDetails');
      setAddressDetails(details);
      setShowAddressModal(true);
    } catch (error) {
      console.error('Error fetching address details:', error);
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <p>
          Real-time KPI monitoring for {networkName}
          {networkInfo && (
            <span style={{ marginLeft: '12px', color: '#888', fontSize: '0.9em' }}>
              • Block {networkInfo.blockNumber?.toLocaleString()} • Chain ID {networkInfo.chainId}
            </span>
          )}
        </p>
      </div>

      <div className="kpi-rows">
        <KpiRow
          title="Transactions (24h)"
          value={transactions24h}
          description="Transactions in last 24 hours"
          icon={TrendingUp}
          isLoading={false}
          chartData={txHistory}
          chartDataKey="count"
          chartColor="#8b5cf6"
          chartTitle="Transaction History (7d)"
        />

        <KpiRow
          title="Weekly Active Addresses"
          value={weeklyActiveAddresses}
          description="Unique addresses (7d)"
          icon={Users}
          isLoading={isLoading}
          clickable={true}
          onClick={handleAddressCardClick}
          chartData={addressHistory}
          chartDataKey="count"
          chartColor="#10b981"
          chartTitle="Active Address Trend (7d)"
        />

        <KpiRow
          title="Bridge TVL"
          value={tvl}
          description="Total value locked (USD)"
          icon={DollarSign}
          isLoading={isLoading}
          chartData={tvlHistory}
          chartDataKey="tvlInUSD"
          chartColor="#3b82f6"
          chartTitle="TVL History (7d)"
        />

        <KpiRow
          title="Bridge Activity"
          value={bridgeActivity}
          description="Deposits & withdrawals (24h)"
          icon={ArrowUpDown}
          isLoading={isLoadingBridge}
          chartData={bridgeActivityHistory}
          chartDataKey="totalActivity"
          chartColor="#f59e0b"
          chartTitle="Bridge Flow (7d)"
        />

        <KpiRow
          title="Bridge Volume"
          value={bridgeVolume}
          description="Total volume (24h)"
          icon={DollarSign}
          isLoading={isLoadingVolume}
          chartData={bridgeVolumeHistory}
          chartDataKey="volumeUSD"
          chartColor="#ec4899"
          chartTitle="Bridge Volume (7d)"
        />
      </div>

      {/* Address Details Modal */}
      {showAddressModal && (
        <div className="modal-overlay" onClick={() => setShowAddressModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Weekly Active Addresses</h2>
              <button className="modal-close" onClick={() => setShowAddressModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <table className="address-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Transactions</th>
                    <th>First Seen</th>
                    <th>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {addressDetails.map((addr) => (
                    <tr key={addr.address}>
                      <td className="address-cell">
                        <a
                          href={`${blockExplorer}/address/${addr.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {addr.address.slice(0, 6)}...{addr.address.slice(-4)}
                        </a>
                      </td>
                      <td>{addr.txCount}</td>
                      <td>{new Date(addr.firstSeen).toLocaleString()}</td>
                      <td>{new Date(addr.lastSeen).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
