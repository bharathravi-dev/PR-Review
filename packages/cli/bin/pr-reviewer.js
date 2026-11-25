#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { main } from '../dist/index.js'

const code = await main(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  {
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
    prompt: async (question) => {
      const rl = createInterface({ input: process.stdin, output: process.stderr })
      try {
        return await rl.question(question)
      } finally {
        rl.close()
      }
    },
  },
)
process.exitCode = code
