import { describe, it, expect, vi } from "vitest";
import { resolveRedditShareUrl } from "../helpers/reddit.js";

describe("resolveRedditShareUrl", () => {
  it("returns non-share reddit URLs unchanged", async () => {
    const fetchMock = vi.fn();
    const url = "https://www.reddit.com/r/funny/comments/abc123/some_title";

    await expect(resolveRedditShareUrl(url, fetchMock as any)).resolves.toBe(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves reddit share URLs from final response URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://www.reddit.com/r/funny/comments/abc123/some_title/?share_id=123&utm_source=share&utm_medium=ios_app#fragment",
    });

    await expect(
      resolveRedditShareUrl(
        "https://www.reddit.com/r/funny/s/AbCdEfGhIj",
        fetchMock as any
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

    await expect(resolveRedditShareUrl(url, fetchMock as any)).resolves.toBe(url);
  });
});
