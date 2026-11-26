// Packs the CLI for npm (roadmap item 12): one self-contained package. The workspace packages (core, github,
// validators, …) are bundled in; only real third-party libraries stay dependencies. Run after `pnpm build`.
//   node scripts/package-cli.mjs            → release/npm/ (publish with: cd release/npm && npm publish)
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'release', 'npm')
const cli = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'))
const tag = process.env.GITHUB_REF_NAME
if (tag?.startsWith('v') && tag.slice(1) !== cli.version) {
  console.error(`The tag ${tag} does not match @pr-reviewer/cli ${cli.version}.`)
  process.exit(1)
}

// Third-party runtime dependencies of every workspace package the CLI uses.
const deps = {}
const optional = {}
for (const pkg of ['cli', 'core', 'github', 'validators', 'providers-http', 'providers-cli', 'sandbox', 'credentials', 'advisories']) {
  const p = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8'))
  for (const [name, version] of Object.entries(p.dependencies ?? {})) if (!String(version).startsWith('workspace:')) deps[name] = version
  // Native modules (the OS keychain) stay optional: the CLI works without them.
  for (const [name, version] of Object.entries(p.optionalDependencies ?? {})) optional[name] = version
}

const require = createRequire(join(root, 'packages/extension/package.json'))
const { build } = await import(pathToFileURL(require.resolve('vite')).href)
rmSync(out, { recursive: true, force: true })
const thirdParty = [...Object.keys(deps), ...Object.keys(optional)]
const external = (id) => id.startsWith('node:') || thirdParty.some((d) => id === d || id.startsWith(`${d}/`))
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  ssr: { noExternal: [/^@pr-reviewer\//], external: thirdParty },
  build: {
    ssr: join(root, 'packages/cli/dist/index.js'),
    outDir: join(out, 'dist'),
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    rollupOptions: { external, output: { format: 'es', entryFileNames: 'index.js', chunkFileNames: 'chunks/[name].js' } },
  },
})

mkdirSync(join(out, 'bin'), { recursive: true })
cpSync(join(root, 'packages/cli/bin/pr-reviewer.js'), join(out, 'bin/pr-reviewer.js'))
cpSync(join(root, 'packages/cli/static'), join(out, 'static'), { recursive: true })
cpSync(join(root, 'README.md'), join(out, 'README.md'))
cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'))
const remote = (() => {
  try {
    return readFileSync(join(root, '.git/config'), 'utf8').match(/url = (https:\/\/github\.com\/[^\s]+?)(?:\.git)?\s/)?.[1]
  } catch {
    return undefined
  }
})()
writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: cli.name,
      version: cli.version,
      description: 'AI pull request reviews with your own model (key, subscription, or local Ollama), real compile and lint checks, and nothing posted without a preview. GitHub and GitLab.',
      license: 'MIT',
      type: 'module',
      bin: { 'pr-reviewer': 'bin/pr-reviewer.js' },
      files: ['bin', 'dist', 'static', 'README.md', 'LICENSE'],
      engines: { node: '>=22' },
      keywords: ['code-review', 'pull-request', 'ai', 'github', 'gitlab', 'cli', 'ollama', 'claude'],
      ...(remote ? { repository: { type: 'git', url: `git+${remote}.git` }, homepage: remote, bugs: `${remote}/issues` } : {}),
      dependencies: deps,
      ...(Object.keys(optional).length ? { optionalDependencies: optional } : {}),
    },
    null,
    2,
  )}\n`,
)
console.log(`Packed ${cli.name}@${cli.version} into ${out}`)
