import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];
const isElement = (node: Node): node is Element => 'tagName' in node;
const attr = (node: Element, name: string) => node.attrs.find(item => item.name === name)?.value;
const statusPath = /^\/([a-z0-9_]+)\/status\/(\d+)\/?$/i;
const inputHosts = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'fixupx.com', 'www.fixupx.com']);
const MAX_RESPONSE_BYTES = 64 * 1024;

async function readEmbed(response: Response): Promise<{ html?: unknown } | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let json = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(json + decoder.decode());
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      json += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

function plainText(node: Node): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value;
  if (!isElement(node) || ['script', 'style'].includes(node.tagName)) return '';
  if (node.tagName === 'br') return '\n';
  const text = node.childNodes.map(plainText).join('');
  if (node.tagName === 'a' && /^https:\/\/t\.co\//i.test(attr(node, 'href') ?? '') &&
      /^pic\.(?:twitter|x)\.com\/\S+$/i.test(text)) return '';
  return text;
}

function isPostLink(node: Element, id: string): boolean {
  if (node.tagName !== 'a') return false;
  try {
    const link = new URL(attr(node, 'href') ?? '');
    return link.protocol === 'https:' && ['x.com', 'twitter.com'].includes(link.hostname) &&
      statusPath.exec(link.pathname)?.[2] === id;
  } catch {
    return false;
  }
}

/** Best-effort caption lookup; never changes the outcome of the media download. */
export async function getXOEmbedText(input: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || !inputHosts.has(url.hostname) ||
        url.port || url.username || url.password) return;
    const match = statusPath.exec(url.pathname);
    if (!match) return;
    const [, handle, id] = match;
    const endpoint = new URL('https://publish.x.com/oembed');
    endpoint.search = new URLSearchParams({
      url: `https://x.com/${handle}/status/${id}`,
      omit_script: 'true',
      hide_thread: 'true',
    }).toString();
    const response = await fetchImpl(endpoint, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok) return;
    const data = await readEmbed(response);
    if (typeof data?.html !== 'string') return;
    for (const node of parseFragment(data.html).childNodes) {
      if (!isElement(node) || node.tagName !== 'blockquote' ||
          !attr(node, 'class')?.split(/\s+/).includes('twitter-tweet')) continue;
      const children = node.childNodes.filter(isElement);
      if (!children.some(child => isPostLink(child, id))) continue;
      const text = children.filter(child => child.tagName === 'p').map(plainText).join('\n\n');
      return text.replace(/[\t ]+\n/g, '\n').trim() || undefined;
    }
  } catch {
    return undefined;
  }
}
