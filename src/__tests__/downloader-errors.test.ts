import { describe, expect, it } from "vitest";
import {
  explainDownloadFailure,
  summarizeProcessFailure,
} from "../helpers/downloader-errors.js";

describe("summarizeProcessFailure", () => {
  it("prefers explicit ERROR lines", () => {
    const message = summarizeProcessFailure("yt-dlp", 1, [
      "ERROR: Instagram sent an empty media response",
    ]);

    expect(message).toBe(
      "yt-dlp exited with code 1: Instagram sent an empty media response"
    );
  });

  it("falls back to login/auth hints", () => {
    const message = summarizeProcessFailure("gallery-dl", 4, [
      "[instagram][error] HTTP redirect to login page (https://www.instagram.com/accounts/login/)",
    ]);

    expect(message).toContain("gallery-dl exited with code 4");
    expect(message).toContain("HTTP redirect to login page");
  });

  it("ignores debug noise when picking fallback lines", () => {
    const message = summarizeProcessFailure(
      "yt-dlp",
      1,
      ["[debug] verbose noise"],
      ["[download] Destination: /tmp/file.mp4", "Some final useful line"]
    );

    expect(message).toBe("yt-dlp exited with code 1: Some final useful line");
  });
});

describe("explainDownloadFailure", () => {
  it("turns Instagram auth failures into a user-facing explanation", () => {
    const message = explainDownloadFailure(
      "https://www.instagram.com/reel/abc123/",
      "yt-dlp exited with code 1: Instagram sent an empty media response. Use cookies"
    );

    expect(message).toContain("Instagram is rejecting anonymous downloads");
    expect(message).toContain("DOWNLOADER_COOKIES_FILE");
  });

  it("turns Reddit auth failures into a user-facing explanation", () => {
    const message = explainDownloadFailure(
      "https://www.reddit.com/r/shitposting/comments/1uqg173/post/",
      "yt-dlp exited with code 1: Account authentication is required. Use --cookies"
    );

    expect(message).toContain("Reddit is requiring account authentication");
    expect(message).toContain("GDL_REDDIT_REFRESH_TOKEN");
  });

  it("passes unrelated errors through", () => {
    const message = explainDownloadFailure(
      "https://example.com/video",
      "yt-dlp exited with code 1: network timeout"
    );

    expect(message).toBe("yt-dlp exited with code 1: network timeout");
  });
});
