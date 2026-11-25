import { readFileSync } from 'node:fs'
import { EXIT_CODES } from '@pr-reviewer/core'

/** Output sinks for the CLI; injected so tests don't touch the real process. */
export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

const USAGE = `Usage: pr-reviewer <command> [options]

Review GitHub pull requests with deterministic checks and the AI provider of your choice.

Commands:
  help              Show this help

Options:
  -h, --help        Show this help
  -v, --version     Print the version

More commands (review, context, config, list, init) arrive in upcoming releases.
`

/** Runs the CLI with the given arguments (without the node/script prefix) and returns the exit code. */
export async function main(argv: readonly string[], io: CliIo): Promise<number> {
  const [first, ...rest] = argv

  if (first === undefined || first === 'help' || first === '-h' || first === '--help') {
    io.stdout(USAGE)
    return EXIT_CODES.passed
  }

  if (first === '-v' || first === '--version') {
    if (rest.length > 0) {
      io.stderr(`Unexpected argument: ${rest[0]}\n\n${USAGE}`)
      return EXIT_CODES.usage
    }
    io.stdout(`${pkg.version}\n`)
    return EXIT_CODES.passed
  }

  const kind = first.startsWith('-') ? 'option' : 'command'
  io.stderr(`Unknown ${kind}: ${first}\n\n${USAGE}`)
  return EXIT_CODES.usage
}
