import { PrismaClient } from "@prisma/client";
import { memoryPrisma } from "./dev/memoryPrisma.js";

// Single shared Prisma client for the process. Reused across the API server,
// the bid-window worker, and scripts so we don't open a pool per import.
//
// Dev affordance: with USE_FAKE_DB=1 (see `npm run dev:fake`) the real app runs
// against an in-memory store instead of Postgres. Production leaves the flag
// unset and gets a real PrismaClient.
export const prisma =
  process.env.USE_FAKE_DB === "1"
    ? (memoryPrisma as unknown as PrismaClient)
    : new PrismaClient();
