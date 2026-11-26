export { scanSecrets, SECRET_RULES } from './secrets.js'
export type { SecretScanResult } from './secrets.js'
export { angularValidator, reactValidator } from './framework.js'
export { ciResultsValidator, layerForCheck } from './ci.js'
export { configChangesValidator } from './config-changes.js'
export { SECURITY_RULES, securityPatternsValidator } from './security-patterns.js'
export { dependencyAuditValidator, lockedPackages } from './dependencies.js'
export { DEFAULT_RULESETS, eslintValidator, installSteps, parseTsc, tscValidator, tslintValidator } from './sandbox-tools.js'

import type { Validator } from '@pr-reviewer/core'
import { ciResultsValidator } from './ci.js'
import { configChangesValidator } from './config-changes.js'
import { securityPatternsValidator } from './security-patterns.js'
import { dependencyAuditValidator } from './dependencies.js'
import { angularValidator, reactValidator } from './framework.js'
import { eslintValidator, tscValidator, tslintValidator } from './sandbox-tools.js'

/** The built-in Validator registry (AD-5). The secret scan runs separately because `redact` needs its values. */
export const BUILT_IN_VALIDATORS: readonly Validator[] = [
  configChangesValidator,
  securityPatternsValidator,
  ciResultsValidator,
  angularValidator,
  reactValidator,
  dependencyAuditValidator,
  tscValidator,
  eslintValidator,
  tslintValidator,
]
