import { Telegraf, Context } from "telegraf";
import { execYtDlp } from "./ytdlp";
import { execGalleryDl } from "./gallerydl";
import dotenv from "dotenv";
import { message } from "telegraf/filters";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

import { patterns } from "./patterns";
import { truncateWithEllipsis } from "./helpers/text";
import { getGalleryDlCliOptionsFromEnv } from "./helpers/gallerydl";
import { getYtDlpCliOptionsFromEnv } from "./helpers/ytdlp-options";
import { getRedditDirectMediaUrls, resolveRedditShareUrl } from "./helpers/reddit";
import { explainDownloadFailure } from "./helpers/downloader-errors";
import { reactSadOnFailure } from "./helpers/reactions";
import { VideoMetadata } from "./types";
import {
  initCache,
  getCachedMedia,
  setCachedMedia,
  CachedFile,
  CachedEntry,
} from "./cache";
import { initAnalytics, logEvent, trackChat } from "./analytics";
import { startServer } from "./server";

dotenv.config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERBOSE_GROUPS = process.env.VERBOSE_GROUPS === "true";
const TEMP_DIR = "./temp";
const MAX_MEDIA_GROUP = 10;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Cache configuration
const CACHE_DB_PATH = process.env.CACHE_DB_PATH || "./data/cache.db";
const CACHE_MAX_ENTRIES = parseInt(process.env.CACHE_MAX_ENTRIES || "100000", 10);
const CACHE_EVICT_WRITES = parseInt(process.env.CACHE_EVICT_WRITES || "100", 10);

// Admin dashboard configuration
const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || "49152", 10);
const ADMIN_URL = process.env.ADMIN_URL;

// Telegram file size limits
const MAX_PHOTO_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB

// Image extensions for photo vs video detection (excluding .gif - handled separately)
const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
]);

// VAAPI device for hardware-accelerated encoding
const VAAPI_DEVICE = process.env.VAAPI_DEVICE || "/dev/dri/renderD128";

if (!TOKEN) {
  console.error(
    "Telegram bot token is not provided. Please set TELEGRAM_BOT_TOKEN in your environment variables."
  );
  process.exit(1);
}

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

const formatLog = (ctx: Context, text?: string) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  return `[User: ${userId}, Chat: ${chatId}] ${text ? text : ""}`;
};

const isPrivateChat = (ctx: Context): boolean => {
  return ctx.chat?.type === "private";
};

const isVerbose = (ctx: Context): boolean => {
  return isPrivateChat(ctx) || VERBOSE_GROUPS;
};

/**
 * Extract domain from a URL for analytics
 */
const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
};

/**
 * Get chat title for analytics logging
 */
const getChatTitle = (ctx: Context): string => {
  const chat = ctx.chat as any;
  return chat?.title || chat?.first_name || String(chat?.id || "unknown");
};

/**
 * Track chat activity for analytics
 */
const trackChatActivity = (ctx: Context): void => {
  try {
    if (ctx.chat) {
      trackChat({
        chat_id: ctx.chat.id,
        chat_title: getChatTitle(ctx),
        chat_type: ctx.chat.type,
      });
    }
  } catch (err) {
    // Non-critical, don't break message processing
  }
};

const bot = new Telegraf(TOKEN);

interface MediaFile {
  path: string;
  type: "photo" | "video";
  size: number;
  order?: number; // For gallery-dl: num field from metadata
  width?: number;  // Video dimensions for Telegram
  height?: number;
  thumbnailPath?: string; // Extracted thumbnail for Telegram
}

interface DownloadResult {
  files: MediaFile[];
  metadata: VideoMetadata;
  partialSuccess?: boolean;
  caption?: string;
}

interface VideoDownloadResult {
  path: string;
  metadata: VideoMetadata;
}

/**
 * Determine if a file is a photo or video based on extension
 */
const getMediaType = (filePath: string): "photo" | "video" => {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? "photo" : "video";
};

/**
 * Create a unique temp directory for a download request
 */
const createTempDir = (): string => {
  const dirName = `dl-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const dirPath = path.join(TEMP_DIR, dirName);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

/**
 * Clean up a temp directory and all its contents
 */
const cleanupTempDir = (dirPath: string) => {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`Error cleaning up temp dir ${dirPath}: ${err}`);
  }
};

/**
 * Check if a file is a GIF
 */
const isGifFile = (filePath: string): boolean => {
  return path.extname(filePath).toLowerCase() === ".gif";
};

/**
 * Convert a GIF file to MP4 video using ffmpeg
 * Uses VAAPI hardware acceleration if available, falls back to software encoding
 */
const convertGifToVideo = async (gifPath: string): Promise<string> => {
  const outputPath = gifPath.replace(/\.gif$/i, ".mp4");
  
  // Check if VAAPI device exists
  const useVaapi = fs.existsSync(VAAPI_DEVICE);
  
  return new Promise((resolve, reject) => {
    let ffmpegArgs: string[];
    
    if (useVaapi) {
      // Hardware-accelerated encoding with VAAPI
      // Scale to even dimensions (required by H.264) before hwupload
      ffmpegArgs = [
        "-i", gifPath,
        "-vaapi_device", VAAPI_DEVICE,
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=nv12,hwupload",
        "-c:v", "h264_vaapi",
        "-y", // Overwrite output
        outputPath,
      ];
    } else {
      // Software encoding fallback
      // Scale to even dimensions (required by H.264)
      ffmpegArgs = [
        "-i", gifPath,
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-y", // Overwrite output
        outputPath,
      ];
    }
    
    console.log(`Converting GIF to MP4 (${useVaapi ? "VAAPI" : "software"}): ${gifPath}`);
    
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);
    let stderr = "";
    
    ffmpeg.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`GIF converted successfully: ${outputPath}`);
        resolve(outputPath);
      } else {
        console.error(`ffmpeg failed with code ${code}: ${stderr}`);
        reject(new Error(`GIF conversion failed: ${stderr.slice(-200)}`));
      }
    });
    
    ffmpeg.on("error", (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });
  });
};

/**
 * Process media files: convert GIFs to MP4 and fill in missing video dimensions
 * Returns updated file list with converted paths and types
 */
const processMediaFiles = async (files: MediaFile[]): Promise<MediaFile[]> => {
  const processedFiles: MediaFile[] = [];
  
  for (const file of files) {
    let processedFile = { ...file };
    
    // Convert GIFs to MP4
    if (isGifFile(file.path)) {
      try {
        const mp4Path = await convertGifToVideo(file.path);
        const stats = fs.statSync(mp4Path);
        processedFile = {
          ...processedFile,
          path: mp4Path,
          type: "video",
          size: stats.size,
        };
      } catch (err) {
        console.error(`Failed to convert GIF, using original: ${err}`);
        // Fall back to original file (will be sent as static image)
      }
    }
    
    // Fill in missing dimensions for videos using ffprobe
    if (processedFile.type === "video" && (!processedFile.width || !processedFile.height)) {
      const dimensions = await getVideoDimensions(processedFile.path);
      if (dimensions) {
        processedFile.width = dimensions.width;
        processedFile.height = dimensions.height;
      }
    }
    
    // Extract thumbnail for videos
    if (processedFile.type === "video") {
      const thumbnailPath = await extractThumbnail(processedFile.path);
      if (thumbnailPath) {
        processedFile.thumbnailPath = thumbnailPath;
      }
    }
    
    processedFiles.push(processedFile);
  }
  
  return processedFiles;
};

/**
 * Get video dimensions using ffprobe
 * Returns { width, height } or undefined if unable to determine
 */
const getVideoDimensions = (
  filePath: string
): Promise<{ width: number; height: number } | undefined> => {
  return new Promise((resolve) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "json",
      filePath,
    ]);

    let stdout = "";
    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.on("close", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      try {
        const data = JSON.parse(stdout);
        const stream = data.streams?.[0];
        if (stream?.width && stream?.height) {
          resolve({ width: stream.width, height: stream.height });
        } else {
          resolve(undefined);
        }
      } catch {
        resolve(undefined);
      }
    });

    ffprobe.on("error", () => {
      resolve(undefined);
    });
  });
};

/**
 * Extract thumbnail from video using ffmpeg
 * Returns path to thumbnail or undefined if extraction fails
 */
const extractThumbnail = (videoPath: string): Promise<string | undefined> => {
  return new Promise((resolve) => {
    const thumbnailPath = videoPath.replace(/\.[^.]+$/, "_thumb.jpg");
    
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-ss", "00:00:01",  // Seek to 1 second
      "-vframes", "1",
      "-vf", "scale=320:-1",  // 320px wide, maintain aspect ratio
      "-q:v", "5",  // Quality (2-31, lower is better)
      thumbnailPath,
    ]);

    ffmpeg.on("close", (code) => {
      if (code === 0 && fs.existsSync(thumbnailPath)) {
        resolve(thumbnailPath);
      } else {
        resolve(undefined);
      }
    });

    ffmpeg.on("error", () => {
      resolve(undefined);
    });
  });
};

/**
 * Filter files by Telegram size limits
 * Returns files that are within limits and logs warnings for oversized files
 */
const filterByTelegramLimits = (
  files: MediaFile[],
  ctx: Context
): MediaFile[] => {
  return files.filter((file) => {
    const maxSize = file.type === "photo" ? MAX_PHOTO_SIZE : MAX_VIDEO_SIZE;
    if (file.size > maxSize) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      const limitMB = (maxSize / (1024 * 1024)).toFixed(0);
      console.log(
        formatLog(
          ctx,
          `Skipping ${file.path}: ${sizeMB}MB exceeds Telegram ${file.type} limit of ${limitMB}MB`
        )
      );
      return false;
    }
    return true;
  });
};

/**
 * Metadata fields from gallery-dl that we use for captions
 */
interface GalleryDlMetadata {
  title?: string;
  description?: string;
  content?: string; // Twitter tweet text
  caption?: string; // Instagram
  num?: number; // File ordering within a post
  [key: string]: any;
}

/**
 * Extract caption text from gallery-dl metadata
 * Different sites use different field names
 */
const extractCaption = (metadata: GalleryDlMetadata): string | undefined => {
  // Try common caption fields in order of preference
  const captionText = metadata.content || metadata.description || metadata.caption || metadata.title;
  
  // Only return non-empty strings
  if (captionText && typeof captionText === 'string' && captionText.trim()) {
    return captionText.trim();
  }
  return undefined;
};

/**
 * Download using gallery-dl
 * Returns files and metadata, or throws on complete failure
 */
const downloadWithGalleryDl = async (
  ctx: Context,
  url: string,
  tempDir: string
): Promise<DownloadResult> => {
  return new Promise((resolve, reject) => {
    console.log(formatLog(ctx, `Attempting gallery-dl for URL: ${url}`));

    // Track files with their metadata
    interface FileWithMeta {
      path: string;
      metadata?: GalleryDlMetadata;
    }
    const filesWithMeta: FileWithMeta[] = [];
    let stderrOutput: string[] = [];
    let hadError = false;
    let pendingMetadata: GalleryDlMetadata | undefined;

    // Use config file for settings, just set output directory
    // --Print (capital P) = download AND print, after: = print after file is saved
    // --write-metadata writes .json files alongside downloads for metadata
    const galleryDl = execGalleryDl(
      [
        "-q",
        "--config",
        "/etc/gallery-dl.conf",
        ...getGalleryDlCliOptionsFromEnv(),
        "-d",
        tempDir,
        "--Print",
        "after:{_path}",
        "--write-metadata",
        url,
      ],
      { timeoutMs: DOWNLOAD_TIMEOUT_MS }
    );

    const timeout = setTimeout(() => {
      console.error(formatLog(ctx, `gallery-dl timed out for URL: ${url}`));
      galleryDl.kill("SIGTERM");
      reject(new Error("Download timed out"));
    }, DOWNLOAD_TIMEOUT_MS);

    galleryDl.on("galleryDlEvent", (eventType, eventData) => {
      console.log(formatLog(ctx), `gallery-dl ${eventType}:`, eventData);

      if (eventType === "filename") {
        const filePath = eventData.trim();
        if (fs.existsSync(filePath)) {
          // Try to read metadata from .json file created by --write-metadata
          let metadata: GalleryDlMetadata | undefined;
          const metadataPath = filePath + ".json";
          if (fs.existsSync(metadataPath)) {
            try {
              const metadataContent = fs.readFileSync(metadataPath, "utf-8");
              metadata = JSON.parse(metadataContent);
            } catch {
              // JSON parse failed, proceed without metadata
            }
          }
          filesWithMeta.push({ path: filePath, metadata });
        }
      } else if (eventType === "stderr") {
        stderrOutput.push(eventData);
      }
    });

    galleryDl.on("error", (error) => {
      clearTimeout(timeout);
      console.error(formatLog(ctx, `gallery-dl error: ${error}`));
      hadError = true;

      // If we got some files before the error, return partial success
      if (filesWithMeta.length > 0) {
        console.log(
          formatLog(
            ctx,
            `gallery-dl partial success: ${filesWithMeta.length} files before error`
          )
        );
        resolveWithFiles(true);
      } else {
        reject(error);
      }
    });

    galleryDl.on("close", () => {
      clearTimeout(timeout);

      if (filesWithMeta.length === 0) {
        // Check stderr for common error patterns
        const noExtractor = stderrOutput.some((line) =>
          line.includes("No suitable extractor")
        );
        if (noExtractor) {
          reject(new Error("gallery-dl: No suitable extractor found"));
        } else {
          reject(new Error("gallery-dl: No files downloaded"));
        }
        return;
      }

      resolveWithFiles(hadError);
    });

    const resolveWithFiles = (isPartial: boolean) => {
      // Sort files by 'num' metadata field if available, otherwise preserve order
      const sortedFiles = [...filesWithMeta];
      const hasOrderInfo = sortedFiles.some(f => f.metadata?.num !== undefined);
      
      if (hasOrderInfo) {
        sortedFiles.sort((a, b) => {
          const numA = a.metadata?.num ?? Infinity;
          const numB = b.metadata?.num ?? Infinity;
          return numA - numB;
        });
      }
      // If no order info, preserve original order (don't sort)

      const mediaFiles: MediaFile[] = sortedFiles.map((file) => {
        const stats = fs.statSync(file.path);
        return {
          path: file.path,
          type: getMediaType(file.path),
          size: stats.size,
          order: file.metadata?.num,
        };
      });

      // Extract caption from first file's metadata
      const firstMeta = sortedFiles[0]?.metadata;
      const caption = firstMeta ? extractCaption(firstMeta) : undefined;

      console.log(
        formatLog(ctx, `gallery-dl completed: ${mediaFiles.length} files${isPartial ? ' (partial)' : ''}`)
      );
      resolve({
        files: mediaFiles,
        metadata: firstMeta || {},
        partialSuccess: isPartial,
        caption,
      });
    };
  });
};

/**
 * Download video using yt-dlp (original implementation)
 * Now uses the per-request temp directory for consistency with gallery-dl
 */
const downloadVideo = async (
  ctx: Context,
  url: string,
  flags: string[],
  tempDir: string
): Promise<VideoDownloadResult> => {
  // Use per-request temp directory with unique filename
  const outputPath = path.join(
    tempDir,
    `video-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  let actualOutputPath: string | undefined;
  let metadata: VideoMetadata = {};

  return new Promise((resolve, reject) => {
    console.log(formatLog(ctx, `Downloading video from URL: ${url}`));

    const download = execYtDlp([
      ...getYtDlpCliOptionsFromEnv(),
      url,
      "-o",
      outputPath,
      "--print",
      "before_dl:[metadata] %()j",
      "--print",
      "after_move:[filename] %(filepath)s",
      "--no-quiet",
      "--merge-output-format",
      "mp4",
      ...flags,
    ]);

    const timeout = setTimeout(() => {
      console.error(formatLog(ctx, `Download timed out for URL: ${url}`));
      download.kill("SIGTERM");
      reject(new Error("Download timed out"));
    }, DOWNLOAD_TIMEOUT_MS);

    download.on("ytDlpEvent", (eventType, eventData) => {
      console.log(formatLog(ctx), eventType, eventData);

      if (eventType === "filename") {
        actualOutputPath = eventData.trim();
      } else if (eventType === "metadata") {
        try {
          metadata = JSON.parse(eventData);
        } catch (err) {
          console.error(formatLog(ctx, `Failed to parse metadata: ${err}`));
        }
      }
    });

    download.on("error", (error) => {
      clearTimeout(timeout);
      console.error(formatLog(ctx, `Download error: ${error}`));
      // No need to clean up individual files - tempDir cleanup handles it
      reject(error);
    });

    download.on("close", () => {
      clearTimeout(timeout);
      if (!actualOutputPath) {
        reject(new Error("Failed to get output path from yt-dlp"));
        return;
      }
      console.log(formatLog(ctx, "Download completed"));
      resolve({ path: actualOutputPath, metadata });
    });
  });
};

const findAllMatches = (text: string) => {
  const matches: { url: string; pattern: (typeof patterns)[0] }[] = [];

  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const regexMatches = text.matchAll(pattern.regex);
    for (const match of regexMatches) {
      matches.push({ url: match[0], pattern });
    }
  }

  return matches.slice(0, MAX_MEDIA_GROUP);
};

const processVideo = (
  ctx: Context,
  url: string,
  pattern: (typeof patterns)[0],
  tempDir: string
): Promise<VideoDownloadResult> => {
  return downloadVideo(ctx, url, pattern.flags, tempDir);
};

const formatMetadata = (
  metadata: VideoMetadata,
  pattern: (typeof patterns)[0],
  url: string
) =>
  truncateWithEllipsis(
    pattern.formatMetadata ? pattern.formatMetadata(metadata, url) : undefined,
    {
      maxLength: 250,
      ellipsis: " ...",
      preserveWords: true,
    }
  );

/**
 * Split files into album-sized chunks (max 10 per album)
 */
const chunkArray = <T>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

/**
 * Telegram message with media - union of possible response types
 */
interface TelegramMediaMessage {
  photo?: Array<{ file_id: string; width: number; height: number }>;
  video?: { file_id: string; width?: number; height?: number };
  animation?: { file_id: string; width?: number; height?: number };
}

/**
 * Extract file_id and type from a Telegram message response
 */
const extractFileIdFromMessage = (
  msg: TelegramMediaMessage,
  fileIndex: number
): CachedFile | null => {
  if (msg.video) {
    return {
      telegram_file_id: msg.video.file_id,
      file_type: "video",
      file_order: fileIndex,
      width: msg.video.width,
      height: msg.video.height,
    };
  }
  if (msg.animation) {
    return {
      telegram_file_id: msg.animation.file_id,
      file_type: "animation",
      file_order: fileIndex,
      width: msg.animation.width,
      height: msg.animation.height,
    };
  }
  if (msg.photo && msg.photo.length > 0) {
    // Use largest photo (last in array)
    const largest = msg.photo[msg.photo.length - 1];
    return {
      telegram_file_id: largest.file_id,
      file_type: "photo",
      file_order: fileIndex,
      width: largest.width,
      height: largest.height,
    };
  }
  return null;
};

/**
 * Send cached media using Telegram file_ids
 * Returns true if successful, false if cache should be invalidated
 */
const sendCachedMedia = async (
  ctx: Context,
  cached: CachedEntry,
  replyToMessageId: number
): Promise<boolean> => {
  try {
    const { files, caption } = cached;

    if (files.length === 0) return false;

    if (files.length === 1) {
      const file = files[0];
      if (file.file_type === "photo") {
        await ctx.replyWithPhoto(file.telegram_file_id, {
          caption,
          reply_to_message_id: replyToMessageId,
        } as any);
      } else if (file.file_type === "animation") {
        await ctx.replyWithAnimation(file.telegram_file_id, {
          caption,
          reply_to_message_id: replyToMessageId,
        } as any);
      } else {
        await ctx.replyWithVideo(file.telegram_file_id, {
          caption,
          reply_to_message_id: replyToMessageId,
          supports_streaming: true,
        } as any);
      }
      return true;
    }

    // Multiple files - send as album(s)
    const chunks = chunkArray(files, MAX_MEDIA_GROUP);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isFirstAlbum = i === 0;

      const mediaGroup = chunk.map((file, index) => {
        const itemCaption = isFirstAlbum && index === 0 ? caption : undefined;

        if (file.file_type === "photo") {
          return {
            type: "photo" as const,
            media: file.telegram_file_id,
            caption: itemCaption,
          };
        } else {
          return {
            type: "video" as const,
            media: file.telegram_file_id,
            caption: itemCaption,
            supports_streaming: true,
          };
        }
      });

      await ctx.replyWithMediaGroup(mediaGroup, {
        reply_to_message_id: replyToMessageId,
      } as any);
    }

    return true;
  } catch (error: any) {
    // File_id might be invalid (expired or from different bot)
    console.error(`Cache send failed: ${error.message}`);
    return false;
  }
};

/**
 * Send media files as Telegram album(s)
 * Handles splitting into multiple albums if >10 files
 * Returns extracted file_ids for caching
 */
const sendMediaAlbum = async (
  ctx: Context,
  files: MediaFile[],
  replyToMessageId: number,
  caption?: string
): Promise<CachedFile[]> => {
  const extractedFiles: CachedFile[] = [];

  if (files.length === 0) return extractedFiles;

  // Single file - use appropriate method
  if (files.length === 1) {
    const file = files[0];
    let msg: TelegramMediaMessage;

    if (file.type === "photo") {
      msg = await ctx.replyWithPhoto(
        { source: fs.createReadStream(file.path), filename: path.basename(file.path) },
        {
          caption,
          reply_to_message_id: replyToMessageId,
        } as any
      );
    } else {
      msg = await ctx.replyWithVideo(
        { source: fs.createReadStream(file.path), filename: path.basename(file.path) },
        {
          caption,
          reply_to_message_id: replyToMessageId,
          supports_streaming: true,
          width: file.width,
          height: file.height,
          ...(file.thumbnailPath && { thumbnail: { source: fs.createReadStream(file.thumbnailPath), filename: path.basename(file.thumbnailPath) } }),
        } as any
      );
    }

    const extracted = extractFileIdFromMessage(msg, 0);
    if (extracted) extractedFiles.push(extracted);
    return extractedFiles;
  }

  // Multiple files - send as album(s)
  const chunks = chunkArray(files, MAX_MEDIA_GROUP);
  let fileIndex = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirstAlbum = i === 0;

    const mediaGroup = chunk.map((file, index) => {
      const itemCaption = isFirstAlbum && index === 0 ? caption : undefined;

      if (file.type === "photo") {
        return {
          type: "photo" as const,
          media: { source: fs.createReadStream(file.path), filename: path.basename(file.path) },
          caption: itemCaption,
        };
      } else {
        return {
          type: "video" as const,
          media: { source: fs.createReadStream(file.path), filename: path.basename(file.path) },
          caption: itemCaption,
          supports_streaming: true,
          width: file.width,
          height: file.height,
          ...(file.thumbnailPath && { thumbnail: { source: fs.createReadStream(file.thumbnailPath), filename: path.basename(file.thumbnailPath) } }),
        };
      }
    });

    // replyWithMediaGroup returns an array of messages
    const messages = (await ctx.replyWithMediaGroup(mediaGroup, {
      reply_to_message_id: replyToMessageId,
    } as any)) as TelegramMediaMessage[];

    // Extract file_ids from each message
    for (const msg of messages) {
      const extracted = extractFileIdFromMessage(msg, fileIndex++);
      if (extracted) extractedFiles.push(extracted);
    }
  }

  return extractedFiles;
};

const downloadDirectMediaUrls = async (
  ctx: Context,
  mediaUrls: string[],
  tempDir: string
): Promise<DownloadResult | undefined> => {
  const files: DownloadResult["files"] = [];

  for (const mediaUrl of mediaUrls) {
    const result = await downloadWithGalleryDl(ctx, mediaUrl, tempDir);
    files.push(...result.files);
  }

  if (files.length === 0) {
    return undefined;
  }

  return { files, metadata: {} as VideoMetadata };
};

/**
 * Process a single URL: try gallery-dl first, fall back to yt-dlp
 */
const processUrl = async (
  ctx: Context,
  url: string,
  pattern: (typeof patterns)[0],
  tempDir: string
): Promise<DownloadResult> => {
  const normalizedUrl = await resolveRedditShareUrl(url);
  if (normalizedUrl !== url) {
    console.log(formatLog(ctx, `Resolved Reddit share URL: ${url} -> ${normalizedUrl}`));
  }

  const directRedditMediaUrls = await getRedditDirectMediaUrls(normalizedUrl);
  if (directRedditMediaUrls.length > 0) {
    console.log(
      formatLog(
        ctx,
        `Resolved Reddit direct media URL${directRedditMediaUrls.length > 1 ? "s" : ""}: ${directRedditMediaUrls.join(", ")}`
      )
    );

    try {
      const directResult = await downloadDirectMediaUrls(ctx, directRedditMediaUrls, tempDir);
      if (directResult) {
        return directResult;
      }
    } catch (error: any) {
      console.log(
        formatLog(ctx, `Direct Reddit media download failed for ${normalizedUrl}: ${error.message}`)
      );
    }
  }

  let galleryDlError: Error | undefined;

  // Try gallery-dl first
  try {
    const result = await downloadWithGalleryDl(ctx, normalizedUrl, tempDir);
    if (result.files.length > 0) {
      return result;
    }
  } catch (error: any) {
    galleryDlError = error instanceof Error ? error : new Error(String(error));
    console.log(
      formatLog(ctx, `gallery-dl failed for ${normalizedUrl}: ${galleryDlError.message}`)
    );
    // Continue to yt-dlp fallback
  }

  // Fall back to yt-dlp
  console.log(formatLog(ctx, `Falling back to yt-dlp for ${normalizedUrl}`));

  try {
    const { path: videoPath, metadata } = await processVideo(ctx, normalizedUrl, pattern, tempDir);

    const stats = fs.statSync(videoPath);
    return {
      files: [
        {
          path: videoPath,
          type: getMediaType(videoPath),
          size: stats.size,
          width: metadata.width,
          height: metadata.height,
        },
      ],
      metadata,
      // yt-dlp caption comes from formatMetadata in the caller
    };
  } catch (error: any) {
    const ytDlpError = error instanceof Error ? error : new Error(String(error));
    const preferredError = explainDownloadFailure(normalizedUrl, ytDlpError.message);

    if (galleryDlError) {
      const galleryHint = explainDownloadFailure(normalizedUrl, galleryDlError.message);
      if (galleryHint !== preferredError) {
        throw new Error(`${preferredError}\nFallback details: ${galleryHint}`);
      }
    }

    throw new Error(preferredError);
  }
};

/**
 * Build caption for a download result
 * Handles gallery-dl captions, yt-dlp metadata, and partial success notes
 */
const buildCaption = (
  result: DownloadResult,
  pattern: (typeof patterns)[0],
  url: string
): string | undefined => {
  let caption: string | undefined;

  // Prefer gallery-dl caption if available
  if (result.caption) {
    // Append URL to gallery-dl caption for reference when forwarded
    // Reserve space for URL + newlines, truncate caption text first
    const urlSuffix = `\n\n${url}`;
    const maxCaptionLength = 250 - urlSuffix.length;
    const truncatedCaption = truncateWithEllipsis(result.caption, {
      maxLength: maxCaptionLength,
      ellipsis: " ...",
      preserveWords: true,
    });
    caption = truncatedCaption ? `${truncatedCaption}${urlSuffix}` : url;
  } else {
    // Fall back to yt-dlp style metadata formatting (already includes URL)
    caption = formatMetadata(result.metadata, pattern, url);
  }

  // If still no caption, at least include the URL for reference
  if (!caption) {
    caption = url;
  }

  // Append partial success note if applicable
  if (result.partialSuccess) {
    caption = `${caption}\n\n(some content could not be downloaded)`;
  }

  return caption;
};

bot.on(message("text"), async (ctx) => {
  const messageText = ctx.message.text;
  if (!messageText) return;

  const matches = findAllMatches(messageText);
  if (matches.length === 0) return;

  // Track chat activity for analytics
  trackChatActivity(ctx);

  const tempDir = createTempDir();

  // Keep sending typing indicator while processing (expires after 5s)
  const chatActionInterval = setInterval(() => {
    ctx.sendChatAction("typing").catch(() => {});
  }, 4000);
  await ctx.sendChatAction("typing");

  try {
    if (matches.length === 1) {
      const { url, pattern } = matches[0];
      console.log(formatLog(ctx, `Processing URL: ${url}`));

      // Check cache first
      const cached = getCachedMedia(url);
      if (cached && cached.files.length > 0) {
        console.log(formatLog(ctx, `Cache hit for ${url}`));
        const sent = await sendCachedMedia(ctx, cached, ctx.message.message_id);
        if (sent) {
          return; // Cache hit successful
        }
        // Cache send failed, fall through to re-download
        console.log(formatLog(ctx, `Cache invalid for ${url}, re-downloading`));
      }

      const result = await processUrl(ctx, url, pattern, tempDir);

      // Convert GIFs to MP4 for proper animation support
      const processedFiles = await processMediaFiles(result.files);

      // Filter by Telegram limits
      const validFiles = filterByTelegramLimits(processedFiles, ctx);

      if (validFiles.length === 0) {
        if (isVerbose(ctx)) {
          await ctx.reply("All files exceed Telegram size limits.");
        }
        return;
      }

      const caption = buildCaption(result, pattern, url);
      const extractedFiles = await sendMediaAlbum(ctx, validFiles, ctx.message.message_id, caption);

      // Cache the file_ids for future requests
      if (extractedFiles.length > 0) {
        try {
          setCachedMedia({
            url,
            files: extractedFiles,
            caption,
            metadata: result.metadata,
          });
          console.log(formatLog(ctx, `Cached ${extractedFiles.length} files for ${url}`));
        } catch (cacheError: any) {
          console.error(formatLog(ctx, `Cache write failed: ${cacheError.message}`));
        }
      }

      // Log successful download event
      try {
        logEvent({
          url,
          domain: extractDomain(url),
          chat_id: ctx.chat!.id,
          chat_title: getChatTitle(ctx),
          user_id: ctx.from!.id,
          success: true,
          file_count: validFiles.length,
        });
      } catch (e) { /* non-critical */ }
    } else {
      // Multiple URLs
      console.log(formatLog(ctx, `Processing ${matches.length} URLs`));

      if (isVerbose(ctx)) {
        await ctx.reply(`Processing ${matches.length} URLs...`);
      }

      const results = await Promise.allSettled(
        matches.map(({ url, pattern }) => processUrl(ctx, url, pattern, tempDir))
      );

      // Collect all successful files with their result info
      const allFiles: { 
        file: MediaFile; 
        url: string; 
        pattern: (typeof patterns)[0]; 
        result: DownloadResult;
      }[] = [];

      results.forEach((promiseResult, index) => {
        if (promiseResult.status === "fulfilled") {
          promiseResult.value.files.forEach((file) => {
            allFiles.push({
              file,
              url: matches[index].url,
              pattern: matches[index].pattern,
              result: promiseResult.value,
            });
          });
        }
      });

      // Filter by Telegram limits
      const validItems = allFiles.filter((item) => {
        const maxSize =
          item.file.type === "photo" ? MAX_PHOTO_SIZE : MAX_VIDEO_SIZE;
        if (item.file.size > maxSize) {
          const sizeMB = (item.file.size / (1024 * 1024)).toFixed(1);
          const limitMB = (maxSize / (1024 * 1024)).toFixed(0);
          console.log(
            formatLog(
              ctx,
              `Skipping ${item.file.path}: ${sizeMB}MB exceeds Telegram ${item.file.type} limit of ${limitMB}MB`
            )
          );
          return false;
        }
        return true;
      });

      if (validItems.length > 0) {
        // Group files into albums
        const files = validItems.map((item) => item.file);

        // Convert GIFs to MP4 for proper animation support
        const processedFiles = await processMediaFiles(files);

        // Use first item for caption
        const firstItem = validItems[0];
        const caption = buildCaption(
          firstItem.result,
          firstItem.pattern,
          firstItem.url
        );

        await sendMediaAlbum(ctx, processedFiles, ctx.message.message_id, caption);
      }

      // Log events for each URL result
      results.forEach((promiseResult, index) => {
        try {
          const matchUrl = matches[index].url;
          if (promiseResult.status === "fulfilled") {
            logEvent({
              url: matchUrl,
              domain: extractDomain(matchUrl),
              chat_id: ctx.chat!.id,
              chat_title: getChatTitle(ctx),
              user_id: ctx.from!.id,
              success: true,
              file_count: promiseResult.value.files.length,
            });
          } else {
            logEvent({
              url: matchUrl,
              domain: extractDomain(matchUrl),
              chat_id: ctx.chat!.id,
              chat_title: getChatTitle(ctx),
              user_id: ctx.from!.id,
              success: false,
              file_count: 0,
              error_message: String(promiseResult.reason?.message || promiseResult.reason).substring(0, 500),
            });
          }
        } catch (e) { /* non-critical */ }
      });

      // Report failures
      const failedDownloads = results
        .map((result, index) => ({ result, index }))
        .filter(
          (item): item is { result: PromiseRejectedResult; index: number } =>
            item.result.status === "rejected"
        );

      if (failedDownloads.length > 0) {
        await reactSadOnFailure(ctx);

        if (isPrivateChat(ctx)) {
          const errorMessages = failedDownloads
            .map(({ result, index }) => {
              const error = result.reason;
              const errorMsg = error.message || String(error);
              return `${matches[index].url}: ${errorMsg.substring(0, 100)}`;
            })
            .join("\n");

          await ctx.reply(
            `Failed to process ${failedDownloads.length} URL(s):\n${errorMessages}`
          );
        } else if (VERBOSE_GROUPS) {
          await ctx.reply(`Failed to process ${failedDownloads.length} URL(s).`);
        }
      }
    }
  } catch (error: any) {
    console.error(formatLog(ctx, `Error: ${error}`));

    // Log failed download for single-URL case
    if (matches.length === 1) {
      try {
        logEvent({
          url: matches[0].url,
          domain: extractDomain(matches[0].url),
          chat_id: ctx.chat!.id,
          chat_title: getChatTitle(ctx),
          user_id: ctx.from!.id,
          success: false,
          file_count: 0,
          error_message: String(error.message || error).substring(0, 500),
        });
      } catch (e) { /* non-critical */ }
    }

    if (matches.length === 1) {
      await reactSadOnFailure(ctx);
    }

    if (isPrivateChat(ctx)) {
      const errorMessage = error.message || String(error);
      await ctx.reply(
        `Error processing your request:\n\`\`\`\n${errorMessage}\n\`\`\``,
        {
          parse_mode: "Markdown",
        }
      );
    } else if (VERBOSE_GROUPS) {
      await ctx.reply("Error processing your request.");
    }
  } finally {
    // Stop typing indicator
    clearInterval(chatActionInterval);
    // Clean up temp directory (contains all downloaded files)
    cleanupTempDir(tempDir);
  }
});

const initializeBot = async () => {
  // Initialize cache
  try {
    initCache({
      dbPath: CACHE_DB_PATH,
      maxEntries: CACHE_MAX_ENTRIES,
      evictEveryNWrites: CACHE_EVICT_WRITES,
    });
  } catch (err) {
    console.error("Failed to initialize cache:", err);
    // Continue without cache - it's not critical
  }

  // Initialize analytics
  try {
    initAnalytics(CACHE_DB_PATH);
  } catch (err) {
    console.error("Failed to initialize analytics:", err);
  }

  // Start admin HTTP server
  try {
    startServer(TOKEN!, ADMIN_PORT);
  } catch (err) {
    console.error("Failed to start admin server:", err);
  }

  await bot.launch().catch((err) => {
    console.error("Error starting bot:", err);
    process.exit(1);
  });

  // Register Mini App menu button if ADMIN_URL is configured
  if (ADMIN_URL) {
    try {
      await bot.telegram.setChatMenuButton({
        menuButton: {
          type: "web_app",
          text: "Admin",
          web_app: { url: ADMIN_URL },
        },
      });
      console.log(`Mini App menu button set to ${ADMIN_URL}`);
    } catch (err) {
      console.error("Failed to set menu button:", err);
    }
  }

  console.log("Bot is running!");
};

initializeBot();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
