import { afterEach, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { Server } from 'node:http';
import { startServer } from '../server';
import { initAnalytics, closeAnalytics, logEvent } from '../analytics';
let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve, reject) => server!.close(err => err ? reject(err) : resolve())); closeAnalytics(); });
it('serves backend analytics only to authenticated requests', async () => {
  initAnalytics(':memory:');
  logEvent({ url: 'https://example.com', domain: 'example.com', chat_id: 1, chat_title: 'Test', user_id: 1, success: true, file_count: 1,
    source: 'yt-dlp', is_fallback: false, attempts: [{ source: 'yt-dlp', outcome: 'success' }] });
  const token = 'test-only-token';
  server = startServer(token, 0);
  if (!server.listening) await new Promise(resolve => server!.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/activity/sources`;
  expect((await fetch(url)).status).toBe(401);
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 1 }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', key).update(check).digest('hex'));
  const response = await fetch(url, { headers: { Authorization: params.toString() } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ source: 'yt-dlp', attempts: 1, successful: 1, rescued: 0, failed: 0 }]);
});
