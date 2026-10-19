/** A place in the bulkhead: resolves when the call may start. */
export interface Entry {
  readonly admitted: Promise<void>;
  /** Gives up the place: leaves the queue, or the bulkhead if already admitted. */
  cancel(): void;
}

export interface BulkheadOptions {
  /** Calls allowed in flight at once. */
  readonly maxConcurrent: number;
  /** Calls allowed to wait for a place; more are refused. */
  readonly maxQueued: number;
}

/** Bounds concurrent calls to a dependency, with a bounded first-in, first-out queue. */
export class Bulkhead {
  readonly #options: BulkheadOptions;
  readonly #queue: (() => void)[] = [];
  #active = 0;

  constructor(options: BulkheadOptions) {
    this.#options = options;
  }

  get active(): number {
    return this.#active;
  }

  get queued(): number {
    return this.#queue.length;
  }

  /** Takes a place, or returns undefined when the queue is full. */
  enter(): Entry | undefined {
    if (this.#active < this.#options.maxConcurrent) {
      this.#active += 1;
      return this.#entry(Promise.resolve(), () => true);
    }
    if (this.#queue.length >= this.#options.maxQueued) return undefined;
    let admit!: () => void;
    const admitted = new Promise<void>((resolve) => (admit = resolve));
    let isAdmitted = false;
    const wake = () => {
      isAdmitted = true;
      admit();
    };
    this.#queue.push(wake);
    return this.#entry(admitted, () => {
      if (isAdmitted) return true;
      this.#queue.splice(this.#queue.indexOf(wake), 1);
      return false;
    });
  }

  #entry(admitted: Promise<void>, leaveQueue: () => boolean): Entry {
    let done = false;
    return {
      admitted,
      cancel: () => {
        if (done) return;
        done = true;
        if (leaveQueue()) this.#release();
      },
    };
  }

  #release(): void {
    const next = this.#queue.shift();
    if (next === undefined) this.#active -= 1;
    else next();
  }
}
