import type { Job, Provider } from "@prisma/client";
import { haversineMiles } from "../lib/geo.js";

export interface EligibleMatch {
  provider: Provider;
  distanceMiles: number;
}

export interface MatchOptions {
  // Emergency dispatch requires a verified provider; the standard auction does
  // not (an unverified provider can still bid). Flip standard to requireVerified
  // if the pilot should only ever route to verified plumbers.
  requireVerified: boolean;
  // Cap on how many providers to return (nearest-first). Emergency fans out to
  // a few; standard opens the auction to 5.
  limit: number;
}

// Pure, DB-free provider matching — the heart of dispatch, kept side-effect-free
// so it's trivially testable. A provider is eligible when they:
//   - are available
//   - are verified (only when required)
//   - list the job's category in their specialties
//   - cover the job's location within their own service radius
// Results are sorted nearest-first and capped at opts.limit.
//
// If the job has no coordinates (geocode failed), matching returns [] — we
// can't rank by distance without them.
export function findEligibleProviders(
  job: Pick<Job, "lat" | "lng" | "category">,
  providers: Provider[],
  opts: MatchOptions,
): EligibleMatch[] {
  if (job.lat == null || job.lng == null) return [];
  const jobPoint = { lat: job.lat, lng: job.lng };

  const matches: EligibleMatch[] = [];
  for (const provider of providers) {
    if (!provider.isAvailable) continue;
    if (opts.requireVerified && !provider.isVerified) continue;
    if (!provider.specialties.includes(job.category)) continue;

    const distanceMiles = haversineMiles(jobPoint, {
      lat: provider.homeLat,
      lng: provider.homeLng,
    });
    // The provider's radius must reach the job.
    if (distanceMiles > provider.serviceRadiusMiles) continue;

    matches.push({ provider, distanceMiles });
  }

  matches.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return matches.slice(0, opts.limit);
}
