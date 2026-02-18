import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

let db: Database.Database | null = null;

/**
 * Parameters for logging a download event
 */
export interface LogEventParams {
  url: string;
  domain: string;
  chat_id: number;
  chat_title: string;
  user_id: number;
  success: boolean;
  file_count: number;
  error_message?: string;
}

/**
 * Parameters for tracking chat activity
 */
export interface TrackChatParams {
  chat_id: number;
  chat_title: string;
  chat_type: string;
}

/**
 * Overall statistics
 */
export interface Stats {
  total_downloads: number;
  successful_downloads: number;
  failed_downloads: number;
  success_rate: number;
  active_chats: number;
  total_files: number;
}

/**
 * Initialize analytics tables in the shared database
 */
export function initAnalytics(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      domain TEXT NOT NULL,
      chat_id INTEGER NOT NULL,
      chat_title TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      success INTEGER NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS chats (
      chat_id INTEGER PRIMARY KEY,
      chat_title TEXT NOT NULL,
      chat_type TEXT NOT NULL,
      first_seen INTEGER NOT NULL,
      last_active INTEGER NOT NULL,
      download_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_domain ON events(domain);
    CREATE INDEX IF NOT EXISTS idx_events_chat_id ON events(chat_id);
  `);

  console.log("Analytics initialized");
}

/**
 * Get the analytics database instance
 */
function getDb(): Database.Database {
  if (!db) {
    throw new Error("Analytics not initialized. Call initAnalytics() first.");
  }
  return db;
}

/**
 * Log a download event
 */
export function logEvent(params: LogEventParams): void {
  const database = getDb();
  const now = Date.now();

  database
    .prepare(
      `INSERT INTO events (url, domain, chat_id, chat_title, user_id, timestamp, success, file_count, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.url,
      params.domain,
      params.chat_id,
      params.chat_title,
      params.user_id,
      now,
      params.success ? 1 : 0,
      params.file_count,
      params.error_message ?? null
    );

  // Update chat download count
  if (params.success) {
    database
      .prepare(
        `UPDATE chats SET download_count = download_count + 1, last_active = ? WHERE chat_id = ?`
      )
      .run(now, params.chat_id);
  }
}

/**
 * Track chat activity (call on every message processing)
 */
export function trackChat(params: TrackChatParams): void {
  const database = getDb();
  const now = Date.now();

  database
    .prepare(
      `INSERT INTO chats (chat_id, chat_title, chat_type, first_seen, last_active, download_count)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(chat_id) DO UPDATE SET
         chat_title = excluded.chat_title,
         last_active = excluded.last_active`
    )
    .run(params.chat_id, params.chat_title, params.chat_type, now, now);
}

/**
 * Get overall statistics
 */
export function getStats(): Stats {
  const database = getDb();

  const total = (
    database.prepare(`SELECT COUNT(*) as count FROM events`).get() as {
      count: number;
    }
  ).count;

  const successful = (
    database
      .prepare(`SELECT COUNT(*) as count FROM events WHERE success = 1`)
      .get() as { count: number }
  ).count;

  const totalFiles = (
    database
      .prepare(
        `SELECT COALESCE(SUM(file_count), 0) as total FROM events WHERE success = 1`
      )
      .get() as { total: number }
  ).total;

  const activeChats = (
    database.prepare(`SELECT COUNT(*) as count FROM chats`).get() as {
      count: number;
    }
  ).count;

  return {
    total_downloads: total,
    successful_downloads: successful,
    failed_downloads: total - successful,
    success_rate: total > 0 ? Math.round((successful / total) * 100) : 0,
    active_chats: activeChats,
    total_files: totalFiles,
  };
}

/**
 * Get list of active chats with download counts
 */
export function getChats(): Array<{
  chat_id: number;
  chat_title: string;
  chat_type: string;
  first_seen: number;
  last_active: number;
  download_count: number;
}> {
  const database = getDb();
  return database
    .prepare(
      `SELECT chat_id, chat_title, chat_type, first_seen, last_active, download_count
       FROM chats ORDER BY last_active DESC`
    )
    .all() as any;
}

/**
 * Get recent download activity
 */
export function getRecentActivity(
  limit: number = 50
): Array<{
  url: string;
  domain: string;
  chat_id: number;
  chat_title: string;
  user_id: number;
  timestamp: number;
  success: boolean;
  file_count: number;
  error_message: string | null;
}> {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT url, domain, chat_id, chat_title, user_id, timestamp, success, file_count, error_message
       FROM events ORDER BY timestamp DESC LIMIT ?`
    )
    .all(limit) as any[];

  return rows.map((r) => ({ ...r, success: r.success === 1 }));
}

/**
 * Get download counts grouped by domain
 */
export function getActivityByDomain(): Array<{
  domain: string;
  total: number;
  successful: number;
}> {
  const database = getDb();
  return database
    .prepare(
      `SELECT domain, COUNT(*) as total, SUM(success) as successful
       FROM events GROUP BY domain ORDER BY total DESC`
    )
    .all() as any;
}

/**
 * Get daily download counts for the last N days
 */
export function getDailyActivity(
  days: number = 30
): Array<{ date: string; total: number; successful: number }> {
  const database = getDb();
  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  return database
    .prepare(
      `SELECT
         date(timestamp / 1000, 'unixepoch') as date,
         COUNT(*) as total,
         SUM(success) as successful
       FROM events
       WHERE timestamp >= ?
       GROUP BY date
       ORDER BY date ASC`
    )
    .all(since) as any;
}

/**
 * Close the analytics database connection
 */
export function closeAnalytics(): void {
  if (db) {
    db.close();
    db = null;
  }
}
