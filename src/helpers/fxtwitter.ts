const DEFAULT_API_BASE_URL = "https://api.fxtwitter.com";
const MAX_MEDIA_ITEMS = 10;

const TWITTER_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.x.com",
]);

const ALLOWED_MEDIA_HOSTS = new Set(["pbs.twimg.com", "video.twimg.com"]);

interface FxTwitterMediaItem {
  url?: unknown;
}

interface FxTwitterResponse {
  code?: unknown;
  tweet?: {
    text?: unknown;
    media?: { all?: unknown };
  };
}

export interface FxTwitterFallback {
  mediaUrls: string[];
  caption?: string;
}

const getTweetId = (url: string): string | undefined => {
  try {
    const parsed = new URL(url);
    if (!TWITTER_HOSTS.has(parsed.hostname.toLowerCase())) return undefined;
    return parsed.pathname.match(/\/status\/(\d+)/i)?.[1];
  } catch {
    return undefined;
  }
};

const getSafeMediaUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !ALLOWED_MEDIA_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
};

export const getFxTwitterFallback = async (
  url: string,
  options: {
    apiBaseUrl?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {}
): Promise<FxTwitterFallback | undefined> => {
  const tweetId = getTweetId(url);
  if (!tweetId) return undefined;

  const apiBaseUrl = options.apiBaseUrl || DEFAULT_API_BASE_URL;
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(
    `${apiBaseUrl.replace(/\/$/, "")}/status/${tweetId}`,
    {
      headers: { accept: "application/json" },
      signal: options.signal,
    }
  );

  if (!response.ok) {
    throw new Error(`FxTwitter API returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as FxTwitterResponse;
  if (data.code !== 200 || !Array.isArray(data.tweet?.media?.all)) {
    return undefined;
  }

  const mediaUrls = (data.tweet.media.all as FxTwitterMediaItem[])
    .map((item) => getSafeMediaUrl(item?.url))
    .filter((mediaUrl): mediaUrl is string => Boolean(mediaUrl))
    .filter((mediaUrl, index, urls) => urls.indexOf(mediaUrl) === index)
    .slice(0, MAX_MEDIA_ITEMS);

  if (mediaUrls.length === 0) return undefined;

  const text = data.tweet.text;
  return {
    mediaUrls,
    caption: typeof text === "string" && text.trim() ? text.trim() : undefined,
  };
};
