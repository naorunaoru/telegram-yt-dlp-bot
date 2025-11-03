import { spawn } from "child_process";
import { EventEmitter } from "events";
import { VideoMetadata } from "./types";

/**
 * Event emitter for yt-dlp execution, mimics yt-dlp-wrap's interface
 */
export class YtDlpEventEmitter extends EventEmitter {
  private process: ReturnType<typeof spawn>;

  constructor(process: ReturnType<typeof spawn>) {
    super();
    this.process = process;
  }

  kill(signal?: NodeJS.Signals): boolean {
    return this.process.kill(signal);
  }
}

/**
 * Execute yt-dlp with given arguments
 * Returns an event emitter that emits 'ytDlpEvent', 'error', and 'close' events
 */
export function execYtDlp(args: string[]): YtDlpEventEmitter {
  const process = spawn("yt-dlp", args);
  const emitter = new YtDlpEventEmitter(process);

  let stdoutBuffer = "";
  let stderrBuffer = "";

  // Handle stdout
  process.stdout.on("data", (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      // Parse [filename] marker from --print "after_move:[filename] %(filepath)s"
      const filenameMatch = line.match(/^\[filename\]\s+(.+)$/);
      if (filenameMatch) {
        emitter.emit("ytDlpEvent", "filename", filenameMatch[1]);
      } else if (line.trim()) {
        // Emit other output as generic events
        emitter.emit("ytDlpEvent", "stdout", line);
      }
    }
  });

  // Handle stderr
  process.stderr.on("data", (data: Buffer) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        emitter.emit("ytDlpEvent", "stderr", line);
      }
    }
  });

  // Handle errors
  process.on("error", (error: Error) => {
    emitter.emit("error", error);
  });

  // Handle process exit
  process.on("close", (code: number | null) => {
    if (code !== 0 && code !== null) {
      emitter.emit("error", new Error(`yt-dlp exited with code ${code}`));
    } else {
      emitter.emit("close");
    }
  });

  return emitter;
}

/**
 * Get video info/metadata using yt-dlp --dump-json
 * Returns a promise that resolves to the video metadata
 */
export function getVideoInfo(args: string[]): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const process = spawn("yt-dlp", ["--dump-json", ...args]);

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    process.on("error", (error: Error) => {
      reject(error);
    });

    process.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Parse JSON output
        const metadata = JSON.parse(stdout);
        resolve(metadata);
      } catch (error) {
        reject(new Error(`Failed to parse yt-dlp JSON output: ${error}`));
      }
    });
  });
}
