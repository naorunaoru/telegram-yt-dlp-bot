import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createServer, Agent } from 'node:http';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { Telegram } from 'telegraf';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { isTelegramServerError, withTelegramRetry } from '../helpers/telegram-retry';

const main = readFileSync('src/main.ts', 'utf8');
const start = main.includes('const retryTelegramSend =') ? main.indexOf('const retryTelegramSend =') : main.indexOf('const sendCachedMedia =');
const code = ts.transpileModule(main.slice(start, main.indexOf('const downloadDirectMediaUrls =')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const serverError = { response: { error_code: 500, description: 'Internal Server Error' } };
function setup() {
  const sleep = vi.fn(async (_delay: number) => {});
  const { sendMediaAlbum, sendCachedMedia } = runInNewContext(code + '\n({sendMediaAlbum, sendCachedMedia});', {
    path, fs: { createReadStream: vi.fn(() => ({ consumed: false })) },
    withTelegramRetry: (send: () => Promise<unknown>, options: object) => withTelegramRetry(send, { ...options, sleep }),
    isTelegramServerError, console: { error: vi.fn(), warn: vi.fn() },
    formatLog: (_ctx: unknown, text: string) => text,
    MAX_MEDIA_GROUP: 10,
    chunkArray: (items: unknown[], size: number) => Array.from({length: Math.ceil(items.length / size)}, (_, i) => items.slice(i * size, (i + 1) * size)),
    extractFileIdFromMessage: (msg: { id: number }, order: number) => ({ telegram_file_id: String(msg.id), file_order: order }),
  });
  return { sendMediaAlbum, sendCachedMedia, sleep };
}

describe('Telegram media delivery retry wiring', () => {
  it.each(['photo', 'video', 'album'])('re-uploads complete %s bytes through real Telegraf multipart serialization', async kind => {
    const dir = mkdtempSync(path.join(tmpdir(), 'telegram-retry-'));
    const mediaBytes = Buffer.from('test-media-fixture-'.repeat(8192));
    const thumbBytes = Buffer.from('test-thumbnail-fixture');
    const file = path.join(dir, 'media.mp4');
    const thumb = path.join(dir, 'thumb.jpg');
    writeFileSync(file, mediaBytes);
    writeFileSync(thumb, thumbBytes);
    const bodies: Buffer[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      bodies.push(Buffer.concat(chunks));
      const failed = bodies.length === 1;
      res.writeHead(failed ? 500 : 200, {'content-type': 'application/json'});
      res.end(JSON.stringify(failed ? {ok: false, error_code: 500, description: 'Internal Server Error'} : {ok: true, result: kind === 'album' ? [{id: 1}, {id: 2}] : {id: 1}}));
    });
    const agent = new Agent();
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address() as {port: number};
      const telegram = new Telegram('123:local-test-only', {apiRoot: `http://127.0.0.1:${address.port}`, agent});
      const ctx = {
        replyWithPhoto: (input: any, options: any) => telegram.sendPhoto(1, input, options),
        replyWithVideo: (input: any, options: any) => telegram.sendVideo(1, input, options),
        replyWithMediaGroup: (input: any, options: any) => telegram.sendMediaGroup(1, input, options),
      };
      const files = [{path: file, type: kind === 'photo' ? 'photo' : 'video', size: mediaBytes.length, thumbnailPath: thumb}];
      if (kind === 'album') files.push({...files[0]});
      await setup().sendMediaAlbum(ctx, files, 5, 'caption');
      expect(bodies).toHaveLength(2);
      for (const body of bodies) {
        expect(body.includes(mediaBytes)).toBe(true);
        if (kind !== 'photo') expect(body.includes(thumbBytes)).toBe(true);
      }
    } finally {
      agent.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
      rmSync(dir, {recursive: true, force: true});
    }
  });

  it('retries a failed video upload with a fresh file payload and thumbnail', async () => {
    const { sendMediaAlbum, sleep } = setup();
    const payloads: any[] = [];
    const ctx = { replyWithVideo: vi.fn(async (media, options) => {
      payloads.push({ media, options });
      if (payloads.length === 1) throw serverError;
      return { id: 42 };
    }) };
    const result = await sendMediaAlbum(ctx, [{ path: '/tmp/video.mp4', type: 'video', size: 1, thumbnailPath: '/tmp/thumb.jpg', width: 320, height: 240 }], 5, 'caption');
    expect(ctx.replyWithVideo).toHaveBeenCalledTimes(2);
    expect(payloads[1].media).not.toBe(payloads[0].media);
    expect(payloads[1].media.source).toBe('/tmp/video.mp4');
    expect(payloads[1].options.thumbnail.source).toBe('/tmp/thumb.jpg');
    expect(payloads[1].options).toMatchObject({reply_to_message_id: 5, caption: 'caption', width: 320, height: 240});
    expect(result).toEqual([{ telegram_file_id: '42', file_order: 0 }]);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
  it('retries photos with a fresh upload payload', async () => {
    const { sendMediaAlbum } = setup();
    const ctx = { replyWithPhoto: vi.fn().mockRejectedValueOnce(serverError).mockResolvedValue({ id: 7 }) };
    await sendMediaAlbum(ctx, [{ path: '/tmp/photo.jpg', type: 'photo', size: 1 }], 5);
    expect(ctx.replyWithPhoto).toHaveBeenCalledTimes(2);
    expect(ctx.replyWithPhoto.mock.calls[1][0].source).toBe('/tmp/photo.jpg');
  });

  it('retries only the failed album chunk, rebuilding all video and thumbnail inputs', async () => {
    const { sendMediaAlbum } = setup();
    const calls: any[][] = [];
    const ctx = { replyWithMediaGroup: vi.fn(async (media: any[]) => {
      calls.push(media);
      if (calls.length === 2) throw serverError;
      return media.map((_file, index) => ({ id: calls.length * 100 + index }));
    }) };
    const files = Array.from({length: 12}, (_, i) => ({ path: `/tmp/${i}.mp4`, type: 'video', size: 1, thumbnailPath: `/tmp/${i}.jpg` }));
    const result = await sendMediaAlbum(ctx, files, 5, 'caption');
    expect(calls.map(c => c.length)).toEqual([10, 2, 2]);
    expect(calls[0][0].caption).toBe('caption');
    expect(calls[2][0].caption).toBeUndefined();
    expect(calls[2][0].media.source).toBe('/tmp/10.mp4');
    expect(calls[2][0].thumbnail.source).toBe('/tmp/10.jpg');
    expect(calls[2][0].media).not.toBe(calls[1][0].media);
    expect(result.map((f: any) => f.file_order)).toEqual(Array.from({length: 12}, (_, i) => i));
  });

  it.each(['photo', 'video', 'animation'])('retries cached %s without downloading again', async type => {
    const { sendCachedMedia } = setup();
    const send = vi.fn().mockRejectedValueOnce(serverError).mockResolvedValue({ id: 7 });
    const ctx = { replyWithPhoto: send, replyWithVideo: send, replyWithAnimation: send };
    expect(await sendCachedMedia(ctx, {files: [{file_type: type, telegram_file_id: 'cached'}], caption: 'caption'}, 5)).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toBe('cached');
  });

  it('retries only a failed cached album chunk', async () => {
    const { sendCachedMedia } = setup();
    const send = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(serverError).mockResolvedValueOnce([]);
    expect(await sendCachedMedia({replyWithMediaGroup: send}, {files: Array.from({length: 12}, (_, i) => ({file_type: 'photo', telegram_file_id: String(i)}))}, 5)).toBe(true);
    expect(send.mock.calls.map(c => c[0].length)).toEqual([10, 2, 2]);
  });

  it('does not treat exhausted cached server errors as invalid file IDs', async () => {
    const { sendCachedMedia } = setup();
    const send = vi.fn().mockRejectedValue(serverError);
    await expect(sendCachedMedia({replyWithVideo: send}, {files: [{file_type: 'video', telegram_file_id: 'cached'}]}, 5)).rejects.toBe(serverError);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('still falls back from invalid cached IDs without retrying permanent errors', async () => {
    const { sendCachedMedia } = setup();
    const send = vi.fn().mockRejectedValue({response: {error_code: 400}, message: 'invalid file ID'});
    expect(await sendCachedMedia({replyWithVideo: send}, {files: [{file_type: 'video', telegram_file_id: 'bad'}]}, 5)).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });
});
