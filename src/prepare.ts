import YTDlpWrap from "yt-dlp-wrap";
import dotenv from "dotenv";

dotenv.config();

const version = process.env.YTDLP_VERSION;

const downloadYtDlp = async () => {
  try {
    console.log(
      version
        ? `Downloading yt-dlp version ${version}...`
        : "Downloading latest yt-dlp..."
    );
    await YTDlpWrap.downloadFromGithub(undefined, version);
    console.log(`Downloaded.`);
    process.exit(0);
  } catch (e) {
    console.error("Error downloading: ", e);
    process.exit(1);
  }
};

downloadYtDlp();
