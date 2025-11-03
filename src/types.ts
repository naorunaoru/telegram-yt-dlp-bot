export interface VideoMetadata {
  title?: string;
  width?: number;
  height?: number;
  duration?: number;
  uploader?: string;
  upload_date?: string;
  [key: string]: any; // Allow additional properties from yt-dlp
}

export type PatternConfig = {
  regex: RegExp;
  flags: string[];
  formatMetadata?: (metadata: VideoMetadata, url: string) => string | undefined;
};
