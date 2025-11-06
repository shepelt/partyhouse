import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Network, Blocks, ExternalLink } from 'lucide-react';

export const BlockchainStatus = () => {
  const [networkInfo, setNetworkInfo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch network info on mount
    Meteor.call('blockchain.getNetworkInfo', (error, result) => {
      if (error) {
        console.error('Error fetching network info:', error);
      } else {
        setNetworkInfo(result);
      }
      setLoading(false);
    });

    // Update block number every 30 seconds
    const interval = setInterval(() => {
      Meteor.call('blockchain.getNetworkInfo', (error, result) => {
        if (!error && result) {
          setNetworkInfo(result);
        }
      });
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Blockchain Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground text-sm">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!networkInfo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Blockchain Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-destructive text-sm">Failed to connect</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Blockchain Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{networkInfo.name}</span>
          </div>

          <div className="flex items-center gap-2">
            <Blocks className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              Block: <span className="font-mono">{networkInfo.blockNumber.toLocaleString()}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Chain ID:</span>
            <span className="text-sm font-mono">{networkInfo.chainId}</span>
          </div>

          {networkInfo.explorer && (
            <a
              href={networkInfo.explorer}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Explorer
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
