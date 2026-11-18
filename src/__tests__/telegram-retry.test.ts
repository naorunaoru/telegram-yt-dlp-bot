import { describe, expect, it } from 'vitest';
import { withTelegramRetry } from '../helpers/telegram-retry';

describe('Telegram delivery retry', () => {
  it('retries server errors with exponential backoff and returns the successful result', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withTelegramRetry(async () => {
      attempts++;
      if (attempts < 4) throw { response: { error_code: 500, description: 'Internal Server Error' } };
      return 'delivered';
    }, { sleep: async delay => { delays.push(delay); } });
    expect(result).toBe('delivered');
    expect(attempts).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it.each([500, 502, 503, 504, 599])('preserves the final %i error after four attempts', async code => {
    const error = { response: { error_code: code } };
    const delays: number[] = [];
    let attempts = 0;
    await expect(withTelegramRetry(async () => { attempts++; throw error; }, {
      sleep: async delay => { delays.push(delay); },
    })).rejects.toBe(error);
    expect(attempts).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it.each([400, 401, 403, 404, 429, 499, 600, '500', 500.5, undefined])('does not retry non-5xx or malformed code %s', async code => {
    const error = { response: { error_code: code } };
    let attempts = 0;
    const delays: number[] = [];
    await expect(withTelegramRetry(async () => { attempts++; throw error; }, {
      sleep: async delay => { delays.push(delay); },
    })).rejects.toBe(error);
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it.each([new Error('500: Internal Server Error'), {code: 'ECONNRESET'}, null])('does not retry ambiguous transport or unstructured errors', async error => {
    let attempts = 0;
    await expect(withTelegramRetry(async () => { attempts++; throw error; })).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it('stops retrying if a subsequent response is permanent', async () => {
    let attempts = 0;
    const error = {response: {error_code: 403}};
    await expect(withTelegramRetry(async () => {
      if (++attempts === 1) throw {response: {error_code: 503}};
      throw error;
    }, {sleep: async () => {}})).rejects.toBe(error);
    expect(attempts).toBe(2);
  });

  it('returns immediately on success without scheduling retries', async () => {
    let slept = false;
    expect(await withTelegramRetry(async () => 42, {sleep: async () => {slept = true;}})).toBe(42);
    expect(slept).toBe(false);
  });
});
