import { expect, it, vi } from 'vitest';
import { getXOEmbedText } from '../helpers/x-oembed';

const url = 'https://x.com/socialchanger/status/2123146033622380984';
const html = `<blockquote class="twitter-tweet"><p>If it&#39;s not outages &amp; more.<br><br>Happening <a href="https://t.co/link">example.com</a> <a href="https://t.co/media">pic.twitter.com/media</a></p>— Omar <a href="${url}">November 18</a></blockquote>`;

it('reads plain text from X, preserving breaks and ordinary links but omitting the media stub', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ html }));
  expect(await getXOEmbedText(`${url}?s=20`, fetchImpl)).toBe("If it's not outages & more.\n\nHappening example.com");
  const [target, options] = fetchImpl.mock.calls[0];
  const endpoint = new URL(String(target));
  expect(endpoint.origin + endpoint.pathname).toBe('https://publish.x.com/oembed');
  expect(endpoint.searchParams.get('url')).toBe(url);
  expect(options).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal) });
});

it('does not fetch for non-X URLs', async () => {
  const fetchImpl = vi.fn<typeof fetch>();
  expect(await getXOEmbedText('https://x.com.example.org/person/status/42', fetchImpl)).toBeUndefined();
  expect(fetchImpl).not.toHaveBeenCalled();
});

it('cancels oversized responses before parsing the body', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); },
    cancel,
  });
  expect(await getXOEmbedText(url, async () => new Response(body))).toBeUndefined();
  expect(cancel).toHaveBeenCalledOnce();
});

it.each([
  () => new Response('', { status: 429 }),
  () => new Response('invalid JSON'),
  () => Response.json({ html: '<p>Login required</p>' }),
  () => Response.json({ html: html.replace(url, 'https://x.com/someone/status/42') }),
  () => { throw new Error('timeout'); },
])('returns no caption on unavailable or mismatched embeds (%#)', async response => {
  expect(await getXOEmbedText(url, async () => response())).toBeUndefined();
});
