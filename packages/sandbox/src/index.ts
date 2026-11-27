export { ContainerSandbox, NODE_IMAGES, runCommand } from './docker.js'
export type { CommandResult, CommandRunner, ContainerSandboxOptions } from './docker.js'
export { FallbackSandbox, HostFallbackSandbox, rewriteStepCmd, runHostCommand } from './local-fallback.js'
export type { HostRunner } from './local-fallback.js'
