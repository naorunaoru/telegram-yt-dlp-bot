import { describe, it, expect, vi } from "vitest";
import { resolveBilibiliShortUrl } from "../helpers/bilibili.js";

describe("resolveBilibiliShortUrl", () => {
  it("returns non-short bilibili URLs unchanged", async () => {
    const fetchMock = vi.fn();
    const url = "https://www.bilibili.com/ru/video/BV1YGp163Epg";

    await expect(resolveBilibiliShortUrl(url, fetchMock as any)).resolves.toBe(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns URLs from other hosts unchanged", async () => {
    const fetchMock = vi.fn();
    const url = "https://www.youtube.com/watch?v=GlPgikR8PJ4";

    await expect(resolveBilibiliShortUrl(url, fetchMock as any)).resolves.toBe(url);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves b23.tv short links from the final response URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://www.bilibili.com/video/BV1YGp163Epg/",
    });

    await expect(
      resolveBilibiliShortUrl("https://b23.tv/BV1YGp163Epg", fetchMock as any)
    ).resolves.toBe("https://www.bilibili.com/video/BV1YGp163Epg/");
    expect(fetchMock).toHaveBeenCalledWith("https://b23.tv/BV1YGp163Epg", {
      redirect: "follow",
      headers: {
        "user-agent": expect.stringContaining("Mozilla/5.0"),
      },
    });
  });

  it("keeps a localized redirect target as-is", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://www.bilibili.com/ru/video/BV1YGp163Epg/",
    });

    await expect(
      resolveBilibiliShortUrl("https://b23.tv/BV1YGp163Epg", fetchMock as any)
    ).resolves.toBe("https://www.bilibili.com/ru/video/BV1YGp163Epg/");
  });

  it("drops share tracking params but keeps the part selector", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://www.bilibili.com/video/BV1xx411c7mD/?p=2&share_source=qq_web&vd_source=abc#anchor",
    });

    await expect(
      resolveBilibiliShortUrl("https://b23.tv/AbCdEf", fetchMock as any)
    ).resolves.toBe("https://www.bilibili.com/video/BV1xx411c7mD/?p=2");
  });

  it("drops share tracking params when there is no part selector", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://www.bilibili.com/video/BV1xx411c7mD/?share_from=u&share_medium=android&share_plat=android",
    });

    await expect(
      resolveBilibiliShortUrl("https://b23.tv/AbCdEf", fetchMock as any)
    ).resolves.toBe("https://www.bilibili.com/video/BV1xx411c7mD/");
  });

  it("falls back to the original URL when the redirect leaves bilibili", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      url: "https://m.bilibili.com/index.html",
    });
    const url = "https://b23.tv/AbCdEf";

    await expect(resolveBilibiliShortUrl(url, fetchMock as any)).resolves.toBe(url);
  });

  it("falls back to the original URL when fetch has no final URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ url: "" });
    const url = "https://b23.tv/AbCdEf";

    await expect(resolveBilibiliShortUrl(url, fetchMock as any)).resolves.toBe(url);
  });

  it("falls back to the original URL when the request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    const url = "https://b23.tv/AbCdEf";

    await expect(resolveBilibiliShortUrl(url, fetchMock as any)).resolves.toBe(url);
  });
});
