const REDDIT_SHARE_URL_RE = /^https?:\/\/(?:www\.|old\.)?reddit\.com\/(?:r\/[^/]+\/|user\/[^/]+\/)?s\/[^/?#&]+/i;

const stripTrackingParams = (url: string): string => {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
};

/**
 * Resolve Reddit share URLs (/s/...) to their canonical post URLs.
 * gallery-dl's RedditRedirectExtractor currently exits successfully after the
 * redirect but does not download anything, which makes the bot fall back to
 * plain yt-dlp. A normal fetch with redirects followed still exposes the final
 * canonical URL even when Reddit serves a verification page.
 */
export const resolveRedditShareUrl = async (
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> => {
  if (!REDDIT_SHARE_URL_RE.test(url)) {
    return url;
  }

  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
    });

    if (response.url) {
      return stripTrackingParams(response.url);
    }
  } catch {
    // Best-effort normalization only; fall back to original URL.
  }

  return url;
};
