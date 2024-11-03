export const truncateWithEllipsis = (
  text: string | undefined,
  options: {
    maxLength?: number;
    ellipsis?: string;
    preserveWords?: boolean;
  } = {}
): string | undefined => {
  if (!text) return undefined;

  const { maxLength = 900, ellipsis = "...", preserveWords = true } = options;

  if (text.length <= maxLength) return text;

  const truncateAt = maxLength - ellipsis.length;

  if (preserveWords) {
    const lastSpace = text.lastIndexOf(" ", truncateAt);
    const truncateIndex = lastSpace > 0 ? lastSpace : truncateAt;
    return text.substring(0, truncateIndex) + ellipsis;
  }

  return text.substring(0, truncateAt) + ellipsis;
};
