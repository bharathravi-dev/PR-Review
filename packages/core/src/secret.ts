const INSPECT = Symbol.for('nodejs.util.inspect.custom')
const MASK = '[REDACTED]'

/** A Credential value. Every string, JSON, and inspect form is masked; only `reveal()` returns it (AD-10). */
export class Secret {
  readonly #value: string

  constructor(value: string) {
    this.#value = value
  }

  /** Read the raw value. Call only inside the adapter that sends it. */
  reveal(): string {
    return this.#value
  }

  toString(): string {
    return MASK
  }

  toJSON(): string {
    return MASK
  }

  [INSPECT](): string {
    return `Secret(${MASK})`
  }
}

/** Replaces every occurrence of each secret's value in `text` (values shorter than 4 chars are ignored). */
export function redactText(text: string, secrets: Iterable<Secret>): string {
  let out = text
  for (const s of secrets) {
    const v = s.reveal()
    if (v.length >= 4) out = out.split(v).join(MASK)
  }
  return out
}
