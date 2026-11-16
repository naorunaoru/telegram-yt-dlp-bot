import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initAnalytics, closeAnalytics, logEvent, getRecentActivity, getSourceStats } from '../analytics';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-analytics-'));
const dbPath = path.join(dir, 'analytics.db');
afterEach(() => { closeAnalytics(); fs.rmSync(dbPath, { force: true }); });
const event = { url: 'https://x.com/test/status/123', domain: 'x.com', chat_id: 1, chat_title: 'Test', user_id: 1, success: true, file_count: 1 };

describe('download source analytics', () => {
  it('migrates a pre-attribution database without inventing historical sources and can reopen it', () => {
    const legacy = new Database(dbPath);
    legacy.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, domain TEXT NOT NULL,
      chat_id INTEGER NOT NULL, chat_title TEXT NOT NULL, user_id INTEGER NOT NULL, timestamp INTEGER NOT NULL,
      success INTEGER NOT NULL, file_count INTEGER NOT NULL DEFAULT 0, error_message TEXT);
      INSERT INTO events (url, domain, chat_id, chat_title, user_id, timestamp, success, file_count)
      VALUES ('https://example.com', 'example.com', 1, 'Test', 1, 1, 1, 1);`);
    legacy.close();
    initAnalytics(dbPath);
    expect(getRecentActivity()[0]).toMatchObject({ source: null, is_fallback: null, attempts: null });
    expect(getSourceStats()).toEqual([]);
    closeAnalytics();
    initAnalytics(dbPath);
    logEvent({ ...event, source: 'gallery-dl', is_fallback: false, attempts: [{ source: 'gallery-dl', outcome: 'success' }] });
    expect(getSourceStats()[0]).toMatchObject({ source: 'gallery-dl', successful: 1, rescued: 0 });
  });

  it('counts real rescues and unsuccessful attempts, excluding failed deliveries and old events', () => {
    initAnalytics(dbPath);
    const attempts = [{ source: 'gallery-dl', outcome: 'failed' as const }, { source: 'yt-dlp', outcome: 'success' as const }];
    logEvent({ ...event, source: 'yt-dlp', is_fallback: true, attempts });
    logEvent({ ...event, success: false, source: 'yt-dlp', is_fallback: true, attempts });
    logEvent({ ...event }); // Legacy/unknown must not inflate a provider's totals.
    const raw = new Database(dbPath);
    raw.prepare('UPDATE events SET timestamp = 0 WHERE id = 3').run();
    raw.close();
    expect(getSourceStats()).toEqual([
      { source: 'gallery-dl', attempts: 2, successful: 0, rescued: 0, failed: 2 },
      { source: 'yt-dlp', attempts: 2, successful: 1, rescued: 1, failed: 0 },
    ]);
  });

  it('persists the winning backend, fallback flag and ordered attempts', () => {
    initAnalytics(dbPath);
    const attribution = { source: 'fxtwitter', is_fallback: true, attempts: [
      { source: 'gallery-dl', outcome: 'failed' },
      { source: 'yt-dlp', outcome: 'failed' },
      { source: 'fxtwitter', outcome: 'success' },
    ] };
    logEvent({ ...event, ...attribution } as any);
    expect(getRecentActivity()[0]).toMatchObject(attribution);
  });
});
