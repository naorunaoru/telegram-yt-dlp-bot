import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getVxRedditFallback, downloadVxRedditMedia, isVxRedditSupported } from '../helpers/vxreddit';

const url = 'https://www.reddit.com/r/AutoTuga/comments/1xxj8ga/';
const mediaUrl = 'https://i.redd.it/l5kwze2vfx1i1.jpeg';
const html = `<meta property="og:title" content="A &amp; B"><meta property="og:image" content="${mediaUrl}">`;
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

describe('vxreddit fallback', () => {
  it.each(['', '<meta property="og:url" content="https://www.reddit.com/comments/1y1mcuu/">'])('rejects an unresolved share with a generic image preview (%#)', async identity => {
    const embed = `${identity}<meta name="twitter:card" content="summary_large_image"><meta property="og:image" content="${mediaUrl}">`;
    const share = 'https://www.reddit.com/r/youll_be_banned/s/Bd5rDiyc6b';
    expect(await getVxRedditFallback(share, { fetchImpl: async () => new Response(embed, { headers: { 'content-type': 'text/html' } }) })).toBeUndefined();
  });
  it.each(['/r/test/comments/1y1mcuu/comment/19syb90anb7r7/', '/r/test/s/Bd5rDiyc6b'])('extracts a verified comment attachment from %s', async pathname => {
    const attachment = 'https://preview.redd.it/ymzuq6p23w2i1.jpeg?width=1080&auto=webp';
    const embed = `<meta property="og:url" content="https://www.reddit.com/comments/1y1mcuu/_/19syb90anb7r7"><meta name="twitter:card" content="summary"><meta property="og:image" content="${mediaUrl}"><meta property="og:description" content="${attachment.replace('&', '&amp;')}">`;
    const fetchImpl = vi.fn(async () => new Response(embed, { headers: { 'content-type': 'text/html' } }));
    expect((await getVxRedditFallback(`https://www.reddit.com${pathname}`, { fetchImpl }))?.media).toEqual([{ url: attachment, type: 'photo' }]);
    expect(fetchImpl).toHaveBeenCalledWith(`https://vxreddit.com${pathname.includes('/comment/') ? '/r/test/comments/1y1mcuu/_/19syb90anb7r7/' : pathname}?legacy=1`, expect.anything());
  });

  it.each([
    ['https://www.reddit.com/comments/1y1mcuu/', mediaUrl],
    ['https://www.reddit.com/comments/1y1mcuu/_/other/', mediaUrl],
    ['https://www.reddit.com/comments/1y1mcuu/_/19syb90anb7r7/', 'https://preview.redd.it.evil.test/photo.jpg'],
    ['https://www.reddit.com/comments/1y1mcuu/_/19syb90anb7r7/', `Some text and ${mediaUrl}`],
  ])('never returns parent media or unverified description images (%#)', async (identity, attachment) => {
    const embed = `<meta property="og:url" content="${identity}"><meta name="twitter:card" content="summary"><meta property="og:image" content="${mediaUrl}"><meta property="og:description" content="${attachment}">`;
    const comment = 'https://www.reddit.com/comments/1y1mcuu/comment/19syb90anb7r7/';
    expect(await getVxRedditFallback(comment, { fetchImpl: async () => new Response(embed, { headers: { 'content-type': 'text/html' } }) })).toBeUndefined();
  });

  it('cancels an oversized embed response before rejecting it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    await expect(getVxRedditFallback(url, { fetchImpl: async () => new Response(body, { headers: { 'content-type': 'text/html', 'content-length': '524289' } }) })).rejects.toThrow('too large');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not mistake an external link thumbnail for the post media', async () => {
    const embed = `<meta name="twitter:card" content="summary"><meta property="og:image" content="${mediaUrl}">`;
    expect(await getVxRedditFallback(url, { fetchImpl: async () => new Response(embed, { headers: { 'content-type': 'text/html' } }) })).toBeUndefined();
  });

  it('follows only the verified vxreddit video renderer while preserving audio', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vxreddit-test-')); directories.push(directory);
    const video = 'https://vxreddit.com/redditvideo.mp4?video_url=https%3A%2F%2Fv.redd.it%2Fabc%2FCMAF_360.m3u8&audio_url=https%3A%2F%2Fv.redd.it%2Fabc%2FCMAF_AUDIO_128.m3u8';
    const renderer = 'https://ujzvxmd24pyrqqrffpjzcrw6240jjoio.lambda-url.us-east-1.on.aws/?video_url=https%3A%2F%2Fv.redd.it%2Fabc%2FCMAF_360.m3u8&audio_url=https%3A%2F%2Fv.redd.it%2Fabc%2FCMAF_AUDIO_128.m3u8';
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 307, headers: { location: renderer } }))
      .mockResolvedValueOnce(new Response('', { status: 307, headers: { location: 'https://renders.vxreddit.com/abc.mp4' } }))
      .mockResolvedValueOnce(new Response('mp4-test-bytes', { headers: { 'content-type': 'video/mp4' } }));
    const files = await downloadVxRedditMedia([{ url: video, type: 'video' }], directory, { fetchImpl });
    expect(files[0].type).toBe('video');
    expect(fetchImpl).toHaveBeenNthCalledWith(2, renderer, expect.objectContaining({ redirect: 'manual' }));
  });

  it('preserves gallery order and decodes entities in either attribute order', async () => {
    const embed = `<meta content='https://i.redd.it/one.jpg?x=1&amp;y=2' property='og:image'><meta property="og:image" content="https://i.redd.it/two.png"><meta property="og:image" content="https://i.redd.it/two.png">`;
    const result = await getVxRedditFallback(url, { fetchImpl: async () => new Response(embed, { headers: { 'content-type': 'text/html' } }) });
    expect(result?.media.map(item => item.url)).toEqual(['https://i.redd.it/one.jpg?x=1&y=2', 'https://i.redd.it/two.png']);
  });
  it('uses muxed video with audio rather than its poster image', async () => {
    const video = 'https://vxreddit.com/redditvideo.mp4?video_url=https%3A%2F%2Fv.redd.it%2Fabc%2FDASH_720.mp4&audio_url=https%3A%2F%2Fv.redd.it%2Fabc%2FDASH_AUDIO.mp4';
    const embed = `<meta property="og:video" content="${video}"><meta property="og:image" content="${mediaUrl}">`;
    const result = await getVxRedditFallback(url, { fetchImpl: async () => new Response(embed, { headers: { 'content-type': 'text/html' } }) });
    expect(result?.media).toEqual([{ url: video, type: 'video' }]);
  });
  it.each(['https://reddit.com.evil.example/comments/123', 'https://user:pass@reddit.com/comments/123', 'https://reddit.com:8443/comments/123', 'https://example.com/comments/123', 'https://reddit.com/settings'])('rejects unsupported input %s without a request', async value => {
    const fetchImpl = vi.fn();
    expect(isVxRedditSupported(value)).toBe(false);
    expect(await getVxRedditFallback(value, { fetchImpl })).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['http://i.redd.it/test.jpg', 'https://127.0.0.1/a.jpg', 'https://i.redd.it.evil.example/a.jpg', 'https://user:secret@i.redd.it/a.jpg'])('rejects unsafe media %s', async value => {
    await expect(getVxRedditFallback(url, { fetchImpl: async () => new Response(`<meta property="og:image" content="${value}">`, { headers: { 'content-type': 'text/html' } }) })).rejects.toThrow('unsupported media URL');
  });
  it('does not replace an unsafe video with a safe thumbnail', async () => {
    await expect(getVxRedditFallback(url, { fetchImpl: async () => new Response(`<meta property="og:video" content="https://evil.example/a.mp4"><meta property="og:image" content="${mediaUrl}">`, { headers: { 'content-type': 'text/html' } }) })).rejects.toThrow();
  });
  it('returns no media for an error page even if it is HTTP 200', async () => {
    expect(await getVxRedditFallback(url, { fetchImpl: async () => new Response('Failed to get data from Reddit', { headers: { 'content-type': 'text/html' } }) })).toBeUndefined();
  });
  it('does not follow embed redirects or accept oversized embed pages', async () => {
    await expect(getVxRedditFallback(url, { fetchImpl: async () => new Response('', { status: 302, headers: { location: 'http://localhost/' } }) })).rejects.toThrow('HTTP 302');
    await expect(getVxRedditFallback(url, { fetchImpl: async () => new Response('x'.repeat(524289), { headers: { 'content-type': 'text/html' } }) })).rejects.toThrow('too large');
  });
  it('blocks unsafe media redirects before making another request', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vxreddit-test-')); directories.push(directory);
    const fetchImpl = vi.fn(async () => new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }));
    await expect(downloadVxRedditMedia([{ url: mediaUrl, type: 'photo' }], directory, { fetchImpl })).rejects.toThrow('Unsafe');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('rejects HTML masquerading as a media download', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vxreddit-test-')); directories.push(directory);
    await expect(downloadVxRedditMedia([{ url: mediaUrl, type: 'photo' }], directory, { fetchImpl: async () => new Response('<html>Blocked</html>', { headers: { 'content-type': 'text/html' } }) })).rejects.toThrow('content type');
    expect(await fs.readdir(directory)).toEqual([]);
  });
  it('enforces the streamed size limit and cleans up partial files', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vxreddit-test-')); directories.push(directory);
    await expect(downloadVxRedditMedia([{ url: mediaUrl, type: 'photo' }], directory, { fetchImpl: async () => new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/jpeg' } }) })).rejects.toThrow('size limits');
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it('downloads media anonymously into the request directory', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vxreddit-test-'));
    directories.push(directory);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const fetchImpl = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }));
    const files = await downloadVxRedditMedia([{ url: mediaUrl, type: 'photo' }], directory, { fetchImpl });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ type: 'photo', size: bytes.length });
    expect(path.dirname(files[0].path)).toBe(directory);
    expect(await fs.readFile(files[0].path)).toEqual(bytes);
    expect(fetchImpl.mock.calls[0]).toEqual([mediaUrl, expect.objectContaining({ redirect: 'manual' })]);
    expect((fetchImpl.mock.calls as any)[0][1].headers).toBeUndefined();
  });

  it('requests the legacy embed anonymously and extracts the reported image', async () => {
    const fetchImpl = vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    expect(await getVxRedditFallback(url, { fetchImpl })).toEqual({ caption: 'A & B', media: [{ url: mediaUrl, type: 'photo' }] });
    expect(fetchImpl).toHaveBeenCalledWith('https://vxreddit.com/r/AutoTuga/comments/1xxj8ga/?legacy=1', expect.objectContaining({
      redirect: 'manual', headers: { 'user-agent': 'Discordbot/2.0', accept: 'text/html' },
    }));
  });
});
