# Telegram media grabber bot

Telegram bot that tries `gallery-dl` first and falls back to `yt-dlp` for media
links. For X/Twitter posts that both native extractors cannot see, it makes one
last metadata request to FxTwitter and downloads only returned `twimg.com`
media URLs. Set `FXTWITTER_FALLBACK_ENABLED=false` to disable this fallback.

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
