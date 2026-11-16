import { describe, expect, it } from 'vitest';
import { DownloadTrace } from '../helpers/download-attribution';

describe('download attempt attribution', () => {
  it('records a fallback rescue after failed and empty attempts without recording error text', async () => {
    const trace = new DownloadTrace();
    await expect(trace.run('gallery-dl', async () => { throw new Error('sensitive url'); }, Boolean)).rejects.toThrow();
    await trace.run('yt-dlp', async () => undefined, Boolean);
    await trace.run('fxtwitter', async () => 'file.mp4', Boolean);
    expect(trace.attribution()).toEqual({ source: 'fxtwitter', is_fallback: true, attempts: [
      { source: 'gallery-dl', outcome: 'failed' }, { source: 'yt-dlp', outcome: 'empty' }, { source: 'fxtwitter', outcome: 'success' },
    ] });
  });
});
