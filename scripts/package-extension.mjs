#!/usr/bin/env node
// Packages packages/extension/build/ into a reproducible zip for the Chrome Web Store (Story 7.6): sorted entries,
// fixed timestamps, deflate; named after the engine version, which the manifest version must match.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const buildDir = join(root, 'packages', 'extension', 'build')
const version = JSON.parse(readFileSync(join(root, 'packages', 'cli', 'package.json'), 'utf8')).version
const manifest = JSON.parse(readFileSync(join(buildDir, 'manifest.json'), 'utf8'))
if (manifest.version !== version) {
  console.error(`manifest.json version ${manifest.version} differs from the engine version ${version}; they release in lockstep.`)
  process.exit(1)
}

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]))
const files = walk(buildDir).map((p) => relative(buildDir, p).split('\\').join('/')).sort()

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1 // 1980-01-01
const local = []
const central = []
let offset = 0
for (const name of files) {
  const data = readFileSync(join(buildDir, name))
  const packed = deflateRawSync(data, { level: 9 })
  const nameBuf = Buffer.from(name)
  const crc = crc32(data)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0, 6); header.writeUInt16LE(8, 8)
  header.writeUInt16LE(DOS_TIME, 10); header.writeUInt16LE(DOS_DATE, 12); header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBuf.length, 26); header.writeUInt16LE(0, 28)
  local.push(header, nameBuf, packed)
  const c = Buffer.alloc(46)
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(8, 10)
  c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20)
  c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42)
  central.push(c, nameBuf)
  offset += header.length + nameBuf.length + packed.length
}
const centralBuf = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16)
const out = join(root, 'packages', 'extension', `pr-reviewer-extension-${version}.zip`)
writeFileSync(out, Buffer.concat([...local, centralBuf, end]))
console.log(`${relative(root, out)}: ${files.length} files`)
