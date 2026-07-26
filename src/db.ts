import { PrismaClient } from "@prisma/client";

// Single shared Prisma client for the process. Reused across the API server,
// the bid-window worker, and scripts so we don't open a pool per import.
export const prisma = new PrismaClient();
