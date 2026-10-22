import type { ProviderFailure } from "./provider";

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

const BACKOFF_DELAYS_MS = [
  30 * 1000,
  2 * 60 * 1000,
  10 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];

export function retryDelayMs(attemptNumber: number): number {
  const index = Math.max(0, Math.min(attemptNumber - 1, BACKOFF_DELAYS_MS.length - 1));
  return BACKOFF_DELAYS_MS[index];
}

export function nextRetryAt(now: Date, attemptNumber: number): Date {
  return new Date(now.getTime() + retryDelayMs(attemptNumber));
}

export function providerFailure(
  errorCode: string,
  diagnostic: string,
): ProviderFailure {
  return {
    outcome: "transient_failure",
    errorCode,
    diagnostic: diagnostic.replace(/[\r\n]+/g, " ").slice(0, 500),
  };
}
