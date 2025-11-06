#!/bin/bash
set -e

# Load settings.json if it exists and export as METEOR_SETTINGS
if [ -f /app/settings.json ]; then
  export METEOR_SETTINGS=$(cat /app/settings.json)
  echo "✅ Loaded settings from /app/settings.json"
else
  echo "⚠️  No settings.json found, running without custom settings"
fi

# Start the application
exec node main.js
