# Multi-stage build for PartyHouse Meteor Application

# Stage 1: Build the Meteor application
FROM node:20-slim AS builder

# Install dependencies and Meteor
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/* && \
    curl https://install.meteor.com/ | sh

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source
COPY . .

# Build Meteor application (allow running as root in Docker)
ENV METEOR_ALLOW_SUPERUSER=1
RUN meteor build --directory /build --server-only

# Stage 2: Production runtime
FROM node:20-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    bash \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder /build/bundle /app

# Copy entrypoint script
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Install production dependencies
WORKDIR /app/programs/server
RUN npm install --omit=dev

# Switch back to app directory
WORKDIR /app

# Create non-root user (Debian syntax)
RUN groupadd --system meteor && useradd --system --gid meteor --home-dir /app meteor && \
    chown -R meteor:meteor /app

# Switch to non-root user
USER meteor

# Expose port
EXPOSE 4000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:4000/ || exit 1

# Start the application using entrypoint that loads settings
CMD ["/app/entrypoint.sh"]
