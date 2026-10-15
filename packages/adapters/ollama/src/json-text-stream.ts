/**
 * Extracts the value of the top-level "text" string from a JSON object that
 * arrives in fragments, so the student sees the answer as it is generated
 * rather than a stream of raw JSON.
 */
export class JsonTextStream {
  #buffer = '';
  #start = -1;
  #cursor = 0;
  #closed = false;

  /** Feeds a fragment and returns the newly decoded text, if any. */
  push(fragment: string): string {
    this.#buffer += fragment;
    if (this.#closed) return '';
    if (this.#start < 0) {
      const match = /"text"\s*:\s*"/.exec(this.#buffer);
      if (match === null) return '';
      this.#start = match.index + match[0].length;
      this.#cursor = this.#start;
    }
    let out = '';
    while (this.#cursor < this.#buffer.length) {
      const ch = this.#buffer[this.#cursor] as string;
      if (ch === '"') {
        this.#closed = true;
        break;
      }
      if (ch !== '\\') {
        out += ch;
        this.#cursor += 1;
        continue;
      }
      const next = this.#buffer[this.#cursor + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = this.#buffer.slice(this.#cursor + 2, this.#cursor + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.#cursor += 6;
        continue;
      }
      out += ESCAPES[next] ?? next;
      this.#cursor += 2;
    }
    return out;
  }

  get json(): string {
    return this.#buffer;
  }
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
