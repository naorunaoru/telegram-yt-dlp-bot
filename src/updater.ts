import { spawn } from "child_process";

/**
 * Check current yt-dlp version
 */
async function getCurrentVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn("yt-dlp", ["--version"]);
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    process.on("error", (error: Error) => {
      reject(error);
    });

    process.on("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`Failed to get yt-dlp version: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Check latest yt-dlp version from PyPI
 */
async function getLatestVersion(): Promise<string> {
  try {
    const response = await fetch("https://pypi.org/pypi/yt-dlp/json");
    if (!response.ok) {
      throw new Error(`PyPI API returned ${response.status}`);
    }

    const data = await response.json();
    return data.info.version;
  } catch (error) {
    console.error("Error fetching latest version from PyPI:", error);
    throw error;
  }
}

/**
 * Update yt-dlp using pip
 */
async function updateYtDlp(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("Updating yt-dlp...");

    const process = spawn("pip", [
      "install",
      "--break-system-packages",
      "-U",
      "yt-dlp[default]",
    ]);

    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data: Buffer) => {
      const output = data.toString();
      stdout += output;
      console.log(output.trim());
    });

    process.stderr.on("data", (data: Buffer) => {
      const output = data.toString();
      stderr += output;
      console.log(output.trim());
    });

    process.on("error", (error: Error) => {
      console.error("Error running pip:", error);
      resolve(false);
    });

    process.on("close", (code: number | null) => {
      if (code !== 0) {
        console.error(`pip update failed with code ${code}`);
        resolve(false);
        return;
      }

      console.log("✓ Successfully updated yt-dlp");
      resolve(true);
    });
  });
}

/**
 * Check for updates and install if available
 */
export async function checkAndUpdate(): Promise<void> {
  try {
    console.log("Checking for yt-dlp updates...");

    const [currentVersion, latestVersion] = await Promise.all([
      getCurrentVersion().catch(() => "unknown"),
      getLatestVersion().catch(() => "unknown"),
    ]);

    console.log(`Current version: ${currentVersion}`);
    console.log(`Latest version: ${latestVersion}`);

    if (currentVersion === "unknown" || latestVersion === "unknown") {
      console.log(
        "Unable to determine versions, attempting update anyway..."
      );
      await updateYtDlp();
      return;
    }

    if (currentVersion !== latestVersion) {
      console.log("Update available, updating...");
      const success = await updateYtDlp();
      if (success) {
        const newVersion = await getCurrentVersion();
        console.log(`Updated to version ${newVersion}`);
      }
    } else {
      console.log("yt-dlp is already up to date");
    }
  } catch (error) {
    console.error("Error during update check:", error);
    console.log("Continuing with current yt-dlp version");
  }
}

