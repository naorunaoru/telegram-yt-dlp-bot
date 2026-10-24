const BILIBILI_SHORT_URL_RE = /^https?:\/\/b23\.tv\/[\w-]+/i;
const BILIBILI_VIDEO_URL_RE =
  /^https?:\/\/(?:www\.)?bilibili\.com\/(?:[a-z]{2}(?:[_-][A-Za-z0-9]+)?\/)?video\/(?:BV[\w]+|av\d+)/i;

const BILIBILI_BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

/**
 * Keep only the `p` query param, which selects a part of a multi-part video.
 * Everything else Bilibili appends to a share link is tracking, and leaving it
 * in place would give the same video a different cache key per share.
 */
const normalizeBilibiliVideoUrl = (url: string): string => {
  const parsed = new URL(url);
  const part = parsed.searchParams.get("p");

  parsed.search = part ? `p=${part}` : "";
  parsed.hash = "";

  return parsed.toString();
};

/**
 * Resolve b23.tv share links to bilibili.com video URLs.
 * Neither yt-dlp nor gallery-dl matches the b23.tv host, so both reject the
 * short link outright. Following the redirect yields a bilibili.com URL the
 * BiliBili extractor accepts, including the region-prefixed paths Bilibili
 * redirects some clients to.
 */
export const resolveBilibiliShortUrl = async (
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> => {
  if (!BILIBILI_SHORT_URL_RE.test(url)) {
    return url;
  }

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      headers: { "user-agent": BILIBILI_BROWSER_UA },
    });

    if (response.url && BILIBILI_VIDEO_URL_RE.test(response.url)) {
      return normalizeBilibiliVideoUrl(response.url);
    }
  } catch {
    // Best-effort normalization only; fall back to the original URL.
  }

  return url;
};
