import { describe, expect, it, vi } from "vitest";
import { getFxTwitterFallback } from "../helpers/fxtwitter";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("getFxTwitterFallback", () => {
  it("returns trusted media URLs and the tweet caption", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 200,
        tweet: {
          text: "We are back!",
          media: {
            all: [
              { url: "https://video.twimg.com/amplify_video/123/video.mp4?tag=29" },
              { url: "https://pbs.twimg.com/media/example.jpg?format=jpg" },
            ],
          },
        },
      })
    );

    await expect(
      getFxTwitterFallback("https://x.com/example/status/2081590520174838172?s=20", {
        fetchImpl,
      })
    ).resolves.toEqual({
      mediaUrls: [
        "https://video.twimg.com/amplify_video/123/video.mp4?tag=29",
        "https://pbs.twimg.com/media/example.jpg?format=jpg",
      ],
      caption: "We are back!",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.fxtwitter.com/status/2081590520174838172",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  it("does not call FxTwitter for non-Twitter URLs", async () => {
    const fetchImpl = vi.fn();

    await expect(
      getFxTwitterFallback("https://example.com/user/status/123", { fetchImpl })
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects media URLs outside Twitter's CDN", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        code: 200,
        tweet: {
          media: { all: [{ url: "https://attacker.example/video.mp4" }] },
        },
      })
    );

    await expect(
      getFxTwitterFallback("https://twitter.com/example/status/123", { fetchImpl })
    ).resolves.toBeUndefined();
  });

  it("reports FxTwitter HTTP failures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 503));

    await expect(
      getFxTwitterFallback("https://x.com/example/status/123", { fetchImpl })
    ).rejects.toThrow("FxTwitter API returned HTTP 503");
  });
});
