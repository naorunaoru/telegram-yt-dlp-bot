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

const downloadVideo = async (
  ctx: any,
  url: string,
  flags: string[]
): Promise<string> => {
  const outputPath = path.join(TEMP_DIR, `video-${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    console.log(formatLog(ctx, `Downloading video from URL: ${url}`));

    const download = ytDlpWrap.exec([url, "-o", outputPath, ...flags]);

    let messageId: number | undefined;

    download.on("progress", async (progress) => {
      console.log(
        formatLog(ctx),
        progress.percent,
        progress.totalSize,
        progress.currentSpeed,
        progress.eta
      );
    });

    download.on("ytDlpEvent", (eventType, eventData) =>
      console.log(formatLog(ctx), eventType, eventData)
    );

    download.on("error", (error) => {
      console.error(formatLog(ctx, `Download error: ${error}`));
      fs.unlink(outputPath, () => {});
      reject(error);
    });

    download.on("close", () => {
      console.log(formatLog(ctx, "Download completed"));
      if (messageId) {
        ctx.deleteMessage(messageId).catch(() => {});
      }
      resolve(outputPath);
    });
  });
};

bot.on(message("text"), async (ctx) => {
  const messageText = ctx.message.text;
  if (!messageText) return;

  for (const pattern of patterns) {
    const match = messageText.match(pattern.regex);

    if (match) {
      const url = match[0];
      console.log(formatLog(ctx, `Matched regex for URL: ${url}`));

      try {
        console.log(formatLog(ctx, `Fetching metadata for URL: ${url}`));

        const metadata = await ytDlpWrap.getVideoInfo([
          url,
          "-f",
          "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4] / bv*+ba/b",
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

        console.log(formatLog(ctx, "Starting video upload..."));

        await ctx.replyWithVideo({ source: fs.createReadStream(videoPath) }, {
          caption: formattedMetadata,
          reply_to_message_id: ctx.message.message_id,
        } as any);

        fs.unlink(videoPath, (err) => {
          if (err) {
            console.error(formatLog(ctx, `Error deleting temp file: ${err}`));
          }
        });

        console.log(formatLog(ctx, "Video upload completed"));
      } catch (error: any) {
        if (VERBOSE) {
          await ctx.reply("Error processing your request.");
        }

        console.error(formatLog(ctx, `Error: ${error}`));
      }
      break;
    }
  }
});

bot.launch().catch((err) => {
  console.error("Error starting bot:", err);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
