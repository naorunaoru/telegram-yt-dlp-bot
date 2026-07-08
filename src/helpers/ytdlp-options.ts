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

export const getYtDlpCliOptionsFromEnv = (
  env: Record<string, string | undefined> = process.env
): string[] => {
  const cookiesFile = firstEnvValue(env, [
    "YTDLP_COOKIES_FILE",
    "DOWNLOADER_COOKIES_FILE",
  ]);
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
