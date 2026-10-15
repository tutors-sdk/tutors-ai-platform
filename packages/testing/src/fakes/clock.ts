import type { Clock } from '@tutors-ai/core';

export class FixedClock implements Clock {
  #now: Date;

  constructor(now: Date | string = '2026-10-15T09:00:00Z') {
    this.#now = new Date(now);
  }

  now(): Date {
    return new Date(this.#now);
  }

  advance(ms: number): void {
    this.#now = new Date(this.#now.getTime() + ms);
  }
}
