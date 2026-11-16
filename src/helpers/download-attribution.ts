export interface DownloadAttempt {
  source: string;
  outcome: 'success' | 'empty' | 'failed';
}

export class DownloadTrace {
  private attempts: DownloadAttempt[] = [];

  async run<T>(source: string, action: () => Promise<T>, hasMedia: (result: T) => boolean): Promise<T> {
    try {
      const result = await action();
      this.attempts.push({ source, outcome: hasMedia(result) ? 'success' : 'empty' });
      return result;
    } catch (error) {
      this.attempts.push({ source, outcome: 'failed' });
      throw error;
    }
  }

  attribution(): DownloadAttribution {
    const winner = this.attempts.findIndex(a => a.outcome === 'success');
    return {
      source: winner < 0 ? null : this.attempts[winner].source,
      is_fallback: winner > 0,
      attempts: this.attempts.map(a => ({ ...a })),
    };
  }
}

export interface DownloadAttribution {
  source?: string | null;
  is_fallback?: boolean | null;
  attempts?: DownloadAttempt[] | null;
}
