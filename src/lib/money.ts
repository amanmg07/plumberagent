// Format a cents amount as a dollar string: 18000 -> "$180", 18050 -> "$180.50".
export function formatUsd(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
