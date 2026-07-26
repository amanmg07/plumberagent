import { log } from "./logger.js";

export interface GeoPoint {
  lat: number;
  lng: number;
}

// STUB. Real implementation will call a geocoding provider (Google, Mapbox,
// Census) — swap the body, keep the signature.
//
// For now this returns a deterministic pseudo-point inside the Seattle
// bounding box derived from the address string, so:
//   - the same address always geocodes to the same point (stable tests)
//   - different addresses spread across the metro (matching has something to
//     discriminate on)
// It never throws for a non-empty string; returns null for empty/whitespace so
// callers can decide how to handle an unresolvable address.
export async function geocode(address: string): Promise<GeoPoint | null> {
  const trimmed = address.trim();
  if (trimmed === "") {
    log.warn("geocode.empty_address");
    return null;
  }

  // Simple deterministic hash → offset within the Seattle box.
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  // Seattle box: lat ~47.48–47.73, lng ~-122.42 to -122.24
  const lat = 47.48 + ((hash % 1000) / 1000) * (47.73 - 47.48);
  const lng = -122.42 + (((hash >> 10) % 1000) / 1000) * (-122.24 - -122.42);

  const point = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
  log.info("geocode.resolved", { address: trimmed, ...point, stub: true });
  return point;
}
