import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

/**
 * Cached file information stored in the database
 */
export interface CachedFile {
  telegram_file_id: string;
  file_type: "photo" | "video" | "animation";
  file_order: number;
  width?: number;
  height?: number;
}

/**
 * Full cached entry with all media files
 */
export interface CachedEntry {
  url: string;
  created_at: number;
  last_used_at: number;
  caption?: string;
  metadata?: Record<string, any>;
  files: CachedFile[];
}

/**
 * Parameters for storing cached media
 */
export interface SetCachedMediaParams {
  url: string;
  files: CachedFile[];
  caption?: string;
  metadata?: Record<string, any>;
}

let db: Database.Database | null = null;
let writeCount = 0;
let maxEntries = 100000;
let evictEveryNWrites = 100;

/**
 * Cache configuration options
 */
export interface CacheConfig {
  dbPath: string;
  maxEntries?: number;
  evictEveryNWrites?: number;
}

/**
 * Initialize the cache database, creating tables if they don't exist
 */
export function initCache(config: CacheConfig): void {
  const dbPath = config.dbPath;
  maxEntries = config.maxEntries ?? 100000;
  evictEveryNWrites = config.evictEveryNWrites ?? 100;
  // Create data directory if it doesn't exist
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache_entries (
      url TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      caption TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS media_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL REFERENCES cache_entries(url) ON DELETE CASCADE,
      telegram_file_id TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_order INTEGER DEFAULT 0,
      width INTEGER,
      height INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_media_files_url ON media_files(url);
    CREATE INDEX IF NOT EXISTS idx_cache_entries_last_used ON cache_entries(last_used_at);
  `);

  console.log(`Cache initialized at ${dbPath}`);
}

/**
 * Get the database instance, throwing if not initialized
 */
function getDb(): Database.Database {
  if (!db) {
    throw new Error("Cache not initialized. Call initCache() first.");
  }
  return db;
}

/**
 * Get cached media for a URL, updating last_used_at timestamp
 * Returns null if not cached
 */
export function getCachedMedia(url: string): CachedEntry | null {
  const database = getDb();

  const entry = database
    .prepare(
      `SELECT url, created_at, last_used_at, caption, metadata
       FROM cache_entries WHERE url = ?`
    )
    .get(url) as
    | {
        url: string;
        created_at: number;
        last_used_at: number;
        caption: string | null;
        metadata: string | null;
      }
    | undefined;

  if (!entry) {
    return null;
  }

  // Update last_used_at
  const now = Date.now();
  database
    .prepare(`UPDATE cache_entries SET last_used_at = ? WHERE url = ?`)
    .run(now, url);

  // Get associated files
  const files = database
    .prepare(
      `SELECT telegram_file_id, file_type, file_order, width, height
       FROM media_files WHERE url = ? ORDER BY file_order`
    )
    .all(url) as Array<{
    telegram_file_id: string;
    file_type: string;
    file_order: number;
    width: number | null;
    height: number | null;
  }>;

  return {
    url: entry.url,
    created_at: entry.created_at,
    last_used_at: now,
    caption: entry.caption ?? undefined,
    metadata: entry.metadata ? JSON.parse(entry.metadata) : undefined,
    files: files.map((f) => ({
      telegram_file_id: f.telegram_file_id,
      file_type: f.file_type as "photo" | "video" | "animation",
      file_order: f.file_order,
      width: f.width ?? undefined,
      height: f.height ?? undefined,
    })),
  };
}

/**
 * Store cached media for a URL
 * Overwrites any existing entry for the same URL
 */
export function setCachedMedia(params: SetCachedMediaParams): void {
  const database = getDb();
  const { url, files, caption, metadata } = params;

  const now = Date.now();

  // Use a transaction for atomicity
  const transaction = database.transaction(() => {
    // Delete existing entry (cascades to media_files)
    database.prepare(`DELETE FROM cache_entries WHERE url = ?`).run(url);

    // Insert new entry
    database
      .prepare(
        `INSERT INTO cache_entries (url, created_at, last_used_at, caption, metadata)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        url,
        now,
        now,
        caption ?? null,
        metadata ? JSON.stringify(metadata) : null
      );

    // Insert files
    const insertFile = database.prepare(
      `INSERT INTO media_files (url, telegram_file_id, file_type, file_order, width, height)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    for (const file of files) {
      insertFile.run(
        url,
        file.telegram_file_id,
        file.file_type,
        file.file_order,
        file.width ?? null,
        file.height ?? null
      );
    }
  });

  transaction();

  // Track writes and trigger eviction periodically
  writeCount++;
  if (writeCount >= evictEveryNWrites) {
    writeCount = 0;
    evictOldEntries(maxEntries);
  }
}

/**
 * Evict oldest entries when cache exceeds maxEntries
 * Deletes entries with oldest last_used_at timestamps
 */
export function evictOldEntries(maxEntries: number): number {
  const database = getDb();

  // Count current entries
  const countResult = database
    .prepare(`SELECT COUNT(*) as count FROM cache_entries`)
    .get() as { count: number };

  const currentCount = countResult.count;

  if (currentCount <= maxEntries) {
    return 0;
  }

  const toDelete = currentCount - maxEntries;

  // Delete oldest entries by last_used_at
  const result = database
    .prepare(
      `DELETE FROM cache_entries WHERE url IN (
        SELECT url FROM cache_entries ORDER BY last_used_at ASC LIMIT ?
      )`
    )
    .run(toDelete);

  if (result.changes > 0) {
    console.log(`Cache eviction: removed ${result.changes} old entries`);
  }

  return result.changes;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { entryCount: number; fileCount: number } {
  const database = getDb();

  const entryCount = (
    database.prepare(`SELECT COUNT(*) as count FROM cache_entries`).get() as {
      count: number;
    }
  ).count;

  const fileCount = (
    database.prepare(`SELECT COUNT(*) as count FROM media_files`).get() as {
      count: number;
    }
  ).count;

  return { entryCount, fileCount };
}

/**
 * Close the database connection
 */
export function closeCache(): void {
  if (db) {
    db.close();
    db = null;
  }
}
