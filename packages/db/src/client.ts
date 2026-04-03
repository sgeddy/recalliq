import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

const connectionString =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:password@localhost:5432/recalliq";

// NOTE: Pool is used rather than a single Client so the connection can be
// shared across concurrent requests in the API and worker processes.
const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });

export type Db = typeof db;
