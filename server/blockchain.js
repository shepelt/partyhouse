import { Meteor } from 'meteor/meteor';
import ethers from 'ethers';

let provider = null;
let wsProvider = null;

/**
 * Get HPP configuration from Meteor settings
 */
function getConfig() {
  const hppSettings = Meteor.settings.hpp;
  if (!hppSettings) {
    throw new Error('HPP configuration not found in settings-local.json');
  }

  const activeNetwork = hppSettings.activeNetwork || 'sepolia';
  const config = hppSettings.networks?.[activeNetwork];

  if (!config) {
    throw new Error(`Network configuration for '${activeNetwork}' not found in settings`);
  }

  return config;
}

/**
 * Get or create the HTTP RPC provider
 */
export function getProvider() {
  if (!provider) {
    const config = getConfig();
    const rpcUrl = config.rpcEndpoint;

    if (!rpcUrl) {
      throw new Error('rpcEndpoint not configured in settings');
    }

    provider = new ethers.providers.JsonRpcProvider(rpcUrl, {
      chainId: config.chainId,
      name: config.networkName,
    });

    console.log(`Connected to ${config.networkName} via RPC: ${rpcUrl}`);
  }

  return provider;
}

/**
 * Get or create the WebSocket provider
 */
export function getWsProvider() {
  if (!wsProvider) {
    const config = getConfig();
    const wssUrl = config.wssEndpoint;

    if (!wssUrl) {
      throw new Error('wssEndpoint not configured in settings');
    }

    wsProvider = new ethers.providers.WebSocketProvider(wssUrl, {
      chainId: config.chainId,
      name: config.networkName,
    });

    console.log(`Connected to ${config.networkName} via WSS: ${wssUrl}`);
  }

  return wsProvider;
}

/**
 * Get network information
 */
export async function getNetworkInfo() {
  const config = getConfig();
  const provider = getProvider();
  const network = await provider.getNetwork();
  const blockNumber = await provider.getBlockNumber();

  return {
    name: network.name,
    chainId: Number(network.chainId),
    blockNumber,
    rpcUrl: config.rpcEndpoint,
    explorer: config.blockExplorer,
  };
}

/**
 * Get the current block number
 */
export async function getBlockNumber() {
  const provider = getProvider();
  return await provider.getBlockNumber();
}

/**
 * Get block by number
 */
export async function getBlock(blockNumber) {
  const provider = getProvider();
  return await provider.getBlock(blockNumber);
}

/**
 * Get transaction count for an address
 */
export async function getTransactionCount(address, blockTag = 'latest') {
  const provider = getProvider();
  return await provider.getTransactionCount(address, blockTag);
}

/**
 * Get balance for an address
 */
export async function getBalance(address, blockTag = 'latest') {
  const provider = getProvider();
  const balance = await provider.getBalance(address, blockTag);
  return ethers.utils.formatEther(balance);
}
