import { PatternConfig } from "./types";

const tiktokPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.tiktok\.com\/(?:embed\/|@[\w.-]+?\/video\/)|(?:vm|vt)\.tiktok\.com\/|www\.tiktok\.com\/t\/)([\w\d]+)/gi,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `TikTok Video: ${metadata.title}` : undefined,
};

const instagramPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.)?(?:dd)?instagram\.com(?:\/[^\/]+)?\/(p|tv|reel|stories\/[^\/]+\/\d+)\/[^\/?#&]+/gi,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `Instagram Post: ${metadata.title}` : undefined,
};

const ytShortsPattern: PatternConfig = {
  regex: /https?:\/\/(?:www\.)?youtube\.com(?:\/)(shorts\/[^\/?#&]+)+/gi,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `Youtube Short: ${metadata.title}` : undefined,
};

const redditPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:\w+\.)?reddit(?:media)?\.com\/(?:(?:r|user)\/[^/]+\/)?(?:(?:comments\/[^/]+\/[^/]+)|(?:s\/[^/?#&]+))/gi,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `Reddit Post: ${metadata.title}` : undefined,
};

const twitterPattern: PatternConfig = {
  regex: /https?:\/\/((?:twitter|x)\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `Tweet: ${metadata.title}` : undefined,
};

export const patterns = [
  tiktokPattern,
  instagramPattern,
  ytShortsPattern,
  redditPattern,
  twitterPattern,
];
