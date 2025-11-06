# AI Development Rules for PartyHouse

## Project Overview
PartyHouse is a Meteor.js application for monitoring on-chain KPIs for the House Party Protocol (hpp.io). It provides real-time tracking and visualization of blockchain metrics and protocol performance.

## Technology Stack
- **Framework**: Meteor.js 3.x
- **Frontend**: React 18.2
- **Language**: JavaScript (ES6+)
- **Database**: MongoDB
- **Build System**: Meteor modern build stack
- **Blockchain Integration**: Web3.js / Ethers.js (TBD)

## Project Structure
Follow the canonical Meteor.js application structure:

```
/client             # Client entry point
/server             # Server entry point
/imports
  /api              # Collections, Methods, Publications
    /blockchain     # On-chain data fetching and processing
    /kpis           # KPI calculations and metrics
  /ui               # React components
    /dashboard      # KPI dashboards and visualizations
    /charts         # Chart components
/public             # Static assets
/private            # Server-only assets
```

## Code Conventions

### File Organization
- Place all application code inside `/imports` directory
- Use ES6 `import`/`export` modules
- Client code: `/imports/ui`
- Server code: `/imports/api`
- Shared code: Can be in either, but avoid client-specific code in `/api`

### Naming Conventions
- **Collections**: PascalCase with "Collection" suffix (e.g., `KpisCollection`, `BlockchainDataCollection`)
- **Components**: PascalCase (e.g., `DashboardView.jsx`, `KpiChart.jsx`)
- **Files**: Match the exported component/module name
- **Methods**: camelCase (e.g., `kpis.calculate`, `blockchain.fetchData`)

### Meteor Patterns
- Use `async`/`await` for all database operations
- Collections: `new Mongo.Collection('name')`
- Methods: `Meteor.methods({ 'name': async function() {} })`
- Publications: `Meteor.publish('name', function() {})`
- Subscriptions: `useTracker()` for React components

## Blockchain Integration

### Data Fetching
- Use scheduled jobs (e.g., `SyncedCron`) for periodic on-chain data updates
- Cache blockchain data in MongoDB to minimize RPC calls
- Implement retry logic for failed RPC requests
- Store block numbers to track synchronization state

### KPI Calculations
- Define KPIs as pure functions that operate on blockchain data
- Store calculated KPIs in dedicated collections for historical tracking
- Support time-series aggregations (hourly, daily, weekly)

## Development Philosophy

### Start Simple, Grow Naturally
- **Flat structure first**: Keep files at the root level until organization becomes necessary
  - ✅ `imports/api/kpis.js`
  - ❌ `imports/api/metrics/kpis/calculations/tvl.js` (too early)

### YAGNI Principle
- Only build what you need right now
- Don't create "future-proof" abstractions
- Examples of YAGNI violations to avoid:
  - Creating a `BaseKPI` class before you have 2 KPIs
  - Adding multi-chain support before supporting a single chain
  - Building a plugin system before you have plugins

### When to Refactor
- When you copy-paste code 3+ times → extract to function
- When a file exceeds 300 lines → consider splitting
- When a pattern becomes clear → then abstract it
- Never before

## Development Workflow
- Keep components small and focused
- Co-locate related files (component, styles, tests)
- Write clear, self-documenting code
- Follow Meteor Guide best practices
- **NEVER modify files without explicit user permission**
  - Always show the proposed changes first
  - Wait for user approval before applying
  - Exception: Only when user explicitly requests the change (e.g., "fix that", "do it")
- Use backlog.md as progress and task management framework
- **Development Server**: Run via `npm start`
  - Includes Hot Module Replacement (HMR) for instant UI updates
  - Auto-restarts server on backend code changes
  - No need to manually restart during development
- **MongoDB Database Access**:
  - Interactive shell: `npm run mongo` or `./mongo.sh`
  - List recent KPIs: `npm run mongo:kpis`
  - Custom query: `./mongo.sh --eval 'db.collection.find()'`
  - Examples:
    - Get KPI: `./mongo.sh --eval 'db.kpis.findOne({_id: "KPI_ID"})'`
    - Recent metrics: `./mongo.sh --eval 'db.kpis.find().sort({timestamp: -1}).limit(10)'`

## Testing
- **Test Framework**: Mocha via `meteortesting:mocha` package
- **Test Files**: `*.tests.js` files (e.g., `kpis.tests.js`)
- **Run All Tests**: `npm test` or `meteor test --once --driver-package meteortesting:mocha`
- **Filter Tests**: Use `MOCHA_GREP` environment variable to run specific tests
  - Example: `MOCHA_GREP="kpi" meteor test --once --driver-package meteortesting:mocha`
  - Matches test names containing the grep pattern
- **Exclude Tests**: Use `MOCHA_GREP` with `MOCHA_INVERT=1` to exclude tests
  - Example: `MOCHA_GREP="TODO" MOCHA_INVERT=1 meteor test`
- **Test Timeout**: Default is 2 seconds; increase with `this.timeout(ms)` in test suite
  - Blockchain integration tests typically need 30000ms (30 seconds) for RPC calls

## On-Chain Data Best Practices

### RPC Provider Management
- Use environment variables for RPC endpoints
- Implement fallback providers for reliability
- Rate-limit RPC calls to avoid hitting provider limits
- Log RPC errors for monitoring

### Data Consistency
- Use block numbers as reference points for data snapshots
- Implement re-org detection and handling
- Store raw blockchain data before processing
- Keep audit trail of KPI calculations

### Performance
- Batch RPC requests when possible
- Use indexed queries on MongoDB collections
- Implement pagination for large datasets
- Cache frequently accessed data

## Security Considerations
- Never expose RPC API keys in client code
- Validate all blockchain addresses and transaction hashes
- Implement rate limiting on public endpoints
- Sanitize user inputs for custom queries

## Notes
This file will evolve as the project grows and patterns emerge.

## References
- Use meteor-docs.txt as reference on Meteor development (copied from ~/nobi)
- House Party Protocol documentation: hpp.io
- Web3.js/Ethers.js documentation for blockchain integration
