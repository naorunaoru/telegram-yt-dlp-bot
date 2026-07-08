import { describe, expect, it } from "vitest";
import { getYtDlpCliOptionsFromEnv } from "../helpers/ytdlp-options.js";

describe("getYtDlpCliOptionsFromEnv", () => {
  it("returns no overrides when env vars are missing", () => {
    expect(getYtDlpCliOptionsFromEnv({})).toEqual([]);
  });

  it("uses shared downloader cookies file", () => {
    expect(
      getYtDlpCliOptionsFromEnv({
        DOWNLOADER_COOKIES_FILE: "/run/secrets/cookies.txt",
      })
    ).toEqual(["--cookies", "/run/secrets/cookies.txt"]);
  });

  it("lets yt-dlp cookies file override shared cookies file", () => {
    expect(
      getYtDlpCliOptionsFromEnv({
        DOWNLOADER_COOKIES_FILE: "/run/secrets/all-cookies.txt",
        YTDLP_COOKIES_FILE: "/run/secrets/ytdlp-cookies.txt",
      })
    ).toEqual(["--cookies", "/run/secrets/ytdlp-cookies.txt"]);
  });

  it("supports cookies from browser", () => {
    expect(
      getYtDlpCliOptionsFromEnv({
        YTDLP_COOKIES_FROM_BROWSER: "firefox:default-release",
      })
    ).toEqual(["--cookies-from-browser", "firefox:default-release"]);
  });

  it("ignores blank values", () => {
    expect(
      getYtDlpCliOptionsFromEnv({
        DOWNLOADER_COOKIES_FILE: " ",
        YTDLP_COOKIES_FILE: "",
        YTDLP_COOKIES_FROM_BROWSER: "  ",
      })
    ).toEqual([]);
  });
});
