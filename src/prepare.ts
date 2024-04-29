const YTDlpWrap = require("yt-dlp-wrap").default;

const downloadYtDlp = async () => {
  const githubReleasesData = await YTDlpWrap.getGithubReleases(1, 1);

  console.log(`Downloading ${githubReleasesData[0].name}...`);

  try {
    await YTDlpWrap.downloadFromGithub();
    console.log(`Downloaded.`);
    process.exit(0);
  } catch (e) {
    console.error("Error downloading: ", e);
    process.exit(1);
  }
};

downloadYtDlp();
