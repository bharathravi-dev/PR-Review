export { scanSecrets, SECRET_RULES } from './secrets.js'
export type { SecretScanResult } from './secrets.js'
export { angularValidator, reactValidator } from './framework.js'
export { ciResultsValidator, layerForCheck } from './ci.js'
export { configChangesValidator } from './config-changes.js'
export { SECURITY_RULES, securityPatternsValidator } from './security-patterns.js'
export { dependencyAuditValidator, lockedPackages } from './dependencies.js'
export { DEFAULT_RULESETS, eslintValidator, installSteps, parseTsc, tscValidator, tslintValidator } from './sandbox-tools.js'
export { goVetValidator, javaCompileValidator, parseGoVetOutput, parseJavaBuildOutput, parseRuffOutput, pythonValidator } from './polyglot-tools.js'
export { localSyntaxValidator, preservesValidSyntax } from './syntax-local.js'
export { LOCAL_STANDARD_RULES, localStandardsValidator } from './local-standards.js'
export { localTestsValidator, matchesTestForSource } from './test-coverage.js'
export { sonarApiValidator } from './sonar.js'
export { goTestsValidator, parseGoTestFailures, parseNodeTestFailures, sandboxTestsValidator } from './sandbox-tests.js'
export { workflowSecurityValidator } from './workflow-security.js'

import type { Validator } from '@pr-reviewer/core'
import { ciResultsValidator } from './ci.js'
import { configChangesValidator } from './config-changes.js'
import { securityPatternsValidator } from './security-patterns.js'
import { dependencyAuditValidator } from './dependencies.js'
import { angularValidator, reactValidator } from './framework.js'
import { localStandardsValidator } from './local-standards.js'
import { goVetValidator, javaCompileValidator, pythonValidator } from './polyglot-tools.js'
import { goTestsValidator, sandboxTestsValidator } from './sandbox-tests.js'
import { sonarApiValidator } from './sonar.js'
import { localSyntaxValidator } from './syntax-local.js'
import { eslintValidator, tscValidator, tslintValidator } from './sandbox-tools.js'
import { localTestsValidator } from './test-coverage.js'
import { workflowSecurityValidator } from './workflow-security.js'

/** The built-in Validator registry (AD-5). The secret scan runs separately because `redact` needs its values. */
export const BUILT_IN_VALIDATORS: readonly Validator[] = [
  configChangesValidator,
  workflowSecurityValidator,
  securityPatternsValidator,
  localSyntaxValidator,
  localStandardsValidator,
  localTestsValidator,
  sandboxTestsValidator,
  goTestsValidator,
  sonarApiValidator,
  ciResultsValidator,
  angularValidator,
  reactValidator,
  dependencyAuditValidator,
  tscValidator,
  eslintValidator,
  tslintValidator,
  javaCompileValidator,
  pythonValidator,
  goVetValidator,
]
