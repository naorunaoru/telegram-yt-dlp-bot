import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getRedditComment, isRedditShareUrl } from './reddit';

const REDDIT_HOSTS = /^(?:(?:www|old|m)\.)?reddit(?:media)?\.com$/;
const IMAGE_HOSTS = new Set(['i.redd.it', 'preview.redd.it']);
// Exact offload origin observed from vxreddit's /redditvideo.mp4 endpoint.
// Fail closed if the operator changes it; never allow arbitrary *.on.aws URLs.
const VIDEO_RENDERER = 'ujzvxmd24pyrqqrffpjzcrw6240jjoio.lambda-url.us-east-1.on.aws';
const MAX_MEDIA = 10;

export interface VxRedditMedia { url: string; type: 'photo' | 'video'; }
export interface VxRedditFallback { media: VxRedditMedia[]; caption?: string; }

const safeHttps = (value: string): URL | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : undefined;
  } catch { return undefined; }
};

export const isVxRedditSupported = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !REDDIT_HOSTS.test(url.hostname) || url.username || url.password || url.port) return false;
    return Boolean(getRedditComment(value)) || /^\/(?:(?:r|u|user)\/[^/]+\/)?(?:comments\/[a-z0-9]+(?:\/[^/]+)?|s\/[a-z0-9]+)\/?$/i.test(url.pathname);
  } catch { return false; }
};

const decodeEntities = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity: string) => {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
  if (entity[0] !== '#') return named[entity.toLowerCase()] || match;
  const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
});

const parseMeta = (html: string): Map<string, string[]> => {
  const values = new Map<string, string[]>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes: Record<string, string> = {};
    for (const match of tag.matchAll(/\b(property|name|content)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
      attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3]);
    }
    const key = (attributes.property || attributes.name || '').toLowerCase();
    if (key && attributes.content) values.set(key, [...(values.get(key) || []), attributes.content]);
  }
  return values;
};

const safeMedia = (value: string, type: VxRedditMedia['type']): VxRedditMedia | undefined => {
  const url = safeHttps(value);
  if (!url) return undefined;
  if (type === 'photo') return IMAGE_HOSTS.has(url.hostname) ? { url: url.toString(), type } : undefined;
  if (['v.redd.it', 'renders.vxreddit.com'].includes(url.hostname) && /\.mp4$/i.test(url.pathname)) return { url: url.toString(), type };
  if ((url.hostname === 'vxreddit.com' && url.pathname === '/redditvideo.mp4') || (url.hostname === VIDEO_RENDERER && url.pathname === '/')) {
    // The provider's muxer must only be asked to combine public Reddit streams.
    const video = safeHttps(url.searchParams.get('video_url') || '');
    const audioValue = url.searchParams.get('audio_url');
    const audio = audioValue ? safeHttps(audioValue) : undefined;
    if (video?.hostname === 'v.redd.it' && (!audioValue || audio?.hostname === 'v.redd.it')) return { url: url.toString(), type };
  }
  return undefined;
};

const readHtml = async (response: Response): Promise<string> => {
  const limit = 512 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('vxreddit embed is too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('vxreddit embed is too large');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
};

export const getVxRedditFallback = async (
  value: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}
): Promise<VxRedditFallback | undefined> => {
  if (!isVxRedditSupported(value)) return undefined;
  const url = new URL('https://vxreddit.com');
  const requested = getRedditComment(value);
  url.pathname = requested ? `${requested.prefix}comments/${requested.postId}/_/${requested.commentId}/` : new URL(value).pathname;
  url.searchParams.set('legacy', '1');
  const response = await (options.fetchImpl || fetch)(url.toString(), {
    redirect: 'manual', headers: { 'user-agent': 'Discordbot/2.0', accept: 'text/html' },
    signal: options.signal || AbortSignal.timeout(15_000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`vxreddit returned HTTP ${response.status}`); }
  if (!response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('vxreddit did not return an HTML embed'); }
  const meta = parseMeta(await readHtml(response));
  const identities = meta.get('og:url') || [];
  const comment = identities.length === 1 ? getRedditComment(identities[0]) : undefined;
  const summary = meta.get('twitter:card')?.[0] === 'summary';
  // An unresolved share might be a comment even when the mirror shows a post preview.
  if (requested || isRedditShareUrl(value)) {
    if (!comment || !summary || (requested && (requested.postId !== comment.postId || requested.commentId !== comment.commentId))) return undefined;
    const descriptions = meta.get('og:description') || [];
    const value = descriptions.length === 1 ? descriptions[0].trim() : '';
    const attachment = !/\s/.test(value) && safeHttps(value);
    if (!attachment || !/^\/[a-z0-9]+\.(?:jpe?g|png|gif|webp)$/i.test(attachment.pathname)) return undefined;
    const image = safeMedia(attachment.toString(), 'photo');
    return image ? { media: [image] } : undefined;
  }
  const videos = [...(meta.get('og:video') || []), ...(meta.get('og:video:secure_url') || []), ...(meta.get('twitter:player:stream') || [])];
  // Link previews and incomplete video embeds only have a thumbnail, not post media.
  if (!videos.length && ['summary', 'player'].includes(meta.get('twitter:card')?.[0] || '')) return undefined;
  // Never substitute a video's poster image if its playable URL is unsafe.
  const type = videos.length ? 'video' : 'photo';
  const urls = [...new Set(videos.length ? videos : meta.get('og:image') || [])].slice(0, MAX_MEDIA);
  const media = urls.map(item => safeMedia(item, type));
  if (media.some(item => !item)) throw new Error('vxreddit returned an unsupported media URL');
  if (!media.length) return undefined;
  return { media: media as VxRedditMedia[], caption: meta.get('og:title')?.[0]?.trim() || undefined };
};


/** Download only validated Reddit media; never pass account cookies to a proxy. */
export const downloadVxRedditMedia = async (
  media: VxRedditMedia[], directory: string,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<{ path: string; type: 'photo' | 'video'; size: number }[]> => {
  const files: { path: string; type: 'photo' | 'video'; size: number }[] = [];
  const created: string[] = [];
  const mimeExtensions: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4',
  };
  try {
    for (const item of media.slice(0, MAX_MEDIA)) {
      let current = safeMedia(item.url, item.type);
      if (!current) throw new Error('Unsupported vxreddit media URL');
      const signal = AbortSignal.timeout(60_000);
      let response: Response | undefined;
      for (let redirects = 0; redirects <= 3; redirects++) {
        response = await (options.fetchImpl || fetch)(current.url, { redirect: 'manual', signal });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3) throw new Error('vxreddit media redirect limit exceeded');
        current = safeMedia(new URL(location, current.url).toString(), item.type);
        if (!current) throw new Error('Unsafe vxreddit media redirect');
      }
      if (!response?.ok || !response.body) { await response?.body?.cancel(); throw new Error(`vxreddit media returned HTTP ${response?.status}`); }
      const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
      const extension = mimeExtensions[mime];
      const limit = item.type === 'photo' ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
      if (!extension || !mime.startsWith(item.type === 'photo' ? 'image/' : 'video/')) { await response.body.cancel(); throw new Error('vxreddit media returned an unexpected content type'); }
      if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('vxreddit media exceeds Telegram size limits'); }
      const filename = path.join(directory, `vxreddit-${randomUUID()}.${extension}`);
      created.push(filename);
      let size = 0;
      const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        callback(size > limit ? new Error('vxreddit media exceeds Telegram size limits') : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as any), bounded, createWriteStream(filename, { flags: 'wx', mode: 0o600 }), { signal });
      if (!size) throw new Error('vxreddit returned an empty media file');
      files.push({ path: filename, type: item.type, size });
    }
    return files;
  } catch (error) {
    await Promise.all(created.map(filename => fs.rm(filename, { force: true })));
    throw error;
  }
};
