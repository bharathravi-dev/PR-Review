// Bundles the side panel and the service worker into packages/extension/build/ (load it unpacked in Chrome).
import { build } from 'vite'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
// The GitHub OAuth app used for "Sign in with GitHub" (device flow). A client ID is public, not a secret (GitHub's
// own CLI ships one), so the project's ID lives in oauth.json; PR_REVIEWER_GITHUB_CLIENT_ID overrides it for forks.
const oauthFile = new URL('oauth.json', import.meta.url)
const committedId = existsSync(oauthFile) ? String(JSON.parse(readFileSync(oauthFile, 'utf8')).githubClientId ?? '') : ''
const githubClientId = process.env.PR_REVIEWER_GITHUB_CLIENT_ID || committedId
if (!/^(|[A-Za-z0-9._-]{8,64})$/.test(githubClientId)) throw new Error('oauth.json githubClientId does not look like a GitHub client ID')
if (!githubClientId) console.warn('No GitHub OAuth client ID (oauth.json or PR_REVIEWER_GITHUB_CLIENT_ID): the panel offers token sign-in only.')
await build({
  root,
  logLevel: 'warn',
  publicDir: 'public',
  esbuild: { charset: 'ascii' },
  define: { __GITHUB_CLIENT_ID__: JSON.stringify(githubClientId) },
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
  // The PR Reviewer mark: orange "PR" on the BR.dev brand's dark background, in a rounded square (no gradient).
  const BG = [0x09, 0x0a, 0x1a]
  const FG = [0xff, 0x7b, 0x02]
  // P and R drawn as geometry (stems, round bowls, a diagonal leg) in a unit box 1 tall, so they stay smooth.
  const T = 0.18
  const bowl = (x, y, cx, cy, rad) => x >= cx && Math.hypot(x - cx, y - cy) <= rad && Math.hypot(x - cx, y - cy) >= rad - T
  const bar = (x, y, x0, x1, y0) => x >= x0 && x <= x1 && y >= y0 && y <= y0 + T
  const P = (x, y) => {
    if (x < 0 || x > 0.64 || y < 0 || y > 1) return false
    if (x <= T) return true
    const a = 0.29
    return bar(x, y, 0, 0.64 - a, 0) || bar(x, y, 0, 0.64 - a, 2 * a - T) || bowl(x, y, 0.64 - a, a, a)
  }
  const R = (x, y) => {
    if (x < 0 || x > 0.66 || y < 0 || y > 1) return false
    if (x <= T) return true
    const a = 0.285
    if (bar(x, y, 0, 0.62 - a, 0) || bar(x, y, 0, 0.62 - a, 2 * a - T) || bowl(x, y, 0.62 - a, a, a)) return true
    // The leg: a stroke from the bowl's foot to the bottom right.
    const [x0, y0, x1, y1] = [0.3, 2 * a - T / 2, 0.66 - T / 2, 1 - T / 2]
    const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)))
    return Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0))) <= T / 2
  }
  const H = size * 0.46
  const total = (0.64 + 0.16 + 0.66) * H
  const left = (size - total) / 2
  const top = (size - H) / 2
  const ink = (px, py) => {
    const x = (px - left) / H
    const y = (py - top) / H
    return P(x, y) || R(x - 0.8, y)
  }
  const r = size * 0.22
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = [0]
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x - 0.5, 0, x + 0.5 - (size - r))
      const dy = Math.max(r - y - 0.5, 0, y + 0.5 - (size - r))
      const alpha = Math.max(0, Math.min(1, r - Math.hypot(dx, dy) + 0.5))
      // 4x4 samples per pixel keep the letters smooth at 16px.
      let on = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (ink(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) on++
      const t = on / 16
      row.push(...BG.map((v, i) => Math.round(v + (FG[i] - v) * t)), Math.round(alpha * 255))
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
