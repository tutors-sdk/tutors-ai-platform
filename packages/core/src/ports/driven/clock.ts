/** Driven port: time, so tests can make it deterministic. */
export interface Clock {
  now(): Date;
}
