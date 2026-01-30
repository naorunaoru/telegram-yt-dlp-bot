import { PatternConfig } from "./types";

const tiktokPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.tiktok\.com\/(?:embed\/|@[\w.-]+?\/video\/)|(?:vm|vt)\.tiktok\.com\/|www\.tiktok\.com\/t\/)([\w\d]+)/gi,
  flags: [
    "-f",
    "(bv*[vcodec~='^((he|a)vc|h26[45])'][filesize<30M]+ba) / (bv*[filesize<30M]+ba/b)",
  ],
  formatMetadata: (metadata, url) =>
    metadata.title ? `${metadata.title}\n\n${url}` : undefined,
};

const instagramPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.)?(?:dd)?instagram\.com(?:\/[^\/]+)?\/(p|tv|reel(s)?|stories\/[^\/]+\/\d+)\/[^\/?#&]+/gi,
  flags: [
    "-f",
    "(bv*[vcodec~='^((he|a)vc|h26[45])'][filesize<30M]+ba) / (bv*[filesize<30M]+ba/b)",
  ],
  formatMetadata: (metadata, url) =>
    metadata.title ? `${metadata.title}\n\n${url}` : undefined,
};

const ytShortsPattern: PatternConfig = {
  regex: /https?:\/\/(?:www\.)?youtube\.com(?:\/)(shorts\/[^\/?#&]+)+/gi,
  flags: [
    "-f",
    "(bv*[vcodec~='^((he|a)vc|h26[45])'][filesize<30M]+ba) / (bv*[filesize<30M]+ba/b)",
  ],
  formatMetadata: (metadata, url) =>
    metadata.title ? `${metadata.title}\n\n${url}` : undefined,
};

const youtubePattern: PatternConfig = {
  regex:
    /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|v\/)|youtu\.be\/|youtube\.googleapis\.com\/v\/)([0-9A-Za-z_-]{11})(?:[?&].*)?/gi,
  flags: [
    "--embed-thumbnail",
    "--convert-thumbnails",
    "jpg",
    "-f",
    "(bv*[vcodec~='^((he|a)vc|h26[45])'][filesize<30M]+ba) / (bv*[filesize<30M]+ba/b)",
  ],
  formatMetadata: (metadata, url) =>
    metadata.title ? `${metadata.title}\n\n${url}` : undefined,
};

const redditPattern: PatternConfig = {
  regex:
    /https?:\/\/(?:\w+\.)?reddit(?:media)?\.com\/(?:(?:r|user)\/[^/]+\/)?(?:(?:comments\/[^/]+\/[^/]+)|(?:s\/[^/?#&]+))/gi,
  flags: [
    // doesn't work with size limits somehow?
    "-f",
    "(bv*[vcodec~='^((he|a)vc|h26[45])']+ba) / (bv*+ba/b)",
  ],
  formatMetadata: (metadata, url) =>
    metadata.title ? `${metadata.title}\n\n${url}` : undefined,
};

const twitterPattern: PatternConfig = {
  regex: /https?:\/\/((?:twitter|x)\.com)\/[a-zA-Z0-9_]+\/status\/\d+/gi,
  flags: [
    "-f",
    "(bv*[vcodec~='^((he|a)vc|h26[45])'][filesize<30M]+ba) / (bv*[filesize<30M]+ba/b)",
  ],
  formatMetadata: (metadata, url) =>
    metadata.title ? `${metadata.title}\n\n${url}` : undefined,
};

export const patterns = [
  tiktokPattern,
  instagramPattern,
  ytShortsPattern,
  youtubePattern,
  redditPattern,
  twitterPattern,
];
