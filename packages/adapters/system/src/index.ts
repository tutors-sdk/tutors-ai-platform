import type { Clock } from '@tutors-ai/core';

/** Clock over the host's wall clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
