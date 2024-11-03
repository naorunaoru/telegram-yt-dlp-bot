export type PatternConfig = {
  regex: RegExp;
  flags: string[];
  formatMetadata?: (metadata: any) => string | undefined;
};
