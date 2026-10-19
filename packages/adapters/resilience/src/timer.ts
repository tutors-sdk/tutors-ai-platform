/** A delay that can be called off, so a settled race leaves no timer behind. */
export interface Delay {
  readonly elapsed: Promise<void>;
  cancel(): void;
}

/**
 * Where the resilience policies read time and wait. Tests drive a manual
 * timer; this file is the package's only allowed use of the host's timers.
 */
export interface Timer {
  /** Milliseconds on a monotonic clock. */
  now(): number;
  delay(ms: number): Delay;
}

export const systemTimer: Timer = {
  now: () => performance.now(),
  delay: (ms) => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const elapsed = new Promise<void>((resolve) => {
      handle = setTimeout(resolve, ms);
    });
    return { elapsed, cancel: () => clearTimeout(handle) };
  },
};
