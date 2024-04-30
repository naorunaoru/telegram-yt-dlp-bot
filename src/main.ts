import TelegramBot from "node-telegram-bot-api";
import YTDlpWrap from "yt-dlp-wrap";
import dotenv from "dotenv";
import { createWriteStream, unlink } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { patterns } from "./patterns";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(
    "Telegram bot token is not provided. Please set TELEGRAM_BOT_TOKEN in your environment variables."
  );
  process.exit(1);
}

let bot: TelegramBot;
try {
  bot = new TelegramBot(token, { polling: true });
} catch (error) {
  console.error("Failed to create TelegramBot instance:", error);
  process.exit(1);
}

const ytDlpWrap = new YTDlpWrap("./yt-dlp");

bot.on("message", async (msg) => {
  for (const pattern of patterns) {
    const match = msg.text?.match(pattern.regex);

    if (match) {
      const url = match[0];

      try {
        const metadata = await ytDlpWrap.getVideoInfo(url);

        const formattedMetadata = pattern.formatMetadata
          ? pattern.formatMetadata(metadata)
          : "Video metadata unavailable";

        const notifyMsg = await bot.sendMessage(
          msg.chat.id,
          `Downloading\n${formattedMetadata}`
        );

        const downloadArgs = [url, ...pattern.flags];

        const stream = await ytDlpWrap.execStream(downloadArgs);

        const tempFilePath = join(tmpdir(), `download-${Date.now()}.mp4`);

        const fileStream = createWriteStream(tempFilePath);
        stream.pipe(fileStream);

        fileStream.on("finish", async () => {
          await bot.sendVideo(msg.chat.id, tempFilePath, {
            caption: `${formattedMetadata}`,
            reply_to_message_id: msg.message_id,
          });

          bot.deleteMessage(msg.chat.id, notifyMsg.message_id);

          unlink(tempFilePath, (err) => {
            if (err) console.error(`Error deleting file: ${err}`);
          });
        });
      } catch (error: any) {
        await bot.sendMessage(msg.chat.id, `Error processing your request.`);
        console.error(error?.code, error?.response?.body);
      }
      break;
    }
  }
});
