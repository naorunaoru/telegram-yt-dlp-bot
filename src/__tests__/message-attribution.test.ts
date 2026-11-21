import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { DownloadTrace } from '../helpers/download-attribution';
const main = readFileSync('src/main.ts', 'utf8');
const start = main.indexOf('bot.on(message("text"), ');
const block = main.slice(start, main.indexOf('\nconst initializeBot', start)).trim();
const code = ts.transpileModule('const handler = ' + block.slice('bot.on(message("text"), '.length, -2) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
async function handle(count: number, oversized = false, deliveryFailure = false) {
  const file = { path: '/tmp/test.mp4', type: 'video', size: oversized ? 999 : 1 };
  const logEvent = vi.fn();
  const context = {
    DownloadTrace, findAllMatches: () => Array.from({ length: count }, (_, i) => ({ url: 'https://x.com/a/status/' + i, pattern: {} })),
    trackChatActivity: () => {}, createTempDir: () => '/tmp/test', cleanupTempDir: () => {}, setInterval: () => 1, clearInterval: () => {},
    console: { log: () => {}, error: () => {} }, formatLog: (_ctx: unknown, m: string) => m,
    redditMediaCacheKey: (value: string) => value, getCachedMedia: () => null, processMediaFiles: async (files: unknown) => files,
    filterByTelegramLimits: (files: unknown[]) => oversized ? [] : files,
    processUrl: async (_ctx: unknown, _url: string, _pattern: unknown, _dir: string, trace: DownloadTrace) => {
      try { await trace.run('gallery-dl', async () => { throw new Error('failed'); }, Boolean); } catch {}
      return trace.run('fxtwitter', async () => ({ files: [file], metadata: {} }), Boolean);
    },
    buildCaption: () => '', sendMediaAlbum: async () => { if (deliveryFailure) throw new Error('Telegram delivery failed'); return []; }, setCachedMedia: () => {},
    logEvent, extractDomain: () => 'x.com', getChatTitle: () => 'Test', isVerbose: () => false,
    MAX_PHOTO_SIZE: 100, MAX_VIDEO_SIZE: 100, reactSadOnFailure: async () => {}, isPrivateChat: () => false, VERBOSE_GROUPS: false,
  };
  const handler = runInNewContext(code + '\nhandler;', context);
  await handler({ message: { text: 'urls', message_id: 1 }, chat: { id: 1 }, from: { id: 1 }, sendChatAction: async () => {} });
  return logEvent.mock.calls.map(call => call[0]);
}
describe('message event attribution', () => {
  it.each([1, 2])('preserves failed-delivery attribution for %i URL(s) without counting rescues', async count => {
    const events = await handle(count, false, true);
    expect(events).toHaveLength(count);
    for (const event of events) expect(event).toMatchObject({ success: false, source: 'fxtwitter', file_count: 0 });
  });

  it.each([1, 2])('logs attribution separately for %i URL(s)', async count => {
    const events = await handle(count);
    expect(events).toHaveLength(count);
    for (const event of events) expect(event).toMatchObject({ success: true, source: 'fxtwitter', is_fallback: true, attempts: [
      { source: 'gallery-dl', outcome: 'failed' }, { source: 'fxtwitter', outcome: 'success' },
    ] });
  });
  it.each([1, 2])('does not count oversized files as rescued for %i URL(s)', async count => {
    const events = await handle(count, true);
    expect(events).toHaveLength(count);
    expect(events.every(event => event.success === false && event.file_count === 0)).toBe(true);
  });
});
