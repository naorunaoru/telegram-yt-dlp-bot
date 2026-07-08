const trimToUndefined = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const firstEnvValue = (
  env: Record<string, string | undefined>,
  names: string[]
): string | undefined => {
  for (const name of names) {
    const value = trimToUndefined(env[name]);
    if (value) return value;
  }
  return undefined;
};

const getHostname = (url?: string): string | undefined => {
  if (!url) return undefined;

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const getCookieEnvNamesForUrl = (url?: string): string[] => {
  const hostname = getHostname(url);

  if (hostname === "instagram.com" || hostname?.endsWith(".instagram.com")) {
    return ["INSTAGRAM_COOKIES_FILE", "YTDLP_COOKIES_FILE", "DOWNLOADER_COOKIES_FILE"];
  }

  if (hostname === "reddit.com" || hostname?.endsWith(".reddit.com")) {
    return ["REDDIT_COOKIES_FILE", "YTDLP_COOKIES_FILE", "DOWNLOADER_COOKIES_FILE"];
  }

  return ["YTDLP_COOKIES_FILE", "DOWNLOADER_COOKIES_FILE"];
};

export const getYtDlpCliOptionsFromEnv = (
  env: Record<string, string | undefined> = process.env,
  url?: string
): string[] => {
  const cookiesFile = firstEnvValue(env, getCookieEnvNamesForUrl(url));
  const cookiesFromBrowser = trimToUndefined(env.YTDLP_COOKIES_FROM_BROWSER);

  const args: string[] = [];

  if (cookiesFile) {
    args.push("--cookies", cookiesFile);
  }

  if (cookiesFromBrowser) {
    args.push("--cookies-from-browser", cookiesFromBrowser);
  }

  return args;
};
