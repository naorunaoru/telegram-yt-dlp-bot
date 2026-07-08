import { describe, it, expect, vi } from "vitest";
import {
  getRedditDirectMediaUrls,
  getRedditFetchHeadersFromEnv,
  resolveRedditShareUrl,
} from "../helpers/reddit.js";

describe("resolveRedditShareUrl", () => {
  it("returns non-share reddit URLs unchanged", async () => {
    const fetchMock = vi.fn();
    const url = "https://www.reddit.com/r/funny/comments/abc123/some_title";

    await expect(resolveRedditShareUrl(url, fetchMock as any, {})).resolves.toBe(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves reddit share URLs from final response URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://www.reddit.com/r/funny/comments/abc123/some_title/?share_id=123&utm_source=share&utm_medium=ios_app#fragment",
    });

    await expect(
      resolveRedditShareUrl(
        "https://www.reddit.com/r/funny/s/AbCdEfGhIj",
        fetchMock as any,
        {}
      )
    ).resolves.toBe("https://www.reddit.com/r/funny/comments/abc123/some_title/");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.reddit.com/r/funny/s/AbCdEfGhIj",
      { redirect: "follow" }
    );
  });

  it("falls back to original URL when fetch has no final URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ url: "" });
    const url = "https://www.reddit.com/r/funny/s/AbCdEfGhIj";

    await expect(resolveRedditShareUrl(url, fetchMock as any, {})).resolves.toBe(url);
  });

  it("passes configured reddit user-agent to share URL fetches", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://www.reddit.com/r/funny/comments/abc123/some_title/",
    });

    await resolveRedditShareUrl(
      "https://www.reddit.com/r/funny/s/AbCdEfGhIj",
      fetchMock as any,
      {
        GDL_REDDIT_USER_AGENT: "Python:mediarelaybot:v1.0 (by /u/test)",
      }
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.reddit.com/r/funny/s/AbCdEfGhIj",
      {
        redirect: "follow",
        headers: {
          "user-agent": "Python:mediarelaybot:v1.0 (by /u/test)",
        },
      }
    );
  });
});

describe("getRedditFetchHeadersFromEnv", () => {
  it("returns undefined without a configured user-agent", () => {
    expect(getRedditFetchHeadersFromEnv({})).toBeUndefined();
  });

  it("returns the configured user-agent", () => {
    expect(
      getRedditFetchHeadersFromEnv({
        GDL_REDDIT_USER_AGENT: "Python:mediarelaybot:v1.0 (by /u/test)",
      })
    ).toEqual({
      "user-agent": "Python:mediarelaybot:v1.0 (by /u/test)",
    });
  });
});

describe("getRedditDirectMediaUrls", () => {
  it("returns direct media URL for reddit image posts", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        headers: {
          getSetCookie: () => ["loid=test123; Path=/; Domain=.reddit.com"],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            data: {
              children: [
                {
                  data: {
                    post_hint: "image",
                    url_overridden_by_dest: "https://i.redd.it/example.jpeg",
                  },
                },
              ],
            },
          },
        ],
      });

    await expect(
      getRedditDirectMediaUrls(
        "https://www.reddit.com/r/funny/comments/abc123/some_title/",
        fetchMock as any
      )
    ).resolves.toEqual(["https://i.redd.it/example.jpeg"]);
  });

  it("returns gallery media URLs from reddit post JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        headers: {
          getSetCookie: () => ["loid=test123; Path=/; Domain=.reddit.com"],
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            data: {
              children: [
                {
                  data: {
                    gallery_data: {
                      items: [{ media_id: "a" }, { media_id: "b" }],
                    },
                    media_metadata: {
                      a: { status: "valid", s: { u: "https://preview.redd.it/a.jpg?width=1&amp;format=pjpg" } },
                      b: { status: "valid", s: { mp4: "https://preview.redd.it/b.mp4" } },
                    },
                  },
                },
              ],
            },
          },
        ],
      });

    await expect(
      getRedditDirectMediaUrls(
        "https://www.reddit.com/r/funny/comments/abc123/some_title/",
        fetchMock as any
      )
    ).resolves.toEqual([
      "https://preview.redd.it/a.jpg?width=1&format=pjpg",
      "https://preview.redd.it/b.mp4",
    ]);
  });
});
