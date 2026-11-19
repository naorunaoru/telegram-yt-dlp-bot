import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { DownloadTrace } from '../helpers/download-attribution';

const main = readFileSync('src/main.ts', 'utf8');
const code = ts.transpileModule(main.slice(main.indexOf('const buildCaption ='), main.indexOf('bot.on(message("text")')), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const url = 'https://x.com/socialchanger/status/2123146033622380984';

it('fills an otherwise URL-only caption without replacing the video download', async () => {
  const getXOEmbedText = vi.fn(async () => 'Post text\n\nSecond paragraph');
  const buildCaption = runInNewContext(code + '\nbuildCaption;', {
    getXOEmbedText, formatMetadata: () => url, truncateWithEllipsis: (text: string) => text,
  });
  expect(await buildCaption({ metadata: {} }, {}, url)).toBe(`Post text\n\nSecond paragraph\n\n${url}`);
  expect(await buildCaption({ metadata: {}, caption: url }, {}, url)).toBe(`Post text\n\nSecond paragraph\n\n${url}`);
  expect(getXOEmbedText).toHaveBeenCalledWith(url);
});

it.each([[true, ''], [false, ''], [true, '\n\n(some content could not be downloaded)']])('sends cached media and persists only a recovered caption (available: %s, suffix: %s)', async (available, suffix) => {
  const start = main.indexOf('bot.on(message("text"), ');
  const block = main.slice(start, main.indexOf('\nconst initializeBot', start)).trim();
  const handlerCode = ts.transpileModule(`const handler = ${block.slice('bot.on(message("text"), '.length, -2)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const cached = { caption: url + suffix, files: [{ telegram_file_id: 'existing-file' }] };
  const sendCachedMedia = vi.fn(async () => true);
  const updateCachedCaption = vi.fn();
  const processUrl = vi.fn();
  const handler = runInNewContext(code + handlerCode + '\nhandler;', {
    getXOEmbedText: async () => available ? 'Recovered' : undefined,
    truncateWithEllipsis: (text: string) => text,
    findAllMatches: () => [{ url, pattern: {} }], DownloadTrace,
    getCachedMedia: () => cached, sendCachedMedia, updateCachedCaption, processUrl,
    trackChatActivity: () => {}, createTempDir: () => '/tmp/unused', cleanupTempDir: () => {},
    setInterval: () => 1, clearInterval: () => {}, formatLog: () => '', console: { log: vi.fn() },
  });
  const ctx = { message: { text: url, message_id: 1 }, sendChatAction: async () => {} };
  await handler(ctx);
  const caption = available ? `Recovered\n\n${url}${suffix}` : cached.caption;
  expect(sendCachedMedia).toHaveBeenCalledWith(ctx, { ...cached, caption }, 1);
  expect(processUrl).not.toHaveBeenCalled();
  if (available) expect(updateCachedCaption).toHaveBeenCalledWith(url, cached.caption, caption);
  else expect(updateCachedCaption).not.toHaveBeenCalled();
});
