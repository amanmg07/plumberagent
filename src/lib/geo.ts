export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in miles between two points (haversine). Good enough
// for "is this provider within N miles of the job" — we're not routing, just
// ranking and gating by service radius.
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}
