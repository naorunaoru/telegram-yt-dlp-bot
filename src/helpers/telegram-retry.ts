interface RetryOptions {
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (code: number, retry: number, delayMs: number) => void;
}

export function isTelegramServerError(error: unknown): boolean {
  const code = (error as { response?: { error_code?: unknown } } | null)?.response?.error_code;
  return typeof code === 'number' && Number.isInteger(code) && code >= 500 && code < 600;
}

/** Retry explicit Telegram 5xx responses only; ambiguous network failures are not retried.
 * The callback must build a fresh upload payload for every attempt.
 * A server error can still follow acceptance, so retries cannot guarantee exactly-once delivery.
 */
export async function withTelegramRetry<T>(send: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const sleep = options.sleep ?? (delayMs => new Promise(resolve => setTimeout(resolve, delayMs)));
  for (let retry = 0; ; retry++) {
    try {
      return await send();
    } catch (error) {
      if (!isTelegramServerError(error) || retry >= 3) throw error;
      const delayMs = 1000 * 2 ** retry;
      options.onRetry?.((error as { response: { error_code: number } }).response.error_code, retry + 1, delayMs);
      await sleep(delayMs);
    }
  }
}
