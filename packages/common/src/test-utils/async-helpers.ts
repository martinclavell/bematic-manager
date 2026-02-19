import { EventEmitter } from 'events';

/**
 * Async helper functions for timing-sensitive test operations.
 * Provides utilities for waiting, retrying, and handling async test scenarios.
 */

/**
 * Wait for a condition to become true
 * @param condition Function that returns true when condition is met
 * @param timeout Maximum time to wait in milliseconds (default: 5000)
 * @param interval Check interval in milliseconds (default: 50)
 * @returns Promise that resolves when condition is true
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * // Wait for a value to change
 * await waitFor(() => myVariable === 'expected', 3000);
 *
 * // Wait for DOM element to appear
 * await waitFor(() => document.querySelector('.my-element') !== null);
 * ```
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition();
      if (result) {
        return;
      }
    } catch (error) {
      // Continue waiting even if condition throws
    }

    await sleep(interval);
  }

  throw new Error(`Condition not met within ${timeout}ms timeout`);
}

/**
 * Sleep for a specified number of milliseconds
 * @param ms Number of milliseconds to sleep
 * @returns Promise that resolves after the delay
 *
 * @example
 * ```typescript
 * // Wait 1 second
 * await sleep(1000);
 *
 * // Wait 100ms
 * await sleep(100);
 * ```
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for an event to be emitted from an EventEmitter
 * @param emitter EventEmitter instance to listen to
 * @param event Event name to wait for
 * @param timeout Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise that resolves with the event data
 * @throws Error if timeout is reached
 *
 * @example
 * ```typescript
 * const emitter = new EventEmitter();
 *
 * // Wait for 'data' event
 * const eventData = await waitForEvent(emitter, 'data', 3000);
 *
 * // Wait for error event
 * try {
 *   await waitForEvent(emitter, 'error', 1000);
 * } catch (error) {
 *   console.log('No error event emitted within 1 second');
 * }
 * ```
 */
export async function waitForEvent(
  emitter: EventEmitter,
  event: string,
  timeout = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      emitter.removeListener(event, eventHandler);
      reject(new Error(`Event '${event}' not emitted within ${timeout}ms timeout`));
    }, timeout);

    const eventHandler = (data: any) => {
      clearTimeout(timeoutId);
      emitter.removeListener(event, eventHandler);
      resolve(data);
    };

    emitter.once(event, eventHandler);
  });
}

/**
 * Wait for multiple events to be emitted
 * @param emitter EventEmitter instance to listen to
 * @param events Array of event names to wait for
 * @param timeout Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise that resolves with array of event data in order
 *
 * @example
 * ```typescript
 * const emitter = new EventEmitter();
 * const [dataEvent, endEvent] = await waitForEvents(emitter, ['data', 'end']);
 * ```
 */
export async function waitForEvents(
  emitter: EventEmitter,
  events: string[],
  timeout = 5000
): Promise<any[]> {
  const promises = events.map(event => waitForEvent(emitter, event, timeout));
  return Promise.all(promises);
}

/**
 * Retry a function until it succeeds or maximum attempts are reached
 * @param fn Function to retry (should return Promise)
 * @param maxRetries Maximum number of retry attempts (default: 3)
 * @param delay Delay between retries in milliseconds (default: 1000)
 * @param backoff Whether to use exponential backoff (default: false)
 * @returns Promise that resolves with the function's result
 * @throws The last error if all retries fail
 *
 * @example
 * ```typescript
 * // Retry API call
 * const result = await retry(
 *   () => fetch('/api/data').then(r => r.json()),
 *   3,
 *   1000
 * );
 *
 * // With exponential backoff
 * const result = await retry(
 *   () => unstableOperation(),
 *   5,
 *   500,
 *   true
 * );
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delay = 1000,
  backoff = false
): Promise<T> {
  let lastError: Error;
  let currentDelay = delay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        throw new Error(
          `Function failed after ${maxRetries + 1} attempts. Last error: ${lastError.message}`
        );
      }

      await sleep(currentDelay);

      if (backoff) {
        currentDelay *= 2;
      }
    }
  }

  throw lastError!;
}

/**
 * Retry a function with custom retry conditions
 * @param fn Function to retry
 * @param shouldRetry Function that determines if retry should happen based on error
 * @param maxRetries Maximum number of retry attempts (default: 3)
 * @param delay Delay between retries in milliseconds (default: 1000)
 * @returns Promise that resolves with the function's result
 *
 * @example
 * ```typescript
 * // Only retry on network errors
 * const result = await retryWithCondition(
 *   () => apiCall(),
 *   (error) => error.message.includes('network'),
 *   5,
 *   2000
 * );
 * ```
 */
export async function retryWithCondition<T>(
  fn: () => Promise<T>,
  shouldRetry: (error: Error) => boolean,
  maxRetries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Create a promise that times out after a specified duration
 * @param promise Promise to add timeout to
 * @param timeout Timeout in milliseconds
 * @param timeoutMessage Custom timeout error message
 * @returns Promise that either resolves with original promise or times out
 *
 * @example
 * ```typescript
 * // Add timeout to any promise
 * const result = await withTimeout(
 *   fetch('/api/slow-endpoint'),
 *   5000,
 *   'API call timed out'
 * );
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  timeoutMessage = `Promise timed out after ${timeout}ms`
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(timeoutMessage)), timeout);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Poll a function until it returns a truthy value or times out
 * @param fn Function to poll
 * @param interval Polling interval in milliseconds (default: 100)
 * @param timeout Maximum time to poll in milliseconds (default: 5000)
 * @returns Promise that resolves with the function's result
 *
 * @example
 * ```typescript
 * // Poll for API response
 * const response = await poll(
 *   () => cache.get('api-response'),
 *   200,
 *   10000
 * );
 * ```
 */
export async function poll<T>(
  fn: () => T | Promise<T>,
  interval = 100,
  timeout = 5000
): Promise<T> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await fn();
    if (result) {
      return result;
    }
    await sleep(interval);
  }

  throw new Error(`Polling timed out after ${timeout}ms`);
}

/**
 * Wait for a promise to settle (either resolve or reject) without throwing
 * @param promise Promise to wait for
 * @returns Promise that resolves with success flag and result/error
 *
 * @example
 * ```typescript
 * const { success, result, error } = await waitForSettle(riskyOperation());
 *
 * if (success) {
 *   console.log('Operation succeeded:', result);
 * } else {
 *   console.log('Operation failed:', error);
 * }
 * ```
 */
export async function waitForSettle<T>(
  promise: Promise<T>
): Promise<{ success: true; result: T } | { success: false; error: Error }> {
  try {
    const result = await promise;
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}

/**
 * Create a debounced version of an async function
 * @param fn Function to debounce
 * @param delay Debounce delay in milliseconds
 * @returns Debounced function
 *
 * @example
 * ```typescript
 * const debouncedSearch = debounce(
 *   async (query) => await searchAPI(query),
 *   300
 * );
 *
 * // Only the last call within 300ms will execute
 * debouncedSearch('a');
 * debouncedSearch('ab');
 * debouncedSearch('abc'); // Only this will execute
 * ```
 */
export function debounce<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: NodeJS.Timeout | null = null;
  let currentPromise: Promise<ReturnType<T>> | null = null;

  return (...args: Parameters<T>): Promise<ReturnType<T>> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (currentPromise) {
      return currentPromise;
    }

    currentPromise = new Promise((resolve, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          const result = await fn(...args);
          currentPromise = null;
          resolve(result);
        } catch (error) {
          currentPromise = null;
          reject(error);
        }
      }, delay);
    });

    return currentPromise;
  };
}

/**
 * Execute multiple promises with a concurrency limit
 * @param tasks Array of functions that return promises
 * @param concurrency Maximum number of concurrent executions (default: 3)
 * @returns Promise that resolves with array of results
 *
 * @example
 * ```typescript
 * const urls = ['url1', 'url2', 'url3', 'url4', 'url5'];
 * const tasks = urls.map(url => () => fetch(url));
 *
 * // Execute with max 2 concurrent requests
 * const results = await limitConcurrency(tasks, 2);
 * ```
 */
export async function limitConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency = 3
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const promise = task().then(result => {
      results.push(result);
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      // Remove completed promises
      for (let i = executing.length - 1; i >= 0; i--) {
        const isResolved = await Promise.race([
          executing[i].then(() => true),
          Promise.resolve(false)
        ]);
        if (isResolved) {
          executing.splice(i, 1);
        }
      }
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Create a cancellable promise
 * @param executor Promise executor function
 * @returns Object with promise and cancel function
 *
 * @example
 * ```typescript
 * const { promise, cancel } = createCancellablePromise((resolve, reject, isCancelled) => {
 *   const timer = setTimeout(() => {
 *     if (!isCancelled()) {
 *       resolve('completed');
 *     }
 *   }, 5000);
 *
 *   // Cleanup on cancellation
 *   return () => clearTimeout(timer);
 * });
 *
 * // Cancel after 2 seconds
 * setTimeout(() => cancel(), 2000);
 * ```
 */
export function createCancellablePromise<T>(
  executor: (
    resolve: (value: T) => void,
    reject: (reason: any) => void,
    isCancelled: () => boolean
  ) => (() => void) | void
): { promise: Promise<T>; cancel: () => void } {
  let isCancelled = false;
  let cleanup: (() => void) | void;

  const promise = new Promise<T>((resolve, reject) => {
    const wrappedResolve = (value: T) => {
      if (!isCancelled) {
        resolve(value);
      }
    };

    const wrappedReject = (reason: any) => {
      if (!isCancelled) {
        reject(reason);
      }
    };

    const checkCancelled = () => isCancelled;

    cleanup = executor(wrappedResolve, wrappedReject, checkCancelled);
  });

  const cancel = () => {
    isCancelled = true;
    if (cleanup) {
      cleanup();
    }
  };

  return { promise, cancel };
}