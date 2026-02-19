import { sql } from 'drizzle-orm';
import { getDatabase } from './connection.js';
import { projects } from './schema/projects.js';
import { tasks } from './schema/tasks.js';
import { sessions } from './schema/sessions.js';
import { auditLogs } from './schema/audit-logs.js';
import { users, userProjectPermissions } from './schema/users.js';
import { offlineQueue } from './schema/offline-queue.js';
import { promptHistory } from './schema/prompt-history.js';
import { apiKeys } from './schema/api-keys.js';
import { netsuiteConfigs } from './schema/netsuite-configs.js';

/**
 * Push schema to database (create tables if not exist).
 * For production, use drizzle-kit migrations instead.
 */
export function pushSchema(dbUrl?: string) {
  const db = getDatabase(dbUrl);

  // Create tables via raw SQL matching our schema
  db.run(sql`CREATE TABLE IF NOT EXISTS ${projects} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slack_channel_id TEXT NOT NULL UNIQUE,
    local_path TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    default_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
    default_max_budget REAL NOT NULL DEFAULT 5.0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  // Add railway columns if they don't exist (migration for existing DBs)
  for (const col of ['railway_project_id', 'railway_service_id', 'railway_environment_id']) {
    try {
      db.run(sql.raw(`ALTER TABLE projects ADD COLUMN ${col} TEXT`));
    } catch {
      // Column already exists, ignore
    }
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS ${tasks} (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    bot_name TEXT NOT NULL,
    command TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    error_message TEXT,
    slack_channel_id TEXT NOT NULL,
    slack_thread_ts TEXT,
    slack_user_id TEXT NOT NULL,
    session_id TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL NOT NULL DEFAULT 0,
    max_budget REAL NOT NULL DEFAULT 5.0,
    files_changed TEXT NOT NULL DEFAULT '[]',
    commands_run TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`);

  // Add columns that may not exist in older DBs (migration for existing DBs)
  for (const col of ['slack_message_ts', 'parent_task_id']) {
    try {
      db.run(sql.raw(`ALTER TABLE tasks ADD COLUMN ${col} TEXT`));
    } catch {
      // Column already exists, ignore
    }
  }

  db.run(sql`CREATE TABLE IF NOT EXISTS ${sessions} (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    agent_id TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost REAL NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ${auditLogs} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    user_id TEXT,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ${users} (
    id TEXT PRIMARY KEY,
    slack_user_id TEXT NOT NULL UNIQUE,
    slack_username TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'developer',
    rate_limit_override INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ${userProjectPermissions} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    project_id TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ${offlineQueue} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    message_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    delivered_at TEXT
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ${promptHistory} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    context TEXT,
    related_files TEXT NOT NULL DEFAULT '[]',
    execution_status TEXT NOT NULL DEFAULT 'pending',
    execution_notes TEXT,
    estimated_duration_minutes INTEGER,
    actual_duration_minutes INTEGER,
    timestamp TEXT NOT NULL,
    completed_at TEXT
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ${apiKeys} (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    last_used_at INTEGER,
    revoked INTEGER NOT NULL DEFAULT 0
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ${netsuiteConfigs} (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    account_number TEXT NOT NULL,
    production_url TEXT NOT NULL,
    sandbox_url TEXT,
    restlet_url TEXT NOT NULL,
    consumer_key TEXT NOT NULL,
    consumer_secret TEXT NOT NULL,
    token_id TEXT NOT NULL,
    token_secret TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`);

  return db;
}
