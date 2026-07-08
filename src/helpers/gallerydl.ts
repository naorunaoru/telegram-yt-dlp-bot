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

export const getGalleryDlCliOptionsFromEnv = (
  env: Record<string, string | undefined> = process.env
): string[] => {
  const cookiesFile = firstEnvValue(env, [
    "GDL_COOKIES_FILE",
    "DOWNLOADER_COOKIES_FILE",
  ]);
  const instagramCookiesFile = trimToUndefined(env.INSTAGRAM_COOKIES_FILE);
  const redditCookiesFile = trimToUndefined(env.REDDIT_COOKIES_FILE);
  const refreshToken = trimToUndefined(env.GDL_REDDIT_REFRESH_TOKEN);
  const userAgent = trimToUndefined(env.GDL_REDDIT_USER_AGENT);
  const api = trimToUndefined(env.GDL_REDDIT_API) || (refreshToken ? "oauth" : undefined);

  const args: string[] = [];

  if (cookiesFile) {
    args.push("-o", `extractor.*.cookies=${cookiesFile}`);
  }

  if (instagramCookiesFile) {
    args.push("-o", `extractor.instagram.cookies=${instagramCookiesFile}`);
  }

  if (redditCookiesFile) {
    args.push("-o", `extractor.reddit.cookies=${redditCookiesFile}`);
  }

  if (api) {
    args.push("-o", `extractor.reddit.api=${api}`);
  }

  if (refreshToken) {
    args.push("-o", `extractor.reddit.refresh-token=${refreshToken}`);
  }

  if (userAgent) {
    args.push("-o", `extractor.reddit.headers.user-agent=${userAgent}`);
  }

  return args;
};
