import type { CredentialResolver } from '@pr-reviewer/core'

/** Output sinks for the CLI; injected so tests don't touch the real process. */
export interface CliIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

/** Effects the composition root needs; defaults come from the real process. */
export interface CliDeps {
  env: Readonly<Record<string, string | undefined>>
  fetch: typeof fetch
  platform: string
  homedir: string
  credentials: CredentialResolver
  /** Whether stdin is an interactive terminal (confirmation prompts need one). */
  isTTY: boolean
  /** Asks a question on the terminal and resolves with the answer. */
  prompt: (question: string) => Promise<string>
  /** Opens a URL in the user's browser (`serve --open`). */
  openUrl: (url: string) => void
  /** Resolves when the user asks a long-running command (`serve`) to stop. */
  untilStopped: () => Promise<void>
}
