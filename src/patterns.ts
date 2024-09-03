import { PatternConfig } from "./types";

const tiktokPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.tiktok\.com\/(?:embed\/|@[\w.-]+?\/video\/)|(?:vm|vt)\.tiktok\.com\/|www\.tiktok\.com\/t\/)([\w\d]+)/i,
  flags: [],
  formatMetadata: (metadata) =>
    `TikTok Video: ${metadata.title || "No title available"}`,
};

const instagramPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.)?(?:dd)?instagram\.com(?:\/[^\/]+)?\/(p|tv|reel|stories\/[^\/]+\/\d+)\/[^\/?#&]+/i,
  flags: [],
  formatMetadata: (metadata) =>
    `Instagram Post: ${metadata.title || "No title available"}`,
};

const ytShortsPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.)?youtube\.com(?:\/)(shorts\/[^\/?#&]+)+/i,
  flags: [],
  formatMetadata: (metadata) =>
    `Youtube Shorts Post: ${metadata.title || "No title available"}`,
};

export const patterns = [tiktokPattern, instagramPattern, ytShortsPattern];
