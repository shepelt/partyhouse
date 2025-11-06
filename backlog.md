# PartyHouse Backlog

## Rules
- Keep backlog items short and simple, ideally one-liners

## Done (v0.1)
- TASK-1: Setup basic Meteor app structure with React (CSS + HPP branding)
- TASK-2: Configure Ethers.js for HPP Sepolia blockchain connection
- TASK-3: Create MongoDB collections for KPI storage + blockchain status UI
- TASK-4: Implement daily transactions tracking (refactored to use Blockscout API)
- TASK-5: Implement weekly active addresses with clickable modal showing address details
- TASK-6: Implement Bridge TVL tracking (queries ETH locked in L1 bridge contract)
- TASK-7: Implement bridge activity monitoring (tracks 24h deposits/withdrawals from transactions)
- TASK-8: Create dashboard UI with KPI cards and inline charts
- TASK-9: Add time-series charts for historical data (7-day history for all KPIs)
- TASK-10: Implement deposit amount tracking via Blockscout internal transactions API
- TASK-11: Implement bridge volume calculation in USD (deposits + withdrawals)
- TASK-12: Add compact Y-axis formatting for charts (K/M notation)

## In Progress

## Next Up
- TASK-13: Setup scheduled jobs for periodic data updates

## Future Ideas

### Data Collection
- Historical data backfill from chain inception
- Real-time event monitoring with websocket subscriptions
- Multi-chain support for L1 and L2
- Archive node integration for complete history

### Visualization
- Interactive charts with date range selection
- Comparison views (day-over-day, week-over-week)
- Export data to CSV/JSON
- Customizable dashboard layouts

### Advanced Metrics
- User cohort analysis
- Transaction size distribution
- Gas usage analytics
- Protocol revenue tracking
- Liquidity depth analysis

### Infrastructure
- Price feed integration (Chainlink/API)
- RPC provider fallback and load balancing
- Alerting system for anomaly detection
- Public API for KPI access
