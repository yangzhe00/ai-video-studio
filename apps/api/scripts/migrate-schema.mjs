import { migrateSchema } from "../src/db.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
await migrateSchema(process.env.DATABASE_URL);
process.stdout.write("PostgreSQL schema migration completed\n");
