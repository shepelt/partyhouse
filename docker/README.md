# PartyHouse Docker Deployment

This directory contains Docker configuration for deploying PartyHouse in containerized environments.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+

## Quick Start

1. **Configure environment variables**

   Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

   Example configuration:
   ```bash
   ROOT_URL=https://your-domain.com
   PORT=4000
   ```

2. **Create settings.json**

   Ensure you have a `settings.json` file in the project root with your blockchain configuration:
   ```json
   {
     "public": {
       "chainId": 8453,
       "rpcUrl": "https://mainnet.base.org"
     }
   }
   ```

3. **Start the services**

   ```bash
   cd docker
   docker-compose up -d
   ```

4. **View logs**

   ```bash
   docker-compose logs -f partyhouse
   ```

5. **Stop the services**

   ```bash
   docker-compose down
   ```

## Architecture

### Services

- **mongodb**: MongoDB 7 database for PartyHouse data persistence
- **partyhouse**: PartyHouse Meteor application for monitoring House Party Protocol KPIs
- **tailscale** (optional): Secure remote access via Tailscale VPN

### Volumes

- `partyhouse-mongodb-data`: MongoDB data persistence
- `partyhouse-tailscale-data`: Tailscale state (optional)

### Network

- `partyhouse-network`: Bridge network for service communication

## Configuration

### Environment Variables

Configure in `docker/.env`:

- `ROOT_URL`: Public URL for the PartyHouse application (e.g., `https://partyhouse.your-domain.com`)
- `PORT`: Host port to expose PartyHouse on (default: 4000)
- Additional Meteor settings can be passed via `METEOR_SETTINGS` environment variable

### Meteor Settings

The application requires a `settings.json` file in the project root. This file should contain:

- Blockchain RPC configuration
- Chain ID for House Party Protocol
- Any API keys or private configuration

The settings file is automatically mounted as read-only into the container.

## Tailscale Setup (Optional)

Tailscale provides secure remote access without exposing your application to the public internet.

1. **Copy the Tailscale serve configuration**
   ```bash
   cd docker
   cp tailscale-serve.json.example tailscale-serve.json
   ```

2. **Configure environment variables**
   Add to your `docker/.env`:
   ```bash
   TS_AUTHKEY=tskey-auth-xxxxx  # Get from https://login.tailscale.com/admin/settings/keys
   TS_HOSTNAME=partyhouse
   TS_CERT_DOMAIN=partyhouse
   ```

3. **Start with Tailscale enabled**
   ```bash
   docker-compose --profile tailscale up -d
   ```

4. **Access your application**
   After Tailscale connects, access via: `https://partyhouse.your-tailnet.ts.net`

## Development vs Production

### Production (Current Setup)

The current setup uses a multi-stage build optimized for production:
- Minimal image size
- Non-root user for security
- Health checks
- Production-only dependencies

### Development

For local development with hot-reload, use:
```bash
npm start
```

This runs Meteor in development mode outside of Docker with Hot Module Replacement (HMR).

## Commands

### Build and start
```bash
cd docker
docker-compose up --build -d
```

### View logs
```bash
docker-compose logs -f
```

### View specific service logs
```bash
docker-compose logs -f partyhouse
docker-compose logs -f mongodb
```

### Stop services
```bash
docker-compose down
```

### Remove volumes (clean slate)
```bash
docker-compose down -v
```

### Execute commands in container
```bash
docker-compose exec partyhouse bash
```

### MongoDB shell access
```bash
docker-compose exec mongodb mongosh partyhouse
```

## Troubleshooting

### Container won't start
Check logs:
```bash
docker-compose logs partyhouse
```

### MongoDB connection issues
Verify MongoDB is healthy:
```bash
docker-compose ps
```

### Settings not loading
Ensure `settings.json` exists in project root and check logs:
```bash
docker-compose logs partyhouse | grep settings
```

### Reset everything
```bash
docker-compose down -v
docker-compose up --build -d
```

### Tailscale not connecting
1. Check Tailscale logs:
   ```bash
   docker-compose logs tailscale
   ```
2. Verify TS_AUTHKEY is valid
3. Ensure container has NET_ADMIN capability

## Port Mapping

- **${PORT:-4000}**: PartyHouse application (HTTP) - configurable via .env
- **27017**: MongoDB (internal only, not exposed)
- **443**: Tailscale HTTPS (optional, when using Tailscale profile)

## Security Notes

- MongoDB is not exposed externally (no port mapping)
- Application runs as non-root user
- Environment variables should be kept secure
- Use secrets management for production deployments
- Tailscale provides end-to-end encrypted access without public exposure

## Health Checks

- **MongoDB**: `mongosh --eval "db.adminCommand('ping')"`
- **PartyHouse**: `curl -f http://localhost:4000/`

Health checks run automatically and Docker will restart unhealthy containers.

## Blockchain Integration

PartyHouse monitors on-chain KPIs for the House Party Protocol. Ensure your settings include:

- Valid RPC endpoint URL
- Correct chain ID
- Sufficient RPC rate limits for periodic data fetching

The application will automatically:
- Fetch on-chain data periodically
- Cache blockchain data in MongoDB
- Calculate and store KPI metrics
- Serve real-time dashboards

## Monitoring

To monitor the application:

1. **Check container health**
   ```bash
   docker-compose ps
   ```

2. **View application logs**
   ```bash
   docker-compose logs -f partyhouse
   ```

3. **Check MongoDB data**
   ```bash
   docker-compose exec mongodb mongosh partyhouse --eval 'db.kpis.find().sort({timestamp: -1}).limit(5)'
   ```

## Backup

### MongoDB Backup
```bash
docker-compose exec mongodb mongodump --db partyhouse --out /data/backup
docker cp partyhouse-mongodb:/data/backup ./backup
```

### MongoDB Restore
```bash
docker cp ./backup partyhouse-mongodb:/data/backup
docker-compose exec mongodb mongorestore --db partyhouse /data/backup/partyhouse
```
