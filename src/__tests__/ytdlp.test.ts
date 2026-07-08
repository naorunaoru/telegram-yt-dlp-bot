import { describe, it, expect, vi } from "vitest";
import { execYtDlp } from "../ytdlp.js";

// Mock child_process to avoid actually running yt-dlp
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

describe("execYtDlp event parsing", () => {
  it("emits filename event from [filename] markers", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      emitter.on("ytDlpEvent", (type: string, data: string) => {
        if (type === "filename") {
          expect(data).toBe("/tmp/video.mp4");
          resolve();
        }
      });

      proc.stdout.push("[filename] /tmp/video.mp4\n");
    }));

  it("emits metadata event from [metadata] markers", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      const metadata = JSON.stringify({ title: "Test", width: 1920 });

      emitter.on("ytDlpEvent", (type: string, data: string) => {
        if (type === "metadata") {
          const parsed = JSON.parse(data);
          expect(parsed.title).toBe("Test");
          expect(parsed.width).toBe(1920);
          resolve();
        }
      });

      proc.stdout.push(`[metadata] ${metadata}\n`);
    }));

  it("emits stdout event for unrecognized output", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      emitter.on("ytDlpEvent", (type: string, data: string) => {
        if (type === "stdout") {
          expect(data).toBe("[download] 50.0% of 10.00MiB");
          resolve();
        }
      });

      proc.stdout.push("[download] 50.0% of 10.00MiB\n");
    }));

  it("emits error on non-zero exit code", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      emitter.on("error", (error: Error) => {
        expect(error.message).toContain("exited with code 1");
        resolve();
      });

      proc.stderr.emit("data", Buffer.from("ERROR: Sign in to confirm you're not a bot\n"));
      proc.emit("close", 1);
    }));

  it("emits close on successful exit", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      emitter.on("close", () => {
        resolve();
      });

      proc.emit("close", 0);
    }));

  it("handles multi-line buffered output", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      const events: string[] = [];

      emitter.on("ytDlpEvent", (type: string, data: string) => {
        events.push(`${type}:${data}`);
        if (events.length === 2) {
          expect(events[0]).toContain("stdout");
          expect(events[1]).toContain("filename");
          resolve();
        }
      });

      // Simulate data arriving in one chunk with multiple lines
      proc.stdout.push("[download] 100%\n[filename] /tmp/out.mp4\n");
    }));

  it("includes meaningful stderr details in error messages", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      emitter.on("error", (error: Error) => {
        expect(error.message).toBe(
          "yt-dlp exited with code 1: Instagram sent an empty media response"
        );
        resolve();
      });

      proc.stderr.emit("data", Buffer.from("ERROR: Instagram sent an empty media response\n"));
      proc.emit("close", 1);
    }));

  it("includes unterminated stderr details in error messages", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      emitter.on("error", (error: Error) => {
        expect(error.message).toBe(
          "yt-dlp exited with code 1: Account authentication is required"
        );
        resolve();
      });

      proc.stderr.emit("data", Buffer.from("ERROR: Account authentication is required"));
      proc.emit("close", 1);
    }));

  it("parses unterminated filename markers before close", () =>
    new Promise<void>((resolve) => {
      const emitter = execYtDlp(["https://example.com"]);
      const proc = getLastProcess();

      emitter.on("ytDlpEvent", (type: string, data: string) => {
        if (type === "filename") {
          expect(data).toBe("/tmp/final.mp4");
          resolve();
        }
      });

      proc.stdout.emit("data", Buffer.from("[filename] /tmp/final.mp4"));
      proc.emit("close", 0);
    }));

  it("exposes kill method", () => {
    const emitter = execYtDlp(["https://example.com"]);
    const proc = getLastProcess();

    emitter.kill("SIGTERM");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
