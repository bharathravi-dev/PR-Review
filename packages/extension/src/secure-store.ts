// Credentials at rest (NFR13): AES-GCM with a non-extractable key kept in the extension's IndexedDB; the
// ciphertext lives in chrome.storage.local. Page scripts on GitHub can read neither. Never logged.

export interface KeyStore {
  load(): Promise<CryptoKey | undefined>
  save(key: CryptoKey): Promise<void>
}
export interface BlobStore {
  get(name: string): Promise<string | undefined>
  set(name: string, value: string): Promise<void>
  remove(name: string): Promise<void>
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function createSecureStore(keys: KeyStore, blobs: BlobStore) {
  let key: Promise<CryptoKey> | undefined
  const getKey = () =>
    (key ??= (async () => {
      const existing = await keys.load()
      if (existing) return existing
      const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await keys.save(k)
      return k
    })())
  return {
    async set(name: string, value: unknown): Promise<void> {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const data = new TextEncoder().encode(JSON.stringify(value))
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), data))
      await blobs.set(name, `${b64(iv)}.${b64(ct)}`)
    },
    async get<T>(name: string): Promise<T | undefined> {
      const raw = await blobs.get(name)
      if (!raw) return undefined
      const [iv, ct] = raw.split('.')
      try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv!) }, await getKey(), unb64(ct!))
        return JSON.parse(new TextDecoder().decode(pt)) as T
      } catch {
        return undefined
      }
    },
    remove: (name: string) => blobs.remove(name),
  }
}

/** The browser stores: the key in IndexedDB (structured-clone keeps it non-extractable), blobs in chrome.storage.local. */
export function browserSecureStore() {
  const db = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('pr-reviewer', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('keys')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  const keys: KeyStore = {
    async load() {
      const d = await db()
      return new Promise((resolve) => {
        const r = d.transaction('keys').objectStore('keys').get('credentials')
        r.onsuccess = () => resolve(r.result as CryptoKey | undefined)
        r.onerror = () => resolve(undefined)
      })
    },
    async save(k) {
      const d = await db()
      await new Promise<void>((resolve, reject) => {
        const tx = d.transaction('keys', 'readwrite')
        tx.objectStore('keys').put(k, 'credentials')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    },
  }
  const blobs: BlobStore = {
    get: async (n) => (await chrome.storage.local.get(n))[n] as string | undefined,
    set: (n, v) => chrome.storage.local.set({ [n]: v }),
    remove: (n) => chrome.storage.local.remove(n),
  }
  return createSecureStore(keys, blobs)
}
