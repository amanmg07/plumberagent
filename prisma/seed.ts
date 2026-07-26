import { prisma } from "../src/db.js";

// ~10 fake plumbers scattered around a Seattle bounding box so matching and
// dispatch can be exercised end to end. Downtown Seattle is roughly
// (47.6062, -122.3321). Home coords below sit within a ~15mi spread of it.
//
// Mix is intentional:
//   - most are verified + available plumbers (the happy path)
//   - one is unverified (should never win an emergency dispatch)
//   - one is unavailable (should be skipped)
//   - one has a tiny radius (should fall out of range for far jobs)
//   - one does only "hvac" (specialty mismatch for a plumbing job)

const providers = [
  {
    name: "Ballard Rapid Plumbing",
    phone: "+12065550101",
    specialties: ["plumbing", "drain"],
    homeLat: 47.6688,
    homeLng: -122.3831,
    serviceRadiusMiles: 12,
    isVerified: true,
    isAvailable: true,
  },
  {
    name: "Capitol Hill Pipeworks",
    phone: "+12065550102",
    specialties: ["plumbing", "water_heater"],
    homeLat: 47.6231,
    homeLng: -122.3123,
    serviceRadiusMiles: 10,
    isVerified: true,
    isAvailable: true,
  },
  {
    name: "West Seattle Drain Co",
    phone: "+12065550103",
    specialties: ["plumbing", "drain", "sewer"],
    homeLat: 47.5707,
    homeLng: -122.3868,
    serviceRadiusMiles: 15,
    isVerified: true,
    isAvailable: true,
  },
  {
    name: "Fremont Fix-It Plumbing",
    phone: "+12065550104",
    specialties: ["plumbing"],
    homeLat: 47.6510,
    homeLng: -122.3500,
    serviceRadiusMiles: 8,
    isVerified: true,
    isAvailable: true,
  },
  {
    name: "Rainier Valley Plumbers",
    phone: "+12065550105",
    specialties: ["plumbing", "water_heater"],
    homeLat: 47.5390,
    homeLng: -122.2680,
    serviceRadiusMiles: 12,
    isVerified: true,
    isAvailable: true,
  },
  {
    name: "Green Lake Emergency Plumbing",
    phone: "+12065550106",
    specialties: ["plumbing", "emergency"],
    homeLat: 47.6790,
    homeLng: -122.3340,
    serviceRadiusMiles: 20,
    isVerified: true,
    isAvailable: true,
  },
  {
    name: "Queen Anne Waterworks",
    phone: "+12065550107",
    specialties: ["plumbing", "drain"],
    homeLat: 47.6370,
    homeLng: -122.3570,
    serviceRadiusMiles: 10,
    isVerified: true,
    isAvailable: true,
  },
  // Unverified — should be excluded from emergency dispatch (verified only).
  {
    name: "Discount Pipes (unverified)",
    phone: "+12065550108",
    specialties: ["plumbing"],
    homeLat: 47.6100,
    homeLng: -122.3200,
    serviceRadiusMiles: 25,
    isVerified: false,
    isAvailable: true,
  },
  // Unavailable — should be skipped by all matching.
  {
    name: "Northgate Plumbing (busy)",
    phone: "+12065550109",
    specialties: ["plumbing", "sewer"],
    homeLat: 47.7070,
    homeLng: -122.3260,
    serviceRadiusMiles: 15,
    isVerified: true,
    isAvailable: false,
  },
  // Wrong specialty (HVAC only) — should never match a plumbing job.
  {
    name: "Eastside HVAC Only",
    phone: "+12065550110",
    specialties: ["hvac"],
    homeLat: 47.6100,
    homeLng: -122.2000,
    serviceRadiusMiles: 30,
    isVerified: true,
    isAvailable: true,
  },
  // Tiny radius, far south — in range only for very close jobs.
  {
    name: "Tukwila Local Plumbing",
    phone: "+12065550111",
    specialties: ["plumbing", "drain"],
    homeLat: 47.4740,
    homeLng: -122.2610,
    serviceRadiusMiles: 3,
    isVerified: true,
    isAvailable: true,
  },
];

async function main() {
  // Upsert on the unique phone so re-running the seed is idempotent.
  for (const p of providers) {
    await prisma.provider.upsert({
      where: { phone: p.phone },
      update: p,
      create: p,
    });
  }
  const count = await prisma.provider.count();
  console.log(`Seeded providers. Total in DB: ${count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
