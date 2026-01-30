import { Telegraf, Context } from "telegraf";
import { execYtDlp, getVideoInfo } from "./ytdlp";
import dotenv from "dotenv";
import { message } from "telegraf/filters";
import fs from "fs";
import path from "path";

import { patterns } from "./patterns";
import { truncateWithEllipsis } from "./helpers/text";
import { VideoMetadata } from "./types";

dotenv.config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERBOSE_GROUPS = process.env.VERBOSE_GROUPS === "true";
const TEMP_DIR = "./temp";
const MAX_MEDIA_GROUP = 10;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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

const bot = new Telegraf(TOKEN);

interface VideoDownloadResult {
  path: string;
  metadata: VideoMetadata;
}

const downloadVideo = async (
  ctx: Context,
  url: string,
  flags: string[]
): Promise<string> => {
  const outputPath = path.join(
    TEMP_DIR,
    `video-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  let actualOutputPath: string | undefined;

  return new Promise((resolve, reject) => {
    console.log(formatLog(ctx, `Downloading video from URL: ${url}`));

    const download = execYtDlp([
      url,
      "-o",
      outputPath,
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
      }
    });

    download.on("error", (error) => {
      clearTimeout(timeout);
      console.error(formatLog(ctx, `Download error: ${error}`));

      fs.unlink(outputPath, (err) => {
        if (err) console.error(formatLog(ctx, `Cleanup failed: ${err}`));
      });
      reject(error);
    });

    download.on("close", () => {
      clearTimeout(timeout);
      if (!actualOutputPath) {
        reject(new Error("Failed to get output path from yt-dlp"));
        return;
      }
      console.log(formatLog(ctx, "Download completed"));
      resolve(actualOutputPath);
    });
  });
};

const findAllMatches = (text: string) => {
  const matches: { url: string; pattern: (typeof patterns)[0] }[] = [];

  for (const pattern of patterns) {
    const regexMatches = text.matchAll(pattern.regex);
    for (const match of regexMatches) {
      matches.push({ url: match[0], pattern });
    }
  }

  return matches.slice(0, MAX_MEDIA_GROUP);
};

const processVideo = async (
  ctx: Context,
  url: string,
  pattern: (typeof patterns)[0]
): Promise<VideoDownloadResult> => {
  const metadata = await getVideoInfo([url, ...pattern.flags]);

  const videoPath = await downloadVideo(ctx, url, pattern.flags);

  return {
    path: videoPath,
    metadata,
  };
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

const cleanupFiles = (files: string[]) => {
  files.forEach((file) => {
    fs.unlink(file, (err) => {
      if (err) {
        console.error(`Error deleting temp file ${file}: ${err}`);
      }
    });
  });
};

bot.on(message("text"), async (ctx) => {
  const messageText = ctx.message.text;
  if (!messageText) return;

  const matches = findAllMatches(messageText);
  if (matches.length === 0) return;

  const filesToCleanup: string[] = [];

  try {
    if (matches.length === 1) {
      const { url, pattern } = matches[0];
      console.log(formatLog(ctx, `Processing single video from URL: ${url}`));

      const { path: videoPath, metadata } = await processVideo(
        ctx,
        url,
        pattern
      );
      filesToCleanup.push(videoPath);

      await ctx.replyWithVideo(
        { source: fs.createReadStream(videoPath) },
        {
          caption: formatMetadata(metadata, pattern, url),
          reply_parameters: {
            message_id: ctx.message.message_id,
          },
          supports_streaming: true,
          width: metadata.width,
          height: metadata.height,
        }
      );
    } else {
      console.log(formatLog(ctx, `Processing ${matches.length} videos`));

      if (isVerbose(ctx)) {
        await ctx.reply(`Processing ${matches.length} videos...`);
      }

      const results = await Promise.allSettled(
        matches.map(({ url, pattern }) => processVideo(ctx, url, pattern))
      );

      const successfulDownloads = results
        .map((result, index) => ({
          result,
          url: matches[index].url,
          pattern: matches[index].pattern,
        }))
        .filter(
          (
            item
          ): item is {
            result: PromiseFulfilledResult<VideoDownloadResult>;
            url: string;
            pattern: (typeof patterns)[0];
          } => item.result.status === "fulfilled"
        );

      // Track all downloaded files for cleanup
      successfulDownloads.forEach(({ result }) => {
        filesToCleanup.push(result.value.path);
      });

      if (successfulDownloads.length > 0) {
        const mediaGroup = successfulDownloads.map(({ result, url, pattern }) => ({
          type: "video" as const,
          media: { source: fs.createReadStream(result.value.path) },
          caption: formatMetadata(result.value.metadata, pattern, url),
        }));

        await ctx.replyWithMediaGroup(mediaGroup, {
          reply_parameters: {
            message_id: ctx.message.message_id,
          },
        });
      }

      const failedDownloads = results
        .map((result, index) => ({ result, index }))
        .filter(
          (item): item is { result: PromiseRejectedResult; index: number } =>
            item.result.status === "rejected"
        );

      if (failedDownloads.length > 0) {
        if (isPrivateChat(ctx)) {
          const errorMessages = failedDownloads
            .map(({ result, index }) => {
              const error = result.reason;
              const errorMsg = error.message || String(error);
              return `${matches[index].url}: ${errorMsg.substring(0, 100)}`;
            })
            .join("\n");

          await ctx.reply(
            `Failed to process ${failedDownloads.length} video(s):\n${errorMessages}`
          );
        } else if (VERBOSE_GROUPS) {
          await ctx.reply(
            `Failed to process ${failedDownloads.length} video(s).`
          );
        }
      }
    }
  } catch (error: any) {
    console.error(formatLog(ctx, `Error: ${error}`));

    if (isPrivateChat(ctx)) {
      const errorMessage = error.message || String(error);
      await ctx.reply(`Error processing your request:\n\`\`\`\n${errorMessage}\n\`\`\``, {
        parse_mode: "Markdown",
      });
    } else if (VERBOSE_GROUPS) {
      await ctx.reply("Error processing your request.");
    }
  } finally {
    cleanupFiles(filesToCleanup);
  }
});

const initializeBot = async () => {
  await bot.launch().catch((err) => {
    console.error("Error starting bot:", err);
    process.exit(1);
  });

  console.log("Bot is running!");
};

initializeBot();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
