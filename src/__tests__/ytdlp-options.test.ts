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

  it("uses instagram cookies file for Instagram URLs", () => {
    expect(
      getYtDlpCliOptionsFromEnv(
        {
          DOWNLOADER_COOKIES_FILE: "/run/secrets/all-cookies.txt",
          YTDLP_COOKIES_FILE: "/run/secrets/ytdlp-cookies.txt",
          INSTAGRAM_COOKIES_FILE: "/run/secrets/instagram-cookies.txt",
        },
        "https://www.instagram.com/p/abc123/"
      )
    ).toEqual(["--cookies", "/run/secrets/instagram-cookies.txt"]);
  });

  it("does not use instagram cookies file for non-Instagram URLs", () => {
    expect(
      getYtDlpCliOptionsFromEnv(
        {
          DOWNLOADER_COOKIES_FILE: "/run/secrets/all-cookies.txt",
          INSTAGRAM_COOKIES_FILE: "/run/secrets/instagram-cookies.txt",
        },
        "https://www.youtube.com/watch?v=abc123abc12"
      )
    ).toEqual(["--cookies", "/run/secrets/all-cookies.txt"]);
  });

  it("uses reddit cookies file for Reddit URLs", () => {
    expect(
      getYtDlpCliOptionsFromEnv(
        {
          DOWNLOADER_COOKIES_FILE: "/run/secrets/all-cookies.txt",
          YTDLP_COOKIES_FILE: "/run/secrets/ytdlp-cookies.txt",
          REDDIT_COOKIES_FILE: "/run/secrets/reddit-cookies.txt",
        },
        "https://www.reddit.com/r/funny/comments/abc123/post/"
      )
    ).toEqual(["--cookies", "/run/secrets/reddit-cookies.txt"]);
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
        INSTAGRAM_COOKIES_FILE: "",
        REDDIT_COOKIES_FILE: "",
        YTDLP_COOKIES_FILE: "",
        YTDLP_COOKIES_FROM_BROWSER: "  ",
      })
    ).toEqual([]);
  });
});
