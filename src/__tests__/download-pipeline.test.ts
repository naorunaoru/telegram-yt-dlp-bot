import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { DownloadTrace } from '../helpers/download-attribution';
import { isVxRedditSupported } from '../helpers/vxreddit';

const main = readFileSync('src/main.ts', 'utf8');
const code = ts.transpileModule(main.slice(main.indexOf('const processUrl = async'), main.indexOf('/**\n * Build caption')), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function pipeline(overrides: Record<string, unknown> = {}) {
  const context = {
    isVxRedditSupported, getVxRedditFallback: vi.fn(async () => undefined), downloadVxRedditMedia: vi.fn(async () => []),
    DownloadTrace, isFxTwitterUrl: (url: string) => url.includes('x.com/'),
    resolveRedditShareUrl: async (url: string) => url,
    getRedditDirectMediaUrls: async () => [],
    downloadWithGalleryDl: vi.fn(async () => { throw new Error('gallery failed'); }),
    processVideo: vi.fn(async () => { throw new Error('yt failed'); }),
    getFxTwitterFallback: vi.fn(async () => ({ mediaUrls: ['https://video.twimg.com/video.mp4'] })),
    downloadDirectMediaUrls: vi.fn(async () => ({ files: ['file'], metadata: {} })),
    explainDownloadFailure: (_url: string, message: string) => message,
    formatLog: (_ctx: unknown, message: string) => message,
    console: { log: () => {} }, process: { env: {} }, AbortSignal,
    fs: { statSync: () => ({ size: 100 }) }, getMediaType: () => 'video',
    ...overrides,
  };
  const run = runInNewContext(code + '\nprocessUrl;', context);
  return { run, context };
}

describe('real processUrl attribution wiring', () => {
  it('does not call vxreddit when yt-dlp succeeds on a Reddit post', async () => {
    const { run, context } = pipeline({ processVideo: async () => ({ path: '/tmp/video.mp4', metadata: {} }) });
    await run({}, 'https://www.reddit.com/comments/1xxj8ga/', {}, '/tmp', new DownloadTrace());
    expect(context.getVxRedditFallback).not.toHaveBeenCalled();
  });
  it('honors the opt-out switch without attempting vxreddit', async () => {
    const { run, context } = pipeline({ process: { env: { VXREDDIT_FALLBACK_ENABLED: 'false' } } });
    const trace = new DownloadTrace();
    await expect(run({}, 'https://www.reddit.com/comments/1xxj8ga/', {}, '/tmp', trace)).rejects.toThrow();
    expect(context.getVxRedditFallback).not.toHaveBeenCalled();
    expect(trace.attribution().attempts?.map(a => a.source)).toEqual(['gallery-dl', 'yt-dlp']);
  });
  it('keeps failed vxreddit media retrieval in analytics without recording a rescue', async () => {
    const { run } = pipeline({
      getVxRedditFallback: async () => ({ media: [{ url: 'https://i.redd.it/a.jpg', type: 'photo' }] }),
      downloadVxRedditMedia: async () => { throw new Error('media request failed'); },
    });
    const trace = new DownloadTrace();
    await expect(run({}, 'https://www.reddit.com/comments/1xxj8ga/', {}, '/tmp', trace)).rejects.toThrow();
    expect(trace.attribution()).toMatchObject({ source: null, is_fallback: false, attempts: [
      { source: 'gallery-dl', outcome: 'failed' }, { source: 'yt-dlp', outcome: 'failed' }, { source: 'vxreddit', outcome: 'failed' },
    ] });
  });

  it('rescues the reported Reddit post via vxreddit only after both downloaders fail', async () => {
    const { run, context } = pipeline({
      getVxRedditFallback: vi.fn(async () => ({ media: [{ url: 'https://i.redd.it/l5kwze2vfx1i1.jpeg', type: 'photo' }], caption: 'Post' })),
      downloadVxRedditMedia: vi.fn(async () => [{ path: '/tmp/image.jpg', type: 'photo', size: 164385 }]),
    });
    const trace = new DownloadTrace();
    const result = await run({}, 'https://www.reddit.com/r/AutoTuga/comments/1xxj8ga/title/', {}, '/tmp', trace);
    expect(result.caption).toBe('Post');
    expect(context.processVideo).toHaveBeenCalled();
    expect(trace.attribution()).toMatchObject({ source: 'vxreddit', is_fallback: true, attempts: [
      { source: 'gallery-dl', outcome: 'failed' }, { source: 'yt-dlp', outcome: 'failed' }, { source: 'vxreddit', outcome: 'success' },
    ] });
  });

  it('attributes the primary downloader without invoking fallbacks', async () => {
    const { run, context } = pipeline({ downloadWithGalleryDl: async () => ({ files: ['file'], metadata: {} }) });
    const trace = new DownloadTrace();
    await run({}, 'https://x.com/test/status/123', {}, '/tmp', trace);
    expect(trace.attribution()).toEqual({ source: 'gallery-dl', is_fallback: false, attempts: [{ source: 'gallery-dl', outcome: 'success' }] });
    expect(context.processVideo).not.toHaveBeenCalled();
  });
  it('does not try an X-only provider for an unrelated domain', async () => {
    const { run, context } = pipeline();
    const trace = new DownloadTrace();
    await expect(run({}, 'https://example.com/video', {}, '/tmp', trace)).rejects.toThrow();
    expect(context.getFxTwitterFallback).not.toHaveBeenCalled();
    expect(trace.attribution()).toMatchObject({ source: null, is_fallback: false, attempts: [
      { source: 'gallery-dl', outcome: 'failed' }, { source: 'yt-dlp', outcome: 'failed' },
    ] });
  });
  it('tracks direct Reddit retrieval as its own backend', async () => {
    const { run } = pipeline({ getRedditDirectMediaUrls: async () => ['https://i.redd.it/test.jpg'] });
    const trace = new DownloadTrace();
    await run({}, 'https://reddit.com/r/test/comments/123', {}, '/tmp', trace);
    expect(trace.attribution()).toEqual({ source: 'reddit-direct', is_fallback: false, attempts: [{ source: 'reddit-direct', outcome: 'success' }] });
  });
  it('counts a successful yt-dlp attempt after gallery-dl fails', async () => {
    const { run } = pipeline({ processVideo: async () => ({ path: '/tmp/file.mp4', metadata: {} }) });
    const trace = new DownloadTrace();
    await run({}, 'https://example.com/video', {}, '/tmp', trace);
    expect(trace.attribution()).toMatchObject({ source: 'yt-dlp', is_fallback: true });
  });
  it('records failed third-party media retrieval as a failed attempt, not a rescue', async () => {
    const { run } = pipeline({ downloadDirectMediaUrls: async () => { throw new Error('media fetch failed'); } });
    const trace = new DownloadTrace();
    await expect(run({}, 'https://x.com/test/status/123', {}, '/tmp', trace)).rejects.toThrow();
    expect(trace.attribution()).toMatchObject({ source: null, is_fallback: false, attempts: [
      { source: 'gallery-dl', outcome: 'failed' }, { source: 'yt-dlp', outcome: 'failed' }, { source: 'fxtwitter', outcome: 'failed' },
    ] });
  });

  it('records the FxTwitter rescue after both local downloaders fail', async () => {
    const { run } = pipeline();
    const trace = new DownloadTrace();
    await run({}, 'https://x.com/test/status/123', {}, '/tmp', trace);
    expect(trace.attribution()).toMatchObject({ source: 'fxtwitter', is_fallback: true, attempts: [
      { source: 'gallery-dl', outcome: 'failed' }, { source: 'yt-dlp', outcome: 'failed' }, { source: 'fxtwitter', outcome: 'success' },
    ] });
  });
});
