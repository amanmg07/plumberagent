// Five verified, available plumbers around Seattle with wide radii, so any
// geocoded demo address matches all of them. Seeded into the in-memory store by
// the dev server. Phones are what you use as the `From` field when simulating
// provider SMS replies.
export const sampleProviders = [
  { name: "Ballard Rapid Plumbing", phone: "+12065550101", specialties: ["plumbing"], homeLat: 47.668, homeLng: -122.383, serviceRadiusMiles: 50, isVerified: true, isAvailable: true },
  { name: "Capitol Hill Pipeworks", phone: "+12065550102", specialties: ["plumbing"], homeLat: 47.623, homeLng: -122.312, serviceRadiusMiles: 50, isVerified: true, isAvailable: true },
  { name: "West Seattle Drain Co", phone: "+12065550103", specialties: ["plumbing"], homeLat: 47.571, homeLng: -122.387, serviceRadiusMiles: 50, isVerified: true, isAvailable: true },
  { name: "Fremont Fix-It Plumbing", phone: "+12065550104", specialties: ["plumbing"], homeLat: 47.651, homeLng: -122.35, serviceRadiusMiles: 50, isVerified: true, isAvailable: true },
  { name: "Green Lake Emergency Plumbing", phone: "+12065550105", specialties: ["plumbing"], homeLat: 47.679, homeLng: -122.334, serviceRadiusMiles: 50, isVerified: true, isAvailable: true },
];
