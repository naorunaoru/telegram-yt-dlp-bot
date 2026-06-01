import { describe, expect, it } from "vitest";
import { getGalleryDlCliOptionsFromEnv } from "../helpers/gallerydl.js";

describe("getGalleryDlCliOptionsFromEnv", () => {
  it("returns no overrides when env vars are missing", () => {
    expect(getGalleryDlCliOptionsFromEnv({})).toEqual([]);
  });

  it("enables oauth automatically when only refresh token is set", () => {
    expect(
      getGalleryDlCliOptionsFromEnv({
        GDL_REDDIT_REFRESH_TOKEN: "token123",
      })
    ).toEqual([
      "-o",
      "extractor.reddit.api=oauth",
      "-o",
      "extractor.reddit.refresh-token=token123",
    ]);
  });

  it("includes user agent override when provided", () => {
    expect(
      getGalleryDlCliOptionsFromEnv({
        GDL_REDDIT_USER_AGENT: "Python:mediarelaybot:v1.0 (by /u/test)",
      })
    ).toEqual([
      "-o",
      "extractor.reddit.headers.user-agent=Python:mediarelaybot:v1.0 (by /u/test)",
    ]);
  });

  it("respects explicit api override", () => {
    expect(
      getGalleryDlCliOptionsFromEnv({
        GDL_REDDIT_API: "oauth",
        GDL_REDDIT_REFRESH_TOKEN: "token123",
        GDL_REDDIT_USER_AGENT: "ua",
      })
    ).toEqual([
      "-o",
      "extractor.reddit.api=oauth",
      "-o",
      "extractor.reddit.refresh-token=token123",
      "-o",
      "extractor.reddit.headers.user-agent=ua",
    ]);
  });

  it("ignores blank values", () => {
    expect(
      getGalleryDlCliOptionsFromEnv({
        GDL_REDDIT_API: "  ",
        GDL_REDDIT_REFRESH_TOKEN: " ",
        GDL_REDDIT_USER_AGENT: "",
      })
    ).toEqual([]);
  });
});
