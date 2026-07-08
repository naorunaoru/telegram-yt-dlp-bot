import { spawn } from "child_process";
import { EventEmitter } from "events";
import { summarizeProcessFailure } from "./helpers/downloader-errors";

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
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  const handleStdoutLine = (line: string) => {
    // Parse [filename] marker from --print "after_move:[filename] %(filepath)s"
    const filenameMatch = line.match(/^\[filename\]\s+(.+)$/);
    if (filenameMatch) {
      emitter.emit("ytDlpEvent", "filename", filenameMatch[1]);
      return;
    }

    // Parse [metadata] marker from --print "before_dl:[metadata] %()j"
    const metadataMatch = line.match(/^\[metadata\]\s+(.+)$/);
    if (metadataMatch) {
      emitter.emit("ytDlpEvent", "metadata", metadataMatch[1]);
      return;
    }

    if (line.trim()) {
      stdoutLines.push(line);
      emitter.emit("ytDlpEvent", "stdout", line);
    }
  };

  const handleStderrLine = (line: string) => {
    if (line.trim()) {
      stderrLines.push(line);
      emitter.emit("ytDlpEvent", "stderr", line);
    }
  };

  const flushRemainingBuffers = () => {
    if (stdoutBuffer.trim()) {
      handleStdoutLine(stdoutBuffer);
      stdoutBuffer = "";
    }

    if (stderrBuffer.trim()) {
      handleStderrLine(stderrBuffer);
      stderrBuffer = "";
    }
  };

  // Handle stdout
  process.stdout.on("data", (data: Buffer) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      handleStdoutLine(line);
    }
  });

  // Handle stderr
  process.stderr.on("data", (data: Buffer) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() || "";

    for (const line of lines) {
      handleStderrLine(line);
    }
  });

  // Handle errors
  process.on("error", (error: Error) => {
    emitter.emit("error", error);
  });

  // Handle process exit
  process.on("close", (code: number | null) => {
    flushRemainingBuffers();

    if (code !== 0 && code !== null) {
      emitter.emit(
        "error",
        new Error(summarizeProcessFailure("yt-dlp", code, stderrLines, stdoutLines))
      );
    } else {
      emitter.emit("close");
    }
  });

  return emitter;
}
