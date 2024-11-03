import { Telegraf } from "telegraf";
import YTDlpWrap from "yt-dlp-wrap";
import dotenv from "dotenv";
import { patterns } from "./patterns";
import { message } from "telegraf/filters";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const VERBOSE = process.env.VERBOSE === "true";

if (!token) {
  console.error(
    "Telegram bot token is not provided. Please set TELEGRAM_BOT_TOKEN in your environment variables."
  );
  process.exit(1);
}

const formatLog = (ctx: any, text?: string) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  return `[User: ${userId}, Chat: ${chatId}] ${text ? text : ""}`;
};

const bot = new Telegraf(token);
const ytDlpWrap = new YTDlpWrap("./yt-dlp");

const execStreamWithLogging = async (
  ctx: any,
  args: string[]
): Promise<NodeJS.ReadableStream> => {
  console.log(formatLog(ctx, `Launching yt-dlp with args: ${args.join(" ")}`));

  const stream = await ytDlpWrap.execStream(args);

  stream
    .on("progress", (progress) =>
      console.log(
        formatLog(ctx),
        progress.percent,
        progress.totalSize,
        progress.currentSpeed,
        progress.eta
      )
    )
    .on("ytDlpEvent", (eventType, eventData) =>
      console.log(formatLog(ctx), eventType, eventData)
    )
    .on("error", (error) => console.error(formatLog(ctx), error))
    .on("close", () => console.log(formatLog(ctx), "all done"));

  return stream;
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
        let notifyMsg;

        console.log(formatLog(ctx, `Fetching metadata for URL: ${url}`));

        const downloadArgs = [
          url,
          ...pattern.flags,
          "-f",
          "bestvideo*+bestaudio/best",
          "--recode-video",
          "mp4",
        ];

        const metadata = await ytDlpWrap.getVideoInfo(downloadArgs);

        const formattedMetadata = pattern.formatMetadata
          ? pattern.formatMetadata(metadata)
          : "Video metadata unavailable";

        if (VERBOSE) {
          notifyMsg = await ctx.reply(`Downloading\n${formattedMetadata}`);
        }

        const stream = await execStreamWithLogging(ctx, downloadArgs);

        console.log(formatLog(ctx, "Starting video upload..."));

        // Set up error handler for the stream
        stream.on("error", (error) => {
          console.error(formatLog(ctx, `Stream error: ${error}`));
          if (VERBOSE) {
            ctx.reply("Error while processing the video stream.");
          }
        });

        // Send the video directly from the stream
        await ctx.replyWithVideo(
          { source: stream, filename: `video-${Date.now()}.mp4` },
          {
            caption: formattedMetadata,
            reply_parameters: {
              message_id: ctx.message.message_id,
            },
          }
        );

        if (VERBOSE && notifyMsg) {
          await ctx.deleteMessage(notifyMsg.message_id);
        }

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
