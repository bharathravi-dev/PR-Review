// Bundles the side panel and the service worker into packages/extension/build/ (load it unpacked in Chrome).
import { build } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
await build({
  root,
  logLevel: 'warn',
  publicDir: 'public',
  esbuild: { charset: 'ascii' },
  // Device-flow sign-in needs a GitHub OAuth app; without its client ID the panel offers token sign-in only.
  define: { __GITHUB_CLIENT_ID__: JSON.stringify(process.env.PR_REVIEWER_GITHUB_CLIENT_ID ?? '') },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    target: 'chrome116',
    minify: true,
    sourcemap: false,
    modulePreload: false,
    chunkSizeWarningLimit: 12000,
    rollupOptions: {
      input: { panel: fileURLToPath(new URL('panel.html', import.meta.url)), background: fileURLToPath(new URL('src/background.ts', import.meta.url)) },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
})

// Content scripts cannot be ES modules: the Review button is built on its own as one classic script.
await build({
  root,
  logLevel: 'warn',
  publicDir: false,
  esbuild: { charset: 'ascii' },
  build: {
    outDir: 'build',
    emptyOutDir: false,
    target: 'chrome116',
    minify: true,
    lib: { entry: fileURLToPath(new URL('src/content.ts', import.meta.url)), formats: ['iife'], name: 'prReviewerButton', fileName: () => 'content.js' },
  },
})

// Icons: pr-reviewer's rounded square with the blue-to-green gradient, drawn here so no binary files live in git.
function png(size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const r = size * 0.22
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x - 0.5, 0, x + 0.5 - (size - r))
      const dy = Math.max(r - y - 0.5, 0, y + 0.5 - (size - r))
      const alpha = Math.max(0, Math.min(1, r - Math.hypot(dx, dy) + 0.5))
      const t = (x + y) / (2 * size)
      const [a, b] = [[0x2f, 0x5b, 0xd3], [0x1d, 0x7a, 0x46]]
      row.push(...a.map((v, i) => Math.round(v + (b[i] - v) * t)), Math.round(alpha * 255))
    }
    rows.push(Buffer.from(row))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
const iconDir = fileURLToPath(new URL('build/icons/', import.meta.url))
mkdirSync(iconDir, { recursive: true })
for (const size of [16, 32, 48, 128]) writeFileSync(`${iconDir}icon-${size}.png`, png(size))
