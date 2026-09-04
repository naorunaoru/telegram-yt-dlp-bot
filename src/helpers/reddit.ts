const REDDIT_SHARE_URL_RE = /^https?:\/\/(?:www\.|old\.)?reddit\.com\/(?:r\/[^/]+\/|user\/[^/]+\/)?s\/[^/?#&]+/i;
const REDDIT_POST_URL_RE = /^https?:\/\/(?:www\.|old\.)?reddit\.com\/(?:(?:r|user)\/[^/]+\/)?comments\/[^/?#&]+/i;

const REDDIT_BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const stripTrackingParams = (url: string): string => {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
};

const trimToUndefined = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const getCookieHeader = (response: Response): string => {
  const setCookies = response.headers.getSetCookie?.() || [];
  return setCookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
};

const decodeHtmlEntities = (value: string): string => value.replace(/&amp;/g, "&");

export const getRedditFetchHeadersFromEnv = (
  env: Record<string, string | undefined> = process.env
): Record<string, string> | undefined => {
  const userAgent = trimToUndefined(env.GDL_REDDIT_USER_AGENT);
  return userAgent ? { "user-agent": userAgent } : undefined;
};

type RedditPostData = {
  post_hint?: string;
  url?: string;
  url_overridden_by_dest?: string;
  gallery_data?: {
    items?: { media_id?: string }[];
  };
  media_metadata?: Record<
    string,
    {
      status?: string;
      m?: string;
      s?: {
        u?: string;
        gif?: string;
        mp4?: string;
      };
    }
  >;
};

type RedditCommentData = Pick<RedditPostData, "media_metadata"> & {
  id?: string;
  name?: string;
  richtext_json?: unknown;
};

const getRedditCommentId = (url: string): string | undefined => {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const commentsIndex = segments.indexOf("comments");
    const permalinkTail = segments.slice(commentsIndex + 1);

    // Both current (/comments/<post>/comment/<comment>) and traditional
    // (/comments/<post>/<slug>/<comment>) Reddit permalinks have three
    // segments after "comments". Post permalinks only have one or two.
    if (commentsIndex === -1 || permalinkTail.length !== 3) {
      return undefined;
    }

    return /^[a-z0-9]+$/i.test(permalinkTail[2]) ? permalinkTail[2] : undefined;
  } catch {
    return undefined;
  }
};

const collectRichtextMediaIds = (value: unknown, ids: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRichtextMediaIds(item, ids);
    }
    return ids;
  }

  if (!value || typeof value !== "object") {
    return ids;
  }

  const record = value as Record<string, unknown>;
  if (
    (record.e === "img" || record.e === "gif" || record.e === "video") &&
    typeof record.id === "string"
  ) {
    ids.push(record.id);
  }

  for (const child of Object.values(record)) {
    collectRichtextMediaIds(child, ids);
  }
  return ids;
};

const getMediaMetadataUrls = (
  mediaMetadata: RedditPostData["media_metadata"],
  preferredIds: string[] = []
): string[] => {
  if (!mediaMetadata) {
    return [];
  }

  const orderedIds = Array.from(new Set([...preferredIds, ...Object.keys(mediaMetadata)]));

  return orderedIds
    .map((id) => mediaMetadata[id])
    .filter((item) => Boolean(item && typeof item === "object" && item.status === "valid"))
    .map((item) => item.s?.u || item.s?.gif || item.s?.mp4)
    .filter((item): item is string => Boolean(item))
    .map(decodeHtmlEntities);
};

const findRedditComment = (value: unknown, commentId: string): RedditCommentData | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = findRedditComment(item, commentId);
      if (result) {
        return result;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const comment = record.data as Record<string, unknown> | undefined;
  if (
    record.kind === "t1" &&
    comment &&
    (comment.id === commentId || comment.name === `t1_${commentId}`)
  ) {
    return comment as RedditCommentData;
  }

  for (const child of Object.values(record)) {
    const result = findRedditComment(child, commentId);
    if (result) {
      return result;
    }
  }
  return undefined;
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
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env
): Promise<string> => {
  if (!REDDIT_SHARE_URL_RE.test(url)) {
    return url;
  }

  try {
    const headers = getRedditFetchHeadersFromEnv(env);
    const response = await fetchImpl(url, {
      redirect: "follow",
      ...(headers ? { headers } : {}),
    });

    if (response.url) {
      return stripTrackingParams(response.url);
    }
  } catch {
    // Best-effort normalization only; fall back to original URL.
  }

  return url;
};

/**
 * Fetch direct Reddit-hosted media URLs for public image/gallery posts.
 * Uses the same anonymous-session trick as newer yt-dlp: first obtain a loid
 * cookie from old.reddit.com, then request the post JSON with a browser-like UA.
 */
export const getRedditDirectMediaUrls = async (
  url: string,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env
): Promise<string[]> => {
  const canonicalUrl = await resolveRedditShareUrl(url, fetchImpl, env);
  if (!REDDIT_POST_URL_RE.test(canonicalUrl)) {
    return [];
  }

  try {
    const sessionResponse = await fetchImpl("https://old.reddit.com/", {
      headers: {
        "user-agent": REDDIT_BROWSER_UA,
      },
    });

    const cookieHeader = getCookieHeader(sessionResponse);
    if (!cookieHeader) {
      return [];
    }

    const parsed = new URL(canonicalUrl);
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/.json";

    const jsonResponse = await fetchImpl(parsed.toString(), {
      headers: {
        "user-agent": REDDIT_BROWSER_UA,
        cookie: cookieHeader,
      },
    });

    if (!jsonResponse.ok) {
      return [];
    }

    const data = (await jsonResponse.json()) as any[];

    const commentId = getRedditCommentId(canonicalUrl);
    if (commentId) {
      const comment = findRedditComment(data, commentId);
      if (!comment) {
        return [];
      }

      return getMediaMetadataUrls(
        comment.media_metadata,
        collectRichtextMediaIds(comment.richtext_json)
      );
    }

    const post = data?.[0]?.data?.children?.[0]?.data as RedditPostData | undefined;
    if (!post) {
      return [];
    }

    if (post.post_hint === "image") {
      const directUrl = post.url_overridden_by_dest || post.url;
      return directUrl ? [directUrl] : [];
    }

    if (post.gallery_data?.items?.length && post.media_metadata) {
      const urls = getMediaMetadataUrls(
        post.media_metadata,
        post.gallery_data.items
          .map((item) => item.media_id)
          .filter((item): item is string => Boolean(item))
      );

      if (urls.length > 0) {
        return urls;
      }
    }
  } catch {
    // Best-effort Reddit shortcut only; normal extractor flow can still run.
  }

  return [];
};
