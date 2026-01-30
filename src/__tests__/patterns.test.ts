import { describe, it, expect, beforeEach } from "vitest";
import { patterns } from "../patterns.js";

// Helper: find first pattern that matches a URL
const findMatch = (url: string) => {
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    if (pattern.regex.test(url)) return pattern;
  }
  return null;
};

// Helper: check no pattern matches
const expectNoMatch = (url: string) => {
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    expect(pattern.regex.test(url), `Should not match: ${url}`).toBe(false);
  }
};

// Helper: extract all matched URLs from text
const findAllMatches = (text: string) => {
  const matches: { url: string; pattern: (typeof patterns)[0] }[] = [];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    const regexMatches = text.matchAll(pattern.regex);
    for (const match of regexMatches) {
      matches.push({ url: match[0], pattern });
    }
  }
  return matches;
};

beforeEach(() => {
  // Reset all regex lastIndex before each test
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
  }
});

describe("TikTok patterns", () => {
  it("matches standard video URLs", () => {
    expect(findMatch("https://www.tiktok.com/@user/video/1234567890")).not.toBeNull();
  });

  it("matches short URLs (vm.tiktok.com)", () => {
    expect(findMatch("https://vm.tiktok.com/ZMhAbCdEf/")).not.toBeNull();
  });

  it("matches short URLs (vt.tiktok.com)", () => {
    expect(findMatch("https://vt.tiktok.com/ZMhAbCdEf/")).not.toBeNull();
  });

  it("matches embed URLs", () => {
    expect(findMatch("https://www.tiktok.com/embed/1234567890")).not.toBeNull();
  });

  it("matches /t/ short URLs", () => {
    expect(findMatch("https://www.tiktok.com/t/ZMhAbCdEf/")).not.toBeNull();
  });
});

describe("Instagram patterns", () => {
  it("matches post URLs", () => {
    expect(findMatch("https://www.instagram.com/p/AbCdEfGhIjK/")).not.toBeNull();
  });

  it("matches reel URLs (mobile, singular)", () => {
    expect(findMatch("https://www.instagram.com/reel/AbCdEfGhIjK/")).not.toBeNull();
  });

  it("matches reels URLs (desktop, plural)", () => {
    expect(findMatch("https://www.instagram.com/reels/AbCdEfGhIjK/")).not.toBeNull();
  });

  it("matches TV URLs", () => {
    expect(findMatch("https://www.instagram.com/tv/AbCdEfGhIjK/")).not.toBeNull();
  });

  it("matches ddinstagram.com proxy URLs", () => {
    expect(findMatch("https://ddinstagram.com/reel/AbCdEfGhIjK/")).not.toBeNull();
  });

  it("matches URLs with username prefix", () => {
    expect(findMatch("https://www.instagram.com/someuser/reel/AbCdEfGhIjK/")).not.toBeNull();
  });

  // Known issue: stories regex requires a trailing path segment that doesn't exist
  // The regex expects /<type>/<id> but stories URLs are /stories/<user>/<id>/ with nothing after
  it.todo("matches story URLs — regex needs fix for stories format");
});

describe("YouTube Shorts patterns", () => {
  it("matches shorts URLs", () => {
    expect(findMatch("https://www.youtube.com/shorts/AbCdEfGhIjK")).not.toBeNull();
  });

  it("matches shorts URLs without www", () => {
    expect(findMatch("https://youtube.com/shorts/AbCdEfGhIjK")).not.toBeNull();
  });
});

describe("YouTube patterns", () => {
  it("matches standard watch URLs", () => {
    expect(findMatch("https://www.youtube.com/watch?v=GlPgikR8PJ4")).not.toBeNull();
  });

  it("matches short youtu.be URLs", () => {
    expect(findMatch("https://youtu.be/GlPgikR8PJ4")).not.toBeNull();
  });

  it("matches mobile URLs", () => {
    expect(findMatch("https://m.youtube.com/watch?v=GlPgikR8PJ4")).not.toBeNull();
  });

  it("matches embed URLs", () => {
    expect(findMatch("https://www.youtube.com/embed/GlPgikR8PJ4")).not.toBeNull();
  });

  it("matches URLs with extra query params", () => {
    expect(findMatch("https://www.youtube.com/watch?v=GlPgikR8PJ4&t=120")).not.toBeNull();
  });

  it("matches URLs with v param not first", () => {
    expect(findMatch("https://www.youtube.com/watch?feature=share&v=GlPgikR8PJ4")).not.toBeNull();
  });

  it("does not match channel URLs", () => {
    expectNoMatch("https://www.youtube.com/channel/UCxxxxxxx");
  });

  it("does not match playlist URLs without video", () => {
    expectNoMatch("https://www.youtube.com/playlist?list=PLxxxxxxx");
  });
});

describe("Reddit patterns", () => {
  it("matches standard post URLs", () => {
    expect(findMatch("https://www.reddit.com/r/funny/comments/abc123/some_title")).not.toBeNull();
  });

  it("matches share URLs", () => {
    expect(findMatch("https://www.reddit.com/r/funny/s/AbCdEfGhIj")).not.toBeNull();
  });

  it("matches old.reddit.com URLs", () => {
    expect(findMatch("https://old.reddit.com/r/funny/comments/abc123/some_title")).not.toBeNull();
  });

  it("matches user post URLs", () => {
    expect(findMatch("https://www.reddit.com/user/someone/comments/abc123/some_title")).not.toBeNull();
  });

  it("matches redditmedia.com URLs", () => {
    expect(findMatch("https://www.redditmedia.com/r/funny/comments/abc123/some_title")).not.toBeNull();
  });
});

describe("Twitter/X patterns", () => {
  it("matches twitter.com URLs", () => {
    expect(findMatch("https://twitter.com/user/status/1234567890")).not.toBeNull();
  });

  it("matches x.com URLs", () => {
    expect(findMatch("https://x.com/user/status/1234567890")).not.toBeNull();
  });

  it("does not match profile URLs", () => {
    expectNoMatch("https://twitter.com/user");
  });
});

describe("Multiple URLs in one message", () => {
  it("finds multiple URLs from different platforms", () => {
    const text = "Check these out: https://www.youtube.com/watch?v=GlPgikR8PJ4 and https://x.com/user/status/1234567890";
    const matches = findAllMatches(text);
    expect(matches.length).toBe(2);
  });

  it("finds multiple URLs from the same platform", () => {
    const text = "https://www.youtube.com/watch?v=GlPgikR8PJ4 https://youtu.be/AbCdEfGhIjK";
    const matches = findAllMatches(text);
    expect(matches.length).toBe(2);
  });
});

describe("Pattern formatMetadata", () => {
  it("formats metadata with title", () => {
    const pattern = patterns[0]; // tiktok
    const result = pattern.formatMetadata?.({ title: "Cool video" }, "https://example.com");
    expect(result).toBe("Cool video\n\nhttps://example.com");
  });

  it("returns undefined when no title", () => {
    const pattern = patterns[0];
    const result = pattern.formatMetadata?.({}, "https://example.com");
    expect(result).toBeUndefined();
  });
});
