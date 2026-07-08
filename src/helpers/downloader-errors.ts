const DEBUG_LINE_PATTERNS = [/\[debug\]/i, /^Traceback \(most recent call last\):$/i, /^\s*File "/];

const isDebugOrTraceLine = (line: string): boolean =>
  DEBUG_LINE_PATTERNS.some((pattern) => pattern.test(line));

const cleanLine = (line: string): string => line.replace(/^ERROR:\s*/i, "").trim();

const getMeaningfulLines = (lines: string[]): string[] =>
  lines
    .map((line) => line.trim())
    .filter((line) => line && !isDebugOrTraceLine(line));

export const summarizeProcessFailure = (
  toolName: string,
  code: number,
  stderrLines: string[],
  stdoutLines: string[] = []
): string => {
  const stderr = getMeaningfulLines(stderrLines);
  const stdout = getMeaningfulLines(stdoutLines);

  const explicitError = [...stderr, ...stdout]
    .map(cleanLine)
    .find((line) => /^\[[^\]]+\]\s*(ERROR|error)\]/.test(line) || /^ERROR:/i.test(line));

  if (explicitError) {
    return `${toolName} exited with code ${code}: ${explicitError}`;
  }

  const loginHint = [...stderr, ...stdout]
    .map(cleanLine)
    .find((line) =>
      /(login|required|cookies|logged-?in|authentication|private content|empty media response|forbidden)/i.test(
        line
      )
    );

  if (loginHint) {
    return `${toolName} exited with code ${code}: ${loginHint}`;
  }

  const lastMeaningfulLine = [...stderr, ...stdout].map(cleanLine).at(-1);
  if (lastMeaningfulLine) {
    return `${toolName} exited with code ${code}: ${lastMeaningfulLine}`;
  }

  return `${toolName} exited with code ${code}`;
};

export const explainDownloadFailure = (url: string, errorMessage: string): string => {
  const lowerUrl = url.toLowerCase();
  const lowerError = errorMessage.toLowerCase();

  if (
    lowerUrl.includes("instagram.com") &&
    /(login|required|cookies|logged-?in|authentication|empty media response)/.test(lowerError)
  ) {
    return "Instagram is rejecting anonymous downloads for this post/reel right now. Configure valid logged-in cookies with DOWNLOADER_COOKIES_FILE or YTDLP_COOKIES_FILE.";
  }

  if (
    lowerUrl.includes("reddit.com") &&
    /(account authentication|required|cookies|logged-?in|authentication|forbidden)/.test(
      lowerError
    )
  ) {
    return "Reddit is requiring account authentication for this post. Configure valid Reddit cookies with DOWNLOADER_COOKIES_FILE or YTDLP_COOKIES_FILE, or configure gallery-dl Reddit OAuth with GDL_REDDIT_REFRESH_TOKEN.";
  }

  if (lowerError.includes("no suitable extractor")) {
    return "This URL is not supported by the current downloader stack.";
  }

  return errorMessage;
};
