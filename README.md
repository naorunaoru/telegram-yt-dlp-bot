# Telegram media grabber bot

Telegram bot that tries `gallery-dl` first and falls back to `yt-dlp` for media
links. For X/Twitter posts that both native extractors cannot see, it makes one
last metadata request to FxTwitter and downloads only returned `twimg.com`
media URLs. Set `FXTWITTER_FALLBACK_ENABLED=false` to disable this fallback.

Video links from Bilibili (`bilibili.com/video/BV...`, `av...`, localized paths
such as `bilibili.com/ru/video/BV...`, and `b23.tv`) are downloaded through
yt-dlp as well. `b23.tv` short links are resolved to their `bilibili.com`
target first, since no extractor matches that host.

## Bilibili extractor plugin

`yt-dlp-plugins/` holds a yt-dlp extractor plugin. The Docker image copies it to
`/etc/yt-dlp/plugins`, which yt-dlp loads automatically — no CLI flag needed.
It covers two cases the built-in `BiliBiliIE` cannot:

- Localized video paths (`bilibili.com/ru/video/BV...`) do not match its
  `_VALID_URL`, so they fall through to the generic extractor, which resolves
  the page's `player.bilibili.com` iframe into a bogus `player` format and
  fails.
- The canonical `/video/BV...` path is answered with a JavaScript redirect
  shell that carries no playback data for many non-CN clients, while any valid
  locale-prefixed path is server-rendered. The plugin retries through a locale
  path when it detects that shell.

Delete the plugin once upstream yt-dlp accepts localized video paths.

Bilibili format selection filters on `filesize_approx`, not `filesize`: Bilibili
only reports estimated sizes, and it serves video and audio separately with no
combined format, so a bare `filesize` filter or a `/b` fallback selects nothing.

Bilibili downloads are rate-limited (`--limit-rate 1M`, `--sleep-requests 0.5`)
to avoid triggering the CDN's aggressive throttling, which returns HTTP 503
after rapid requests. A 20 MB video takes ~20 seconds instead of potentially
faster, but this reduces download failures.

## Anonymous Instagram downloads

The Docker image and downloader updater install `yt-dlp[default,curl-cffi]`.
This enables browser impersonation, which yt-dlp's Instagram extractor selects
automatically for anonymous requests. No global `--impersonate` flag is needed.
Verify availability with `yt-dlp --list-impersonate-targets`.

Keep cookie settings unset to avoid making requests with a personal account.
Logged-in cookies can expose that account to challenges or bans. Anonymous
access remains subject to Instagram's restrictions and rate limits; this does
not guarantee access to photo carousels, private posts, or age-gated media.

## Reddit and Instagram authentication

Reddit and Instagram often reject anonymous downloader traffic. For Docker
deployments, export browser cookies in Netscape `cookies.txt` format, mount the
file read-only, and point the bot at the in-container path:

```env
DOWNLOADER_COOKIES_FILE=/run/secrets/downloader-cookies.txt
```

```yaml
volumes:
  - ./secrets/downloader-cookies.txt:/run/secrets/downloader-cookies.txt:ro
```

`DOWNLOADER_COOKIES_FILE` is passed to both `yt-dlp` and `gallery-dl`. If a
single file is not what you want, use service-specific files instead:

```env
INSTAGRAM_COOKIES_FILE=/run/secrets/instagram-cookies.txt
REDDIT_COOKIES_FILE=/run/secrets/reddit-cookies.txt
```

`INSTAGRAM_COOKIES_FILE` is passed to `yt-dlp` for Instagram URLs and to
`gallery-dl` as `extractor.instagram.cookies`, so both downloaders use the same
Instagram session. Per-tool overrides are still available when needed:

```env
YTDLP_COOKIES_FILE=/run/secrets/ytdlp-cookies.txt
GDL_COOKIES_FILE=/run/secrets/gallery-cookies.txt
```

At container startup, configured cookie files are copied to `/tmp` before the
bot starts. This keeps mounted secrets read-only while still letting downloaders
refresh their in-memory cookie jar and save updates on exit.

For local non-Docker runs, `YTDLP_COOKIES_FROM_BROWSER` is also supported, for
example:

```env
YTDLP_COOKIES_FROM_BROWSER=firefox:default-release
```

For Reddit, `gallery-dl` can also use OAuth:

```env
GDL_REDDIT_API=oauth
GDL_REDDIT_REFRESH_TOKEN=...
GDL_REDDIT_USER_AGENT=Python:media-grabber-bot:v1.0 (by /u/your_user)
```

The same `GDL_REDDIT_USER_AGENT` is used when the bot resolves Reddit `/s/...`
share links before handing them to the downloaders.
