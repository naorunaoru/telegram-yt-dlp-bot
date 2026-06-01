const trimToUndefined = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const getGalleryDlCliOptionsFromEnv = (
  env: Record<string, string | undefined> = process.env
): string[] => {
  const refreshToken = trimToUndefined(env.GDL_REDDIT_REFRESH_TOKEN);
  const userAgent = trimToUndefined(env.GDL_REDDIT_USER_AGENT);
  const api = trimToUndefined(env.GDL_REDDIT_API) || (refreshToken ? "oauth" : undefined);

  const args: string[] = [];

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
