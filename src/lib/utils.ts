/**
 * Utility function to wait for a specified number of milliseconds.
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Executes a function with automatic retries and exponential backoff
 * specifically designed to handle Gemini API rate limits (429).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  onRetry?: (attempt: number, error: any) => void,
  maxAttempts: number = 5
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.message?.includes('429') || 
                          err?.message?.includes('RESOURCE_EXHAUSTED') ||
                          err?.status === 429 ||
                          err?.error?.code === 429 ||
                          err?.error?.status === 'RESOURCE_EXHAUSTED';
      
      if (!isRateLimit || attempt === maxAttempts) {
        throw err;
      }

      // Slightly more aggressive exponential backoff
      const waitTime = Math.pow(2.5, attempt) * 1000 + Math.random() * 2000;
      
      if (onRetry) {
        onRetry(attempt, err);
      }
      
      await delay(waitTime);
    }
  }
  
  throw lastError;
}
