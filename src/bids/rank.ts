import type { Bid } from "@prisma/client";

// How many ranked options the homeowner is shown / can pick from. Shared by
// step 6 (quote the top N) and step 7 (validate the 1..N selection) so they
// never disagree.
export const TOP_N = 3;

// Deterministic total ordering of bids, best-first. Cheapest price wins; ties
// break by sooner ETA, then earlier submission, then id as a final stable
// tiebreaker.
//
// Shared by step 6 (pick the top 3 to quote) and step 7 (map the homeowner's
// "1"/"2"/"3" reply back to a specific bid). Because bids are frozen once the
// window closes, ranking the same set again yields the same order — so option N
// means the same bid at quote time and at acceptance time, with no need to
// persist the ordering.
export function rankBids(bids: Bid[]): Bid[] {
  return [...bids].sort((a, b) => {
    if (a.priceCents !== b.priceCents) return a.priceCents - b.priceCents;
    if (a.etaMinutes !== b.etaMinutes) return a.etaMinutes - b.etaMinutes;
    const at = a.createdAt.getTime();
    const bt = b.createdAt.getTime();
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
