import { Meteor } from 'meteor/meteor';

/**
 * Get the Blockscout API base URL from settings
 */
function getExplorerApiUrl() {
  const explorer = Meteor.settings.hpp?.blockExplorer;
  if (!explorer) {
    throw new Error('Block explorer URL not configured in settings');
  }
  // Convert explorer URL to API URL (e.g., https://sepolia-explorer.hpp.io -> https://sepolia-explorer.hpp.io/api/v2)
  return `${explorer}/api/v2`;
}

/**
 * Fetch network statistics from Blockscout API
 * Returns: {
 *   transactions_today: number,
 *   total_transactions: number,
 *   total_addresses: number,
 *   gas_used_today: string,
 *   total_blocks: number,
 *   ...
 * }
 */
export async function fetchBlockscoutStats() {
  try {
    const apiUrl = getExplorerApiUrl();
    const response = await fetch(`${apiUrl}/stats`);

    if (!response.ok) {
      throw new Error(`Blockscout API error: ${response.status} ${response.statusText}`);
    }

    const stats = await response.json();
    return stats;
  } catch (error) {
    console.error('Error fetching Blockscout stats:', error.message);
    throw error;
  }
}

/**
 * Get daily transaction count from Blockscout
 */
export async function getDailyTransactionsFromExplorer() {
  const stats = await fetchBlockscoutStats();
  return parseInt(stats.transactions_today) || 0;
}

/**
 * Get total address count from Blockscout
 */
export async function getTotalAddressesFromExplorer() {
  const stats = await fetchBlockscoutStats();
  return parseInt(stats.total_addresses) || 0;
}

/**
 * Get all-time transaction count from Blockscout
 */
export async function getTotalTransactionsFromExplorer() {
  const stats = await fetchBlockscoutStats();
  return parseInt(stats.total_transactions) || 0;
}
