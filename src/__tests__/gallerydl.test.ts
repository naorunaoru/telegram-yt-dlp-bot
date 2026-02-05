import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execGalleryDl } from "../gallerydl.js";

// Mock child_process to avoid actually running gallery-dl
vi.mock("child_process", () => {
  const { EventEmitter } = require("events");
  const { Readable } = require("stream");

  return {
    spawn: vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = new Readable({ read() {} });
      proc.stderr = new Readable({ read() {} });
      proc.kill = vi.fn();
      return proc;
    }),
  };
});

// Get the mocked spawn to control the fake process
import { spawn } from "child_process";
const mockSpawn = vi.mocked(spawn);

const getLastProcess = () => {
  const lastCall = mockSpawn.mock.results[mockSpawn.mock.results.length - 1];
  return lastCall.value;
};

describe("execGalleryDl event parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits filename event from [filename] markers", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          expect(data).toBe("/tmp/gallery/image.jpg");
          resolve();
        }
      });

      proc.stdout.push("[filename] /tmp/gallery/image.jpg\n");
    }));

  it("emits filename event from plain path output", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          expect(data).toBe("/tmp/downloads/photo.png");
          resolve();
        }
      });

      proc.stdout.push("/tmp/downloads/photo.png\n");
    }));

  it("emits filename event from hash-prefixed path (gallery-dl default)", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/gallery"]);
      const proc = getLastProcess();

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          expect(data).toBe("/tmp/gallery/image_001.jpg");
          resolve();
        }
      });

      proc.stdout.push("# /tmp/gallery/image_001.jpg\n");
    }));

  it("emits metadata event from JSON output", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["-j", "https://example.com/image.jpg"]);
      const proc = getLastProcess();

      const metadata = JSON.stringify({
        title: "Test Image",
        width: 1920,
        height: 1080,
        extension: "jpg",
      });

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "metadata") {
          const parsed = JSON.parse(data);
          expect(parsed.title).toBe("Test Image");
          expect(parsed.width).toBe(1920);
          expect(parsed.extension).toBe("jpg");
          resolve();
        }
      });

      proc.stdout.push(`${metadata}\n`);
    }));

  it("emits stdout event for unrecognized output", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "stdout") {
          expect(data).toBe("[gallery-dl] Downloading from example.com");
          resolve();
        }
      });

      proc.stdout.push("[gallery-dl] Downloading from example.com\n");
    }));

  it("emits stderr events", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "stderr") {
          expect(data).toBe("[warning] Rate limit reached");
          resolve();
        }
      });

      proc.stderr.push("[warning] Rate limit reached\n");
    }));

  it("emits error on non-zero exit code", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("error", (error: Error) => {
        expect(error.message).toContain("exited with code 1");
        resolve();
      });

      proc.emit("close", 1);
    }));

  it("emits close on successful exit", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("close", () => {
        resolve();
      });

      proc.emit("close", 0);
    }));

  it("handles multi-file gallery output", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/gallery"]);
      const proc = getLastProcess();

      const filenames: string[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          filenames.push(data);
          if (filenames.length === 3) {
            expect(filenames).toEqual([
              "/tmp/gallery/image_001.jpg",
              "/tmp/gallery/image_002.jpg",
              "/tmp/gallery/image_003.png",
            ]);
            resolve();
          }
        }
      });

      // Simulate multi-file gallery download
      proc.stdout.push("/tmp/gallery/image_001.jpg\n");
      proc.stdout.push("/tmp/gallery/image_002.jpg\n");
      proc.stdout.push("/tmp/gallery/image_003.png\n");
    }));

  it("handles multi-line buffered output", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/gallery"]);
      const proc = getLastProcess();

      const events: string[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        events.push(`${type}:${data}`);
        if (events.length === 2) {
          expect(events[0]).toContain("stdout");
          expect(events[1]).toContain("filename");
          resolve();
        }
      });

      // Simulate data arriving in one chunk with multiple lines
      proc.stdout.push("[gallery-dl] Starting download\n/tmp/out.jpg\n");
    }));

  it("handles relative paths", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          expect(data).toBe("./downloads/image.jpg");
          resolve();
        }
      });

      proc.stdout.push("./downloads/image.jpg\n");
    }));

  it("exposes kill method", () => {
    const emitter = execGalleryDl(["https://example.com/image.jpg"]);
    const proc = getLastProcess();

    emitter.kill("SIGTERM");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("emits error on process spawn failure", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      emitter.on("error", (error: Error) => {
        expect(error.message).toBe("spawn ENOENT");
        resolve();
      });

      proc.emit("error", new Error("spawn ENOENT"));
    }));
});

describe("execGalleryDl timeout handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("kills process and emits timeout error when timeout exceeded", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"], {
        timeoutMs: 5000,
      });
      const proc = getLastProcess();

      emitter.on("error", (error: Error) => {
        expect(error.message).toContain("timed out after 5000ms");
        expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
        resolve();
      });

      // Advance timers past the timeout
      vi.advanceTimersByTime(5001);
    }));

  it("clears timeout on successful completion", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"], {
        timeoutMs: 5000,
      });
      const proc = getLastProcess();

      emitter.on("close", () => {
        // Process should not be killed after close
        expect(proc.kill).not.toHaveBeenCalled();
        resolve();
      });

      // Simulate quick completion before timeout
      vi.advanceTimersByTime(1000);
      proc.emit("close", 0);

      // Advance past timeout - should not trigger error
      vi.advanceTimersByTime(5000);
    }));
});

describe("execGalleryDl failure cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles partial success - files emitted before failure", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/gallery"]);
      const proc = getLastProcess();

      const filenames: string[] = [];
      let errorReceived: Error | null = null;

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          filenames.push(data);
        }
      });

      emitter.on("error", (error: Error) => {
        errorReceived = error;
        // Use setImmediate to let all stream events process
        setImmediate(() => {
          // Verify we got some files before the error
          expect(filenames).toEqual([
            "/tmp/gallery/image_001.jpg",
            "/tmp/gallery/image_002.jpg",
          ]);
          expect(errorReceived!.message).toContain("exited with code 1");
          resolve();
        });
      });

      // Simulate partial download - some files succeed, then failure
      proc.stdout.push("/tmp/gallery/image_001.jpg\n");
      proc.stdout.push("/tmp/gallery/image_002.jpg\n");
      proc.stderr.push("[error] Network error: Connection reset\n");
      proc.emit("close", 1);
    }));

  it("handles empty output - exit 0 but no files", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/empty-gallery"]);
      const proc = getLastProcess();

      const filenames: string[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          filenames.push(data);
        }
      });

      emitter.on("close", () => {
        // Process succeeded but no files were downloaded
        expect(filenames).toEqual([]);
        resolve();
      });

      // Emit some status messages but no filenames
      proc.stdout.push("[gallery-dl] Starting download\n");
      proc.stdout.push("[gallery-dl] No new files to download\n");
      proc.emit("close", 0);
    }));

  it("emits stderr for 'No suitable extractor found' error", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://unsupported-site.com/content"]);
      const proc = getLastProcess();

      const stderrLines: string[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "stderr") {
          stderrLines.push(data);
        }
      });

      emitter.on("error", () => {
        setImmediate(() => {
          expect(stderrLines).toContain(
            "[gallery-dl] No suitable extractor found for 'https://unsupported-site.com/content'"
          );
          resolve();
        });
      });

      proc.stderr.push(
        "[gallery-dl] No suitable extractor found for 'https://unsupported-site.com/content'\n"
      );
      proc.emit("close", 1);
    }));

  it("emits stderr for HTTP 404 error (content deleted)", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/deleted-image.jpg"]);
      const proc = getLastProcess();

      const stderrLines: string[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "stderr") {
          stderrLines.push(data);
        }
      });

      emitter.on("error", () => {
        setImmediate(() => {
          expect(stderrLines.some((line) => line.includes("HTTP Error 404"))).toBe(
            true
          );
          resolve();
        });
      });

      proc.stderr.push(
        "[gallery-dl] HTTP Error 404: Not Found for URL: https://example.com/deleted-image.jpg\n"
      );
      proc.emit("close", 1);
    }));

  it("emits stderr for HTTP 403 error (access denied / private content)", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/private-content"]);
      const proc = getLastProcess();

      const stderrLines: string[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "stderr") {
          stderrLines.push(data);
        }
      });

      emitter.on("error", () => {
        setImmediate(() => {
          expect(stderrLines.some((line) => line.includes("HTTP Error 403"))).toBe(
            true
          );
          resolve();
        });
      });

      proc.stderr.push(
        "[gallery-dl] HTTP Error 403: Forbidden for URL: https://example.com/private-content\n"
      );
      proc.emit("close", 1);
    }));

  it("parses file size from metadata output", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["-j", "https://example.com/large-video.mp4"]);
      const proc = getLastProcess();

      const metadata: { filesize?: number }[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "metadata") {
          const parsed = JSON.parse(data);
          metadata.push(parsed);
        }
      });

      emitter.on("close", () => {
        setImmediate(() => {
          // Check that file size was parsed from metadata
          expect(metadata[0].filesize).toBe(2147483648); // 2GB - exceeds Telegram's 2GB limit
          resolve();
        });
      });

      // Simulate gallery-dl JSON output with filesize
      const largeFileMetadata = JSON.stringify({
        title: "Large Video",
        extension: "mp4",
        filesize: 2147483648, // 2GB in bytes
      });
      proc.stdout.push(`${largeFileMetadata}\n`);
      proc.emit("close", 0);
    }));

  it("handles multiple HTTP errors in gallery", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/mixed-gallery"]);
      const proc = getLastProcess();

      const stderrLines: string[] = [];
      const filenames: string[] = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "stderr") {
          stderrLines.push(data);
        } else if (type === "filename") {
          filenames.push(data);
        }
      });

      emitter.on("error", () => {
        setImmediate(() => {
          // Some files succeeded, some failed with various errors
          expect(filenames).toHaveLength(2);
          expect(stderrLines.some((line) => line.includes("HTTP Error 404"))).toBe(
            true
          );
          expect(stderrLines.some((line) => line.includes("HTTP Error 403"))).toBe(
            true
          );
          resolve();
        });
      });

      // Simulate mixed results
      proc.stdout.push("/tmp/gallery/image_001.jpg\n");
      proc.stderr.push(
        "[gallery-dl] HTTP Error 404: Not Found for image_002.jpg\n"
      );
      proc.stdout.push("/tmp/gallery/image_003.jpg\n");
      proc.stderr.push(
        "[gallery-dl] HTTP Error 403: Forbidden for image_004.jpg\n"
      );
      proc.emit("close", 1);
    }));
});

describe("execGalleryDl metadata format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits filename event from tab-separated path+JSON format", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/gallery"]);
      const proc = getLastProcess();

      const metadata = JSON.stringify({
        title: "Test Image",
        num: 1,
        extension: "jpg",
      });

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          // The whole line is emitted, including path and JSON
          expect(data).toBe(`/tmp/gallery/image_001.jpg\t${metadata}`);
          
          // Verify the format can be parsed
          const tabIndex = data.indexOf('\t');
          expect(tabIndex).toBeGreaterThan(0);
          
          const path = data.substring(0, tabIndex);
          const jsonStr = data.substring(tabIndex + 1);
          
          expect(path).toBe("/tmp/gallery/image_001.jpg");
          const parsed = JSON.parse(jsonStr);
          expect(parsed.title).toBe("Test Image");
          expect(parsed.num).toBe(1);
          
          resolve();
        }
      });

      proc.stdout.push(`/tmp/gallery/image_001.jpg\t${metadata}\n`);
    }));

  it("handles multiple files with tab-separated path+JSON format", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/gallery"]);
      const proc = getLastProcess();

      const files: Array<{ path: string; num: number }> = [];

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          const tabIndex = data.indexOf('\t');
          if (tabIndex !== -1) {
            const path = data.substring(0, tabIndex);
            const jsonStr = data.substring(tabIndex + 1);
            const parsed = JSON.parse(jsonStr);
            files.push({ path, num: parsed.num });
          }
          
          if (files.length === 3) {
            // Verify all files were captured with correct ordering info
            expect(files).toEqual([
              { path: "/tmp/gallery/image_001.jpg", num: 1 },
              { path: "/tmp/gallery/image_002.jpg", num: 2 },
              { path: "/tmp/gallery/image_003.jpg", num: 3 },
            ]);
            resolve();
          }
        }
      });

      // Simulate multi-file gallery download with metadata
      const meta1 = JSON.stringify({ num: 1, title: "Image 1" });
      const meta2 = JSON.stringify({ num: 2, title: "Image 2" });
      const meta3 = JSON.stringify({ num: 3, title: "Image 3" });
      
      proc.stdout.push(`/tmp/gallery/image_001.jpg\t${meta1}\n`);
      proc.stdout.push(`/tmp/gallery/image_002.jpg\t${meta2}\n`);
      proc.stdout.push(`/tmp/gallery/image_003.jpg\t${meta3}\n`);
    }));

  it("handles relative paths with tab-separated JSON", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://example.com/image.jpg"]);
      const proc = getLastProcess();

      const metadata = JSON.stringify({ num: 1, content: "Tweet text" });

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          const tabIndex = data.indexOf('\t');
          const path = data.substring(0, tabIndex);
          expect(path).toBe("./downloads/image.jpg");
          resolve();
        }
      });

      proc.stdout.push(`./downloads/image.jpg\t${metadata}\n`);
    }));

  it("extracts caption fields from metadata (content for Twitter)", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://twitter.com/user/status/123"]);
      const proc = getLastProcess();

      const metadata = JSON.stringify({
        num: 1,
        content: "This is the tweet text!",
        title: "Tweet by @user",
      });

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          const tabIndex = data.indexOf('\t');
          const jsonStr = data.substring(tabIndex + 1);
          const parsed = JSON.parse(jsonStr);
          
          // Content field should be available for caption
          expect(parsed.content).toBe("This is the tweet text!");
          resolve();
        }
      });

      proc.stdout.push(`/tmp/twitter/image.jpg\t${metadata}\n`);
    }));

  it("extracts caption fields from metadata (description for Instagram)", () =>
    new Promise<void>((resolve) => {
      const emitter = execGalleryDl(["https://instagram.com/p/abc123"]);
      const proc = getLastProcess();

      const metadata = JSON.stringify({
        num: 1,
        description: "Instagram caption here #hashtag",
      });

      emitter.on("galleryDlEvent", (type: string, data: string) => {
        if (type === "filename") {
          const tabIndex = data.indexOf('\t');
          const jsonStr = data.substring(tabIndex + 1);
          const parsed = JSON.parse(jsonStr);
          
          expect(parsed.description).toBe("Instagram caption here #hashtag");
          resolve();
        }
      });

      proc.stdout.push(`/tmp/instagram/image.jpg\t${metadata}\n`);
    }));
});
