import { PatternConfig } from "./types";

const tiktokPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.tiktok\.com\/(?:embed\/|@[\w.-]+?\/video\/)|(?:vm|vt)\.tiktok\.com\/|www\.tiktok\.com\/t\/)([\w\d]+)/i,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `TikTok Video: ${metadata.title}` : undefined,
};

const instagramPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.)?(?:dd)?instagram\.com(?:\/[^\/]+)?\/(p|tv|reel|stories\/[^\/]+\/\d+)\/[^\/?#&]+/i,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `Instagram Post: ${metadata.title}` : undefined,
};

const ytShortsPattern: PatternConfig = {
  regex: /https?:\/\/(?:www\.)?youtube\.com(?:\/)(shorts\/[^\/?#&]+)+/i,
  flags: [],
  formatMetadata: (metadata) =>
    metadata.title ? `Youtube Short: ${metadata.title}` : undefined,
};

const redditPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:\w+\.)?reddit(?:media)?\.com\/(?:(?:r|user)\/[^/]+\/)?(?:(?:comments\/[^/]+\/[^/]+)|(?:s\/[^/?#&]+))/i,
  flags: ["-f", "(bv*+ba/b)[protocol^=http][protocol!*=dash]"],
  formatMetadata: (metadata) =>
    metadata.title ? `Reddit Post: ${metadata.title}` : undefined,
};

const twitterPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:(?:www|m(?:obile)?)\.)?(?:(?:twitter|x)\.com|twitter3e4tixl4xyajtrzo62zg5vztmjuricljdp2c5kshju4avyoid\.onion)\//i,
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
