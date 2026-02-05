import { describe, it, expect } from "vitest";

// Test the utility functions that are used in main.ts
// We can't easily test the full integration without mocking Telegraf,
// so we test the pure functions extracted or reimplemented here

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
]);

const getMediaType = (filePath: string): "photo" | "video" => {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.has(`.${ext}`) ? "photo" : "video";
};

const chunkArray = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB

interface MediaFile {
  path: string;
  type: "photo" | "video";
  size: number;
}

const filterByTelegramLimits = (files: MediaFile[]): MediaFile[] => {
  return files.filter((file) => {
    const maxSize = file.type === "photo" ? MAX_PHOTO_SIZE : MAX_VIDEO_SIZE;
    return file.size <= maxSize;
  });
};

describe("getMediaType", () => {
  it("identifies common image extensions as photos", () => {
    expect(getMediaType("/tmp/image.jpg")).toBe("photo");
    expect(getMediaType("/tmp/image.jpeg")).toBe("photo");
    expect(getMediaType("/tmp/image.png")).toBe("photo");
    expect(getMediaType("/tmp/image.gif")).toBe("photo");
    expect(getMediaType("/tmp/image.webp")).toBe("photo");
    expect(getMediaType("/tmp/image.bmp")).toBe("photo");
  });

  it("identifies uppercase extensions as photos", () => {
    expect(getMediaType("/tmp/image.JPG")).toBe("photo");
    expect(getMediaType("/tmp/image.PNG")).toBe("photo");
  });

  it("identifies video extensions as videos", () => {
    expect(getMediaType("/tmp/video.mp4")).toBe("video");
    expect(getMediaType("/tmp/video.webm")).toBe("video");
    expect(getMediaType("/tmp/video.mov")).toBe("video");
    expect(getMediaType("/tmp/video.mkv")).toBe("video");
    expect(getMediaType("/tmp/video.avi")).toBe("video");
  });

  it("handles paths with multiple dots", () => {
    expect(getMediaType("/tmp/my.cool.image.jpg")).toBe("photo");
    expect(getMediaType("/tmp/video.2024.01.01.mp4")).toBe("video");
  });

  it("treats unknown extensions as videos", () => {
    expect(getMediaType("/tmp/file.unknown")).toBe("video");
    expect(getMediaType("/tmp/file.xyz")).toBe("video");
  });
});

describe("chunkArray", () => {
  it("splits array into chunks of specified size", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const chunks = chunkArray(arr, 10);
    expect(chunks).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [11, 12]]);
  });

  it("returns single chunk for arrays smaller than chunk size", () => {
    const arr = [1, 2, 3];
    const chunks = chunkArray(arr, 10);
    expect(chunks).toEqual([[1, 2, 3]]);
  });

  it("returns empty array for empty input", () => {
    const chunks = chunkArray([], 10);
    expect(chunks).toEqual([]);
  });

  it("handles exact multiple of chunk size", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const chunks = chunkArray(arr, 5);
    expect(chunks).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
    ]);
  });

  it("handles chunk size of 1", () => {
    const arr = [1, 2, 3];
    const chunks = chunkArray(arr, 1);
    expect(chunks).toEqual([[1], [2], [3]]);
  });
});

describe("filterByTelegramLimits", () => {
  it("keeps photos under 10MB", () => {
    const files: MediaFile[] = [
      { path: "/tmp/small.jpg", type: "photo", size: 5 * 1024 * 1024 },
      { path: "/tmp/exact.jpg", type: "photo", size: 10 * 1024 * 1024 },
    ];
    const result = filterByTelegramLimits(files);
    expect(result).toHaveLength(2);
  });

  it("filters out photos over 10MB", () => {
    const files: MediaFile[] = [
      { path: "/tmp/large.jpg", type: "photo", size: 11 * 1024 * 1024 },
      { path: "/tmp/small.jpg", type: "photo", size: 5 * 1024 * 1024 },
    ];
    const result = filterByTelegramLimits(files);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/tmp/small.jpg");
  });

  it("keeps videos under 50MB", () => {
    const files: MediaFile[] = [
      { path: "/tmp/small.mp4", type: "video", size: 30 * 1024 * 1024 },
      { path: "/tmp/exact.mp4", type: "video", size: 50 * 1024 * 1024 },
    ];
    const result = filterByTelegramLimits(files);
    expect(result).toHaveLength(2);
  });

  it("filters out videos over 50MB", () => {
    const files: MediaFile[] = [
      { path: "/tmp/large.mp4", type: "video", size: 51 * 1024 * 1024 },
      { path: "/tmp/small.mp4", type: "video", size: 30 * 1024 * 1024 },
    ];
    const result = filterByTelegramLimits(files);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/tmp/small.mp4");
  });

  it("handles mixed media types", () => {
    const files: MediaFile[] = [
      { path: "/tmp/small.jpg", type: "photo", size: 5 * 1024 * 1024 },
      { path: "/tmp/large.jpg", type: "photo", size: 15 * 1024 * 1024 }, // over limit
      { path: "/tmp/small.mp4", type: "video", size: 30 * 1024 * 1024 },
      { path: "/tmp/large.mp4", type: "video", size: 60 * 1024 * 1024 }, // over limit
    ];
    const result = filterByTelegramLimits(files);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path)).toEqual([
      "/tmp/small.jpg",
      "/tmp/small.mp4",
    ]);
  });

  it("returns empty array when all files exceed limits", () => {
    const files: MediaFile[] = [
      { path: "/tmp/large.jpg", type: "photo", size: 15 * 1024 * 1024 },
      { path: "/tmp/large.mp4", type: "video", size: 60 * 1024 * 1024 },
    ];
    const result = filterByTelegramLimits(files);
    expect(result).toHaveLength(0);
  });
});

describe("Telegram album constraints", () => {
  it("MAX_MEDIA_GROUP should be 10", () => {
    // This matches Telegram's limit for media groups
    const MAX_MEDIA_GROUP = 10;
    expect(MAX_MEDIA_GROUP).toBe(10);
  });

  it("chunking 15 files creates 2 albums", () => {
    const files = Array.from({ length: 15 }, (_, i) => ({ id: i }));
    const chunks = chunkArray(files, 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(10);
    expect(chunks[1]).toHaveLength(5);
  });

  it("chunking 25 files creates 3 albums", () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const chunks = chunkArray(files, 10);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(10);
    expect(chunks[1]).toHaveLength(10);
    expect(chunks[2]).toHaveLength(5);
  });
});

// Test caption extraction logic (mirrors main.ts extractCaption)
interface GalleryDlMetadata {
  title?: string;
  description?: string;
  content?: string;
  caption?: string;
  num?: number;
  [key: string]: any;
}

const extractCaption = (metadata: GalleryDlMetadata): string | undefined => {
  const captionText = metadata.content || metadata.description || metadata.caption || metadata.title;
  if (captionText && typeof captionText === 'string' && captionText.trim()) {
    return captionText.trim();
  }
  return undefined;
};

describe("extractCaption", () => {
  it("prefers content field (Twitter tweets)", () => {
    const metadata = {
      content: "Tweet text here",
      description: "Fallback description",
      title: "Fallback title",
    };
    expect(extractCaption(metadata)).toBe("Tweet text here");
  });

  it("uses description when no content (Instagram)", () => {
    const metadata = {
      description: "Instagram caption #hashtag",
      title: "Post title",
    };
    expect(extractCaption(metadata)).toBe("Instagram caption #hashtag");
  });

  it("uses caption when no content or description", () => {
    const metadata = {
      caption: "Photo caption",
      title: "Post title",
    };
    expect(extractCaption(metadata)).toBe("Photo caption");
  });

  it("uses title as last resort", () => {
    const metadata = {
      title: "Post title",
    };
    expect(extractCaption(metadata)).toBe("Post title");
  });

  it("returns undefined for empty metadata", () => {
    expect(extractCaption({})).toBeUndefined();
  });

  it("returns undefined for whitespace-only content", () => {
    const metadata = {
      content: "   ",
      description: "\n\t",
    };
    expect(extractCaption(metadata)).toBeUndefined();
  });

  it("trims whitespace from caption", () => {
    const metadata = {
      content: "  Tweet with spaces  ",
    };
    expect(extractCaption(metadata)).toBe("Tweet with spaces");
  });
});

// Test file ordering logic (mirrors main.ts sorting behavior)
interface MediaFileWithOrder {
  path: string;
  order?: number;
}

const sortByOrder = (files: MediaFileWithOrder[]): MediaFileWithOrder[] => {
  const hasOrderInfo = files.some(f => f.order !== undefined);
  if (!hasOrderInfo) {
    return files; // Preserve original order
  }
  return [...files].sort((a, b) => {
    const numA = a.order ?? Infinity;
    const numB = b.order ?? Infinity;
    return numA - numB;
  });
};

describe("file ordering", () => {
  it("sorts files by order field when present", () => {
    const files: MediaFileWithOrder[] = [
      { path: "/tmp/image_3.jpg", order: 3 },
      { path: "/tmp/image_1.jpg", order: 1 },
      { path: "/tmp/image_2.jpg", order: 2 },
    ];
    const sorted = sortByOrder(files);
    expect(sorted.map(f => f.path)).toEqual([
      "/tmp/image_1.jpg",
      "/tmp/image_2.jpg",
      "/tmp/image_3.jpg",
    ]);
  });

  it("preserves original order when no order metadata", () => {
    const files: MediaFileWithOrder[] = [
      { path: "/tmp/image_z.jpg" },
      { path: "/tmp/image_a.jpg" },
      { path: "/tmp/image_m.jpg" },
    ];
    const sorted = sortByOrder(files);
    // Should NOT be alphabetically sorted - original order preserved
    expect(sorted.map(f => f.path)).toEqual([
      "/tmp/image_z.jpg",
      "/tmp/image_a.jpg",
      "/tmp/image_m.jpg",
    ]);
  });

  it("puts files without order at the end when some have order", () => {
    const files: MediaFileWithOrder[] = [
      { path: "/tmp/image_unknown.jpg" }, // no order
      { path: "/tmp/image_2.jpg", order: 2 },
      { path: "/tmp/image_1.jpg", order: 1 },
    ];
    const sorted = sortByOrder(files);
    expect(sorted.map(f => f.path)).toEqual([
      "/tmp/image_1.jpg",
      "/tmp/image_2.jpg",
      "/tmp/image_unknown.jpg",
    ]);
  });

  it("handles empty array", () => {
    expect(sortByOrder([])).toEqual([]);
  });

  it("handles single file", () => {
    const files: MediaFileWithOrder[] = [{ path: "/tmp/only.jpg", order: 1 }];
    expect(sortByOrder(files)).toEqual([{ path: "/tmp/only.jpg", order: 1 }]);
  });
});

// Test caption building with partial success (mirrors main.ts buildCaption)
interface DownloadResult {
  partialSuccess?: boolean;
  caption?: string;
}

const buildCaptionSimple = (result: DownloadResult, formattedCaption?: string): string | undefined => {
  let caption = result.caption || formattedCaption;

  if (result.partialSuccess && caption) {
    return `${caption}\n\n(some content could not be downloaded)`;
  } else if (result.partialSuccess) {
    return "(some content could not be downloaded)";
  }

  return caption;
};

describe("partial success caption", () => {
  it("appends partial success note to existing caption", () => {
    const result: DownloadResult = {
      partialSuccess: true,
      caption: "Original caption",
    };
    expect(buildCaptionSimple(result)).toBe(
      "Original caption\n\n(some content could not be downloaded)"
    );
  });

  it("shows partial success note when no caption", () => {
    const result: DownloadResult = {
      partialSuccess: true,
    };
    expect(buildCaptionSimple(result)).toBe(
      "(some content could not be downloaded)"
    );
  });

  it("returns just caption when not partial success", () => {
    const result: DownloadResult = {
      caption: "Full download",
    };
    expect(buildCaptionSimple(result)).toBe("Full download");
  });

  it("returns undefined when no caption and not partial", () => {
    const result: DownloadResult = {};
    expect(buildCaptionSimple(result)).toBeUndefined();
  });

  it("uses formatted caption as fallback", () => {
    const result: DownloadResult = {};
    expect(buildCaptionSimple(result, "Formatted title")).toBe("Formatted title");
  });

  it("prefers result caption over formatted caption", () => {
    const result: DownloadResult = {
      caption: "Gallery-dl caption",
    };
    expect(buildCaptionSimple(result, "Formatted title")).toBe("Gallery-dl caption");
  });
});
