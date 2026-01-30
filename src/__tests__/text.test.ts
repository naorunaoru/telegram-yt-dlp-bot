import { describe, it, expect } from "vitest";
import { truncateWithEllipsis } from "../helpers/text.js";

describe("truncateWithEllipsis", () => {
  it("returns undefined for undefined input", () => {
    expect(truncateWithEllipsis(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(truncateWithEllipsis("")).toBeUndefined();
  });

  it("returns text unchanged when under maxLength", () => {
    expect(truncateWithEllipsis("short text")).toBe("short text");
  });

  it("truncates at word boundary by default", () => {
    const text = "hello world this is a test";
    const result = truncateWithEllipsis(text, { maxLength: 15 });
    expect(result).toBe("hello world...");
    expect(result!.length).toBeLessThanOrEqual(15);
  });

  it("truncates mid-word when preserveWords is false", () => {
    const text = "hello world this is a test";
    const result = truncateWithEllipsis(text, {
      maxLength: 15,
      preserveWords: false,
    });
    expect(result).toBe("hello world ...");
  });

  it("uses custom ellipsis", () => {
    const text = "hello world this is a test";
    const result = truncateWithEllipsis(text, {
      maxLength: 18,
      ellipsis: " ...",
    });
    expect(result).toContain(" ...");
  });

  it("uses default maxLength of 900", () => {
    const text = "a".repeat(1000);
    const result = truncateWithEllipsis(text);
    expect(result!.length).toBeLessThanOrEqual(900);
  });

  it("handles text with no spaces when preserveWords is true", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    const result = truncateWithEllipsis(text, { maxLength: 10 });
    // No space found, falls back to truncateAt
    expect(result).toBe("abcdefg...");
  });

  it("handles exact maxLength (no truncation needed)", () => {
    const text = "exact";
    expect(truncateWithEllipsis(text, { maxLength: 5 })).toBe("exact");
  });
});
