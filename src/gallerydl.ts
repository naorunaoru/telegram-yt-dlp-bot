import { spawn } from "child_process";
import { EventEmitter } from "events";

/**
 * Event emitter for gallery-dl execution, mirrors YtDlpEventEmitter interface
 */
export class GalleryDlEventEmitter extends EventEmitter {
  private process: ReturnType<typeof spawn>;

  constructor(process: ReturnType<typeof spawn>) {
    super();
    this.process = process;
  }

  kill(signal?: NodeJS.Signals): boolean {
    return this.process.kill(signal);
  }
}

export interface GalleryDlOptions {
  /** Timeout in milliseconds. If exceeded, process is killed and error emitted. */
  timeoutMs?: number;
}

/**
 * Execute gallery-dl with given arguments
 * Returns an event emitter that emits 'galleryDlEvent', 'error', and 'close' events
 *
 * Event types:
 * - 'filename': emitted for each downloaded file path
 * - 'metadata': emitted with JSON metadata (when --write-info-json or -j is used)
 * - 'stdout': other stdout lines
 * - 'stderr': stderr lines
 */
export function execGalleryDl(args: string[], options: GalleryDlOptions = {}): GalleryDlEventEmitter {
  const process = spawn("gallery-dl", args);
  const emitter = new GalleryDlEventEmitter(process);

  // Handle timeout
  let timeoutId: NodeJS.Timeout | undefined;
  if (options.timeoutMs) {
    timeoutId = setTimeout(() => {
      process.kill("SIGKILL");
      emitter.emit("error", new Error(`gallery-dl timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
  }

  let stdoutBuffer = "";
  let stderrBuffer = "";

  // Handle stdout
  process.stdout.on("data", (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      // gallery-dl with --print filename outputs just the filename per line
      // gallery-dl default output shows paths like: /path/to/file.jpg
      // When using -q (quiet) + --print filename, only filenames are output

      // Check for JSON metadata (from -j or --dump-json)
      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          JSON.parse(line); // Validate it's JSON
          emitter.emit("galleryDlEvent", "metadata", line);
          continue;
        } catch {
          // Not valid JSON, treat as regular output
        }
      }

      // Check for [filename] marker (custom format like yt-dlp)
      const filenameMatch = line.match(/^\[filename\]\s+(.+)$/);
      if (filenameMatch) {
        emitter.emit("galleryDlEvent", "filename", filenameMatch[1]);
        continue;
      }

      // Check for gallery-dl's default download messages
      // Format: "# /path/to/downloaded/file.jpg" or just the path
      const hashPathMatch = line.match(/^#\s+(.+\.[a-zA-Z0-9]+)$/);
      if (hashPathMatch) {
        emitter.emit("galleryDlEvent", "filename", hashPathMatch[1]);
        continue;
      }

      // Plain path (when using --print filename or similar)
      // Must look like an absolute or relative path to a file
      if (line.match(/^[\/\.].*\.[a-zA-Z0-9]+$/) || line.match(/^[A-Za-z]:\\.*\.[a-zA-Z0-9]+$/)) {
        emitter.emit("galleryDlEvent", "filename", line);
        continue;
      }

      // Emit other output as generic stdout events
      emitter.emit("galleryDlEvent", "stdout", line);
    }
  });

  // Handle stderr
  process.stderr.on("data", (data: Buffer) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        emitter.emit("galleryDlEvent", "stderr", line);
      }
    }
  });

  // Handle errors
  process.on("error", (error: Error) => {
    emitter.emit("error", error);
  });

  // Handle process exit
  process.on("close", (code: number | null) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (code !== 0 && code !== null) {
      emitter.emit("error", new Error(`gallery-dl exited with code ${code}`));
    } else {
      emitter.emit("close");
    }
  });

  return emitter;
}
