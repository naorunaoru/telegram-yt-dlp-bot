import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
const script = readFileSync('src/webapp/index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1];
function dashboard(data: unknown, tab = 'overview') {
  const app = { innerHTML: '' };
  const document = {
    getElementById: () => app,
    createElement: () => ({ textContent: '', get innerHTML(): string { return this.textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); } }),
  };
  runInNewContext(`${script}\ndata = ${JSON.stringify(data)}; currentTab = '${tab}'; render();`, {
    document, window: {}, fetch: () => new Promise(() => {}), setInterval: () => {},
  });
  return app.innerHTML;
}
describe('source analytics dashboard', () => {
  it('shows successes, rescues and unsuccessful attempts by backend', () => {
    const html = dashboard({ sources: [{ source: 'fxtwitter', attempts: 5, successful: 3, rescued: 3, failed: 2 }] });
    expect(html).toContain('Download Backends (30d)');
    expect(html).toContain('FxTwitter');
    expect(html).toContain('3 successful');
    expect(html).toContain('3 rescued');
    expect(html).toContain('2 unsuccessful');
    expect(html).toContain('Historical events');
  });
  it('shows an attempt trail and rescued badge in recent activity', () => {
    const html = dashboard({ activity: [{ url: 'https://x.com/a/status/123', timestamp: Date.now(), success: true, source: 'fxtwitter', is_fallback: true,
      attempts: [{ source: 'gallery-dl', outcome: 'failed' }, { source: 'fxtwitter', outcome: 'success' }] }] }, 'activity');
    expect(html).toContain('Rescued by FxTwitter');
    expect(html).toContain('gallery-dl: failed → FxTwitter: success');
  });
  it('does not invent a provider for historical activity and escapes unknown provider names', () => {
    expect(dashboard({ activity: [{ url: 'https://example.com', timestamp: Date.now(), success: true }] }, 'activity')).toContain('Source unknown');
    const html = dashboard({ sources: [{ source: '<img src=x>', attempts: 1, successful: 1, rescued: 0, failed: 0 }] });
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<img src=x>');
  });
});
