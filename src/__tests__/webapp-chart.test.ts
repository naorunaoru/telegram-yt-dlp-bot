import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/webapp/index.html', 'utf8');
const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];

function renderDaily(daily: unknown[]) {
  const app = { innerHTML: '' };
  const detail = { textContent: '' };
  const context = {
    window: {},
    document: { getElementById: (id: string) => id === 'daily-detail' ? detail : app },
    fetch: () => new Promise(() => {}),
    setInterval: () => {},
  };
  runInNewContext(`${script}\ndata = ${JSON.stringify({ daily })}; render();`, context);
  return { html: app.innerHTML, detail, context };
}

describe('daily activity chart', () => {
  it('stacks failures in red above the existing theme-blue successful proportion', () => {
    const { html } = renderDaily([{ date: '2026-11-16', total: 10, successful: 8 }]);
    expect(html).toContain('class="daily-success" style="height:80%"');
    expect(html).toContain('class="daily-failure" style="height:20%"');
    expect(html).toContain('8 successful (80%)');
    expect(html).toContain('2 failed (20%)');
    expect(page).toMatch(/\.daily-success\s*\{[^}]*background: var\(--tg-theme-link-color, #2481cc\)/);
    expect(page).toMatch(/\.daily-failure\s*\{[^}]*background: #ff3b30/);
  });

  it.each([
    { total: 5, successful: 5, success: 100, failure: 0 },
    { total: 5, successful: 0, success: 0, failure: 100 },
    { total: 0, successful: 0, success: 0, failure: 0 },
  ])('handles $successful successes out of $total without invalid percentages', ({ total, successful, success, failure }) => {
    const { html } = renderDaily([{ date: '2026-11-16', total, successful }]);
    expect(html).toContain(`class="daily-success" style="height:${success}%"`);
    expect(html).toContain(`class="daily-failure" style="height:${failure}%"`);
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it('shows an empty state without bars', () => {
    const { html } = renderDaily([]);
    expect(html).toContain('No data yet');
    expect(html).not.toContain('class="daily-bar"');
  });

  it('provides a legend and tap-accessible daily percentages', () => {
    const { html, detail, context } = renderDaily([{ date: '2026-11-16', total: 10, successful: 8 }]);
    expect(html).toContain('Success</span>');
    expect(html).toContain('Failed</span>');
    expect(html).toContain('id="daily-detail"');
    const handler = html.match(/class="daily-bar"[^>]*onclick="([^"]+)"/)![1];
    runInNewContext(`(function () { ${handler} }).call({ dataset: { tip: '80% success' } })`, context);
    expect(detail.textContent).toBe('80% success');
  });
});
