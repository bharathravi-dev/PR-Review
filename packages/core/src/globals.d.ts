// Web-standard globals available in Node >= 22 and browsers. Declared narrowly so core stays
// free of DOM and Node typings (AD-1); none of these perform I/O.
declare class TextEncoder {
  encode(input?: string): Uint8Array
}
declare const crypto: {
  readonly subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> }
  getRandomValues<T extends Uint8Array>(array: T): T
}
declare function setTimeout(handler: () => void, ms: number): unknown
declare function clearTimeout(handle: unknown): void
