import TelegramBot from "node-telegram-bot-api";
import YTDlpWrap from "yt-dlp-wrap";
import dotenv from "dotenv";
import { createWriteStream, unlink } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patterns } from "./patterns";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
const VERBOSE = process.env.VERBOSE === "true";

if (!token) {
  console.error(
    "Telegram bot token is not provided. Please set TELEGRAM_BOT_TOKEN in your environment variables."
  );
  process.exit(1);
}

const formatLog = (msg: TelegramBot.Message, text: string) => {
  return `[User: ${msg.from?.id}, Chat: ${msg.chat.id}] ${text}`;
};

let bot: TelegramBot;
try {
  bot = new TelegramBot(token, { polling: true });
} catch (error) {
  console.error("Failed to create TelegramBot instance:", error);
  process.exit(1);
}

const ytDlpWrap = new YTDlpWrap("./yt-dlp");

const execStreamWithLogging = async (
  msg: TelegramBot.Message,
  args: string[]
): Promise<NodeJS.ReadableStream> => {
  console.log(formatLog(msg, `Launching yt-dlp with args: ${args.join(" ")}`));

  return ytDlpWrap.execStream(args);
};

bot.on("message", async (msg) => {
  for (const pattern of patterns) {
    const match = msg.text?.match(pattern.regex);

    if (match) {
      const url = match[0];
      console.log(formatLog(msg, `Matched regex for URL: ${url}`));

      try {
        let notifyMsg: TelegramBot.Message | undefined;

        console.log(formatLog(msg, `Fetching metadata for URL: ${url}`));
        const metadata = await ytDlpWrap.getVideoInfo(url);

        const formattedMetadata = pattern.formatMetadata
          ? pattern.formatMetadata(metadata)
          : "Video metadata unavailable";

        if (VERBOSE) {
          notifyMsg = await bot.sendMessage(
            msg.chat.id,
            `Downloading\n${formattedMetadata}`
          );
        }

        const downloadArgs = [
          url,
          ...pattern.flags,
          "-f",
          "bestvideo*+bestaudio/best",
        ];
        const stream = await execStreamWithLogging(msg, downloadArgs);

        const tempFilePath = join(tmpdir(), `download-${Date.now()}.mp4`);
        console.log(
          formatLog(msg, `Writing to temporary file: ${tempFilePath}`)
        );

        const fileStream = createWriteStream(tempFilePath);
        stream.pipe(fileStream);

        fileStream.on("finish", async () => {
          console.log(formatLog(msg, `Download completed, sending video`));

          await bot.sendVideo(msg.chat.id, tempFilePath, {
            caption: `${formattedMetadata}`,
            reply_to_message_id: msg.message_id,
          });

          if (VERBOSE && notifyMsg) {
            bot.deleteMessage(msg.chat.id, notifyMsg.message_id);
          }

          unlink(tempFilePath, (err) => {
            if (err) {
              console.error(formatLog(msg, `Error deleting file: ${err}`));
            } else {
              console.log(
                formatLog(msg, `Temporary file deleted: ${tempFilePath}`)
              );
            }
          });
        });
      } catch (error: any) {
        if (VERBOSE) {
          await bot.sendMessage(msg.chat.id, `Error processing your request.`);
        }

        console.error(formatLog(msg, `Error: ${error}`));
      }
      break;
    }
  }
});
