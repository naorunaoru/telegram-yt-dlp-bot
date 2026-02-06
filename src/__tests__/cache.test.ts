import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  initCache,
  getCachedMedia,
  setCachedMedia,
  evictOldEntries,
  getCacheStats,
  closeCache,
  CachedFile,
} from "../cache.js";

const TEST_DB_DIR = "./test-data";
const TEST_DB_PATH = path.join(TEST_DB_DIR, "test-cache.db");

// Clean up before and after tests
const cleanup = () => {
  closeCache();
  if (fs.existsSync(TEST_DB_DIR)) {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
};

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe("initCache", () => {
  it("creates database and tables", () => {
    initCache({ dbPath: TEST_DB_PATH });
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
  });

  it("creates data directory if it doesn't exist", () => {
    const nestedPath = "./test-data/nested/deep/cache.db";
    initCache({ dbPath: nestedPath });
    expect(fs.existsSync(nestedPath)).toBe(true);
    closeCache();
    fs.rmSync("./test-data/nested", { recursive: true, force: true });
  });

  it("can be called multiple times without error", () => {
    initCache({ dbPath: TEST_DB_PATH });
    initCache({ dbPath: TEST_DB_PATH });
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
  });
});

describe("setCachedMedia and getCachedMedia", () => {
  beforeEach(() => {
    initCache({ dbPath: TEST_DB_PATH });
  });

  it("stores and retrieves single file", () => {
    const url = "https://example.com/video";
    const files: CachedFile[] = [
      {
        telegram_file_id: "file_123",
        file_type: "video",
        file_order: 0,
        width: 1920,
        height: 1080,
      },
    ];

    setCachedMedia({ url, files, caption: "Test caption" });
    const result = getCachedMedia(url);

    expect(result).not.toBeNull();
    expect(result!.url).toBe(url);
    expect(result!.caption).toBe("Test caption");
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0].telegram_file_id).toBe("file_123");
    expect(result!.files[0].file_type).toBe("video");
    expect(result!.files[0].width).toBe(1920);
    expect(result!.files[0].height).toBe(1080);
  });

  it("stores and retrieves multiple files in order", () => {
    const url = "https://example.com/gallery";
    const files: CachedFile[] = [
      { telegram_file_id: "photo_1", file_type: "photo", file_order: 0 },
      { telegram_file_id: "video_1", file_type: "video", file_order: 1 },
      { telegram_file_id: "photo_2", file_type: "photo", file_order: 2 },
    ];

    setCachedMedia({ url, files });
    const result = getCachedMedia(url);

    expect(result!.files).toHaveLength(3);
    expect(result!.files[0].telegram_file_id).toBe("photo_1");
    expect(result!.files[1].telegram_file_id).toBe("video_1");
    expect(result!.files[2].telegram_file_id).toBe("photo_2");
  });

  it("stores and retrieves metadata as JSON", () => {
    const url = "https://example.com/post";
    const metadata = {
      uploader: "testuser",
      platform: "instagram",
      nested: { foo: "bar" },
    };

    setCachedMedia({
      url,
      files: [{ telegram_file_id: "f1", file_type: "photo", file_order: 0 }],
      metadata,
    });

    const result = getCachedMedia(url);
    expect(result!.metadata).toEqual(metadata);
  });

  it("returns null for non-existent URL", () => {
    const result = getCachedMedia("https://nonexistent.com/video");
    expect(result).toBeNull();
  });

  it("overwrites existing entry for same URL", () => {
    const url = "https://example.com/video";

    setCachedMedia({
      url,
      files: [{ telegram_file_id: "old_file", file_type: "video", file_order: 0 }],
      caption: "Old caption",
    });

    setCachedMedia({
      url,
      files: [{ telegram_file_id: "new_file", file_type: "photo", file_order: 0 }],
      caption: "New caption",
    });

    const result = getCachedMedia(url);
    expect(result!.files).toHaveLength(1);
    expect(result!.files[0].telegram_file_id).toBe("new_file");
    expect(result!.caption).toBe("New caption");
  });

  it("updates last_used_at on get", async () => {
    const url = "https://example.com/video";
    setCachedMedia({
      url,
      files: [{ telegram_file_id: "f1", file_type: "video", file_order: 0 }],
    });

    const firstGet = getCachedMedia(url);
    const firstTimestamp = firstGet!.last_used_at;

    // Wait a bit to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 10));

    const secondGet = getCachedMedia(url);
    expect(secondGet!.last_used_at).toBeGreaterThan(firstTimestamp);
  });

  it("handles optional fields as undefined", () => {
    const url = "https://example.com/minimal";
    setCachedMedia({
      url,
      files: [{ telegram_file_id: "f1", file_type: "photo", file_order: 0 }],
    });

    const result = getCachedMedia(url);
    expect(result!.caption).toBeUndefined();
    expect(result!.metadata).toBeUndefined();
    expect(result!.files[0].width).toBeUndefined();
    expect(result!.files[0].height).toBeUndefined();
  });
});

describe("evictOldEntries", () => {
  beforeEach(() => {
    initCache({ dbPath: TEST_DB_PATH });
  });

  it("does nothing when under limit", () => {
    setCachedMedia({
      url: "https://example.com/1",
      files: [{ telegram_file_id: "f1", file_type: "video", file_order: 0 }],
    });
    setCachedMedia({
      url: "https://example.com/2",
      files: [{ telegram_file_id: "f2", file_type: "video", file_order: 0 }],
    });

    const evicted = evictOldEntries(10);
    expect(evicted).toBe(0);

    const stats = getCacheStats();
    expect(stats.entryCount).toBe(2);
  });

  it("removes oldest entries when over limit", async () => {
    // Create 5 entries with slight time gaps
    for (let i = 1; i <= 5; i++) {
      setCachedMedia({
        url: `https://example.com/${i}`,
        files: [{ telegram_file_id: `f${i}`, file_type: "video", file_order: 0 }],
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    // Evict down to 3 entries
    const evicted = evictOldEntries(3);
    expect(evicted).toBe(2);

    // Check that oldest entries (1 and 2) were removed
    expect(getCachedMedia("https://example.com/1")).toBeNull();
    expect(getCachedMedia("https://example.com/2")).toBeNull();
    expect(getCachedMedia("https://example.com/3")).not.toBeNull();
    expect(getCachedMedia("https://example.com/4")).not.toBeNull();
    expect(getCachedMedia("https://example.com/5")).not.toBeNull();
  });

  it("removes associated media_files via cascade", async () => {
    setCachedMedia({
      url: "https://example.com/1",
      files: [
        { telegram_file_id: "f1a", file_type: "photo", file_order: 0 },
        { telegram_file_id: "f1b", file_type: "photo", file_order: 1 },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    setCachedMedia({
      url: "https://example.com/2",
      files: [{ telegram_file_id: "f2", file_type: "video", file_order: 0 }],
    });

    const beforeStats = getCacheStats();
    expect(beforeStats.fileCount).toBe(3);

    evictOldEntries(1);

    const afterStats = getCacheStats();
    expect(afterStats.entryCount).toBe(1);
    expect(afterStats.fileCount).toBe(1); // Only entry 2's file remains
  });

  it("evicts based on last_used_at, not created_at", async () => {
    // Create entries
    setCachedMedia({
      url: "https://example.com/old",
      files: [{ telegram_file_id: "f1", file_type: "video", file_order: 0 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    setCachedMedia({
      url: "https://example.com/new",
      files: [{ telegram_file_id: "f2", file_type: "video", file_order: 0 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Access the old entry to update its last_used_at
    getCachedMedia("https://example.com/old");

    // Now old entry has newer last_used_at, so new entry should be evicted
    evictOldEntries(1);

    expect(getCachedMedia("https://example.com/old")).not.toBeNull();
    expect(getCachedMedia("https://example.com/new")).toBeNull();
  });
});

describe("getCacheStats", () => {
  beforeEach(() => {
    initCache({ dbPath: TEST_DB_PATH });
  });

  it("returns zero counts for empty cache", () => {
    const stats = getCacheStats();
    expect(stats.entryCount).toBe(0);
    expect(stats.fileCount).toBe(0);
  });

  it("returns correct counts", () => {
    setCachedMedia({
      url: "https://example.com/1",
      files: [
        { telegram_file_id: "f1", file_type: "photo", file_order: 0 },
        { telegram_file_id: "f2", file_type: "video", file_order: 1 },
      ],
    });
    setCachedMedia({
      url: "https://example.com/2",
      files: [{ telegram_file_id: "f3", file_type: "video", file_order: 0 }],
    });

    const stats = getCacheStats();
    expect(stats.entryCount).toBe(2);
    expect(stats.fileCount).toBe(3);
  });
});

describe("error handling", () => {
  it("throws when getCachedMedia called before initCache", () => {
    expect(() => getCachedMedia("https://example.com")).toThrow(
      "Cache not initialized"
    );
  });

  it("throws when setCachedMedia called before initCache", () => {
    expect(() =>
      setCachedMedia({
        url: "https://example.com",
        files: [{ telegram_file_id: "f1", file_type: "video", file_order: 0 }],
      })
    ).toThrow("Cache not initialized");
  });

  it("throws when evictOldEntries called before initCache", () => {
    expect(() => evictOldEntries(100)).toThrow("Cache not initialized");
  });
});

describe("file_type values", () => {
  beforeEach(() => {
    initCache({ dbPath: TEST_DB_PATH });
  });

  it("stores and retrieves photo type", () => {
    setCachedMedia({
      url: "https://example.com/photo",
      files: [{ telegram_file_id: "f1", file_type: "photo", file_order: 0 }],
    });
    const result = getCachedMedia("https://example.com/photo");
    expect(result!.files[0].file_type).toBe("photo");
  });

  it("stores and retrieves video type", () => {
    setCachedMedia({
      url: "https://example.com/video",
      files: [{ telegram_file_id: "f1", file_type: "video", file_order: 0 }],
    });
    const result = getCachedMedia("https://example.com/video");
    expect(result!.files[0].file_type).toBe("video");
  });

  it("stores and retrieves animation type", () => {
    setCachedMedia({
      url: "https://example.com/animation",
      files: [{ telegram_file_id: "f1", file_type: "animation", file_order: 0 }],
    });
    const result = getCachedMedia("https://example.com/animation");
    expect(result!.files[0].file_type).toBe("animation");
  });
});
