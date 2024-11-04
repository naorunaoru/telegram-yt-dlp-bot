import { Telegraf } from "telegraf";
import YTDlpWrap from "yt-dlp-wrap";
import dotenv from "dotenv";
import { message } from "telegraf/filters";
import fs from "fs";
import path from "path";

import { patterns } from "./patterns";
import { truncateWithEllipsis } from "./helpers/text";

dotenv.config();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERBOSE = process.env.VERBOSE === "true";
const TEMP_DIR = "./temp";
const MAX_MEDIA_GROUP = 10;

if (!TOKEN) {
  console.error(
    "Telegram bot token is not provided. Please set TELEGRAM_BOT_TOKEN in your environment variables."
  );
  process.exit(1);
}

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

const formatLog = (ctx: any, text?: string) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  return `[User: ${userId}, Chat: ${chatId}] ${text ? text : ""}`;
};

const bot = new Telegraf(TOKEN);
const ytDlpWrap = new YTDlpWrap("./yt-dlp");

interface VideoDownloadResult {
  path: string;
  metadata: string | undefined;
}

const DEFAULT_FLAGS = [
  "-f",
  "bv*+ba/b",
  "-S",
  "res:720,+vcodec:avc",
  "--recode-video",
  "mp4",
];

const downloadVideo = async (
  ctx: any,
  url: string,
  flags: string[]
): Promise<string> => {
  const outputPath = path.join(
    TEMP_DIR,
    `video-${Date.now()}-${Math.random().toString(36).substring(7)}`
  );

  let actualOutputPath: string;

  return new Promise((resolve, reject) => {
    console.log(formatLog(ctx, `Downloading video from URL: ${url}`));

    const download = ytDlpWrap.exec([
      url,
      "-o",
      outputPath,
      "--print",
      "after_move:[filename] %(filepath)s",
      "--no-quiet",
      ...DEFAULT_FLAGS,
      ...flags,
    ]);

    let lastLog = 0;

    download.on("progress", async (progress) => {
      const now = Date.now();
      if (now - lastLog >= 5000) {
        console.log(
          formatLog(ctx),
          progress.percent,
          progress.totalSize,
          progress.currentSpeed,
          progress.eta
        );

        lastLog = now;
      }
    });

    download.on("ytDlpEvent", (eventType, eventData) => {
      console.log(formatLog(ctx), eventType, eventData);

      if (eventType === "filename") {
        actualOutputPath = eventData.trim();
      }
    });

    download.on("error", (error) => {
      console.error(formatLog(ctx, `Download error: ${error}`));
      fs.unlink(outputPath, () => {});
      reject(error);
    });

    download.on("close", () => {
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
  ctx: any,
  url: string,
  pattern: (typeof patterns)[0]
): Promise<VideoDownloadResult> => {
  const metadata = await ytDlpWrap.getVideoInfo([
    url,
    ...DEFAULT_FLAGS,
    ...pattern.flags,
  ]);

  const formattedMetadata = truncateWithEllipsis(
    pattern.formatMetadata ? pattern.formatMetadata(metadata) : undefined,
    {
      maxLength: 250,
      ellipsis: " ...",
      preserveWords: true,
    }
  );

  const videoPath = await downloadVideo(ctx, url, pattern.flags);

  return {
    path: videoPath,
    metadata: formattedMetadata,
  };
};

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

  try {
    if (matches.length === 1) {
      const { url, pattern } = matches[0];
      console.log(formatLog(ctx, `Processing single video from URL: ${url}`));

      const { path: videoPath, metadata } = await processVideo(
        ctx,
        url,
        pattern
      );

      await ctx.replyWithVideo({ source: fs.createReadStream(videoPath) }, {
        caption: metadata,
        reply_to_message_id: ctx.message.message_id,
      } as any);

      cleanupFiles([videoPath]);
    } else {
      console.log(formatLog(ctx, `Processing ${matches.length} videos`));

      if (VERBOSE) {
        await ctx.reply(`Processing ${matches.length} videos...`);
      }

      const results = await Promise.allSettled(
        matches.map(({ url, pattern }) => processVideo(ctx, url, pattern))
      );

      const successfulDownloads = results
        .map((result, index) => ({
          result,
          url: matches[index].url,
        }))
        .filter(
          (
            item
          ): item is {
            result: PromiseFulfilledResult<VideoDownloadResult>;
            url: string;
          } => item.result.status === "fulfilled"
        );

      if (successfulDownloads.length > 0) {
        const mediaGroup = successfulDownloads.map(({ result }) => ({
          type: "video",
          media: { source: fs.createReadStream(result.value.path) },
        }));

        await ctx.replyWithMediaGroup(
          mediaGroup as any,
          {
            reply_to_message_id: ctx.message.message_id,
          } as any
        );

        cleanupFiles(
          successfulDownloads.map(({ result }) => result.value.path)
        );
      }

      const failedDownloads = results.filter(
        (result) => result.status === "rejected"
      );
      if (failedDownloads.length > 0 && VERBOSE) {
        await ctx.reply(
          `Failed to process ${failedDownloads.length} video(s).`
        );
      }
    }
  } catch (error: any) {
    if (VERBOSE) {
      await ctx.reply("Error processing your request.");
    }
    console.error(formatLog(ctx, `Error: ${error}`));
  }
});

bot.launch().catch((err) => {
  console.error("Error starting bot:", err);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
