import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/index.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sqlite: Database.Database | null = null;

export function getDatabase(url?: string) {
  if (db) return db;

  const dbPath = url ?? process.env['DATABASE_URL'] ?? './data/bematic.db';
  sqlite = new Database(dbPath);

  // SQLite performance pragmas
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('cache_size = -20000'); // 20MB
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');

  db = drizzle(sqlite, { schema });
  return db;
}

export function closeDatabase() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

export type DB = ReturnType<typeof getDatabase>;
