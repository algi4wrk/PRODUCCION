/**
 * Database connection.
 *
 * SQLite for development; the target is Postgres/Supabase. Drizzle keeps the
 * query layer portable, so migrating should touch this file and schema.ts only.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.ts';

/**
 * The database file, `data/produccion.db` at the top of the project.
 *
 * Beside the app rather than inside it: the folder that holds the code is
 * replaced wholesale on every deploy, and a database living in it would go with
 * it. Keeping the two apart also makes the backup obvious — copy `data/`.
 *
 * The default is relative to `app/`, which is where everything that runs
 * locally starts from: `npm run dev`, the seed, the checks. The launcher sets
 * the variable to an absolute path instead, because a process started from the
 * wrong directory would otherwise open a *new*, empty database and look for all
 * the world as though the data had disappeared.
 */
const DB_PATH = process.env.DATABASE_PATH ?? '../data/produccion.db';

const sqlite = new Database(DB_PATH);

// WAL lets reads proceed during writes, which matters once several operators
// are logging events at once.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
