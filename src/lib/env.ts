// Side-effect import: loads variables from a .env file into process.env.
// Import this FIRST (before anything that reads process.env at module load,
// e.g. src/lib/anthropic.ts) in every runnable entry point.
//
// Prisma loads .env on its own for DATABASE_URL, but the Anthropic SDK and PORT
// need this. Missing .env is fine — dotenv silently no-ops.
import { config } from "dotenv";

config();
