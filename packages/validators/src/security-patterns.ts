// Security patterns (roadmap item 15): well-known dangerous code on lines the PR adds. Deterministic and file-only,
// so it runs everywhere (CLI, Web App, GitHub App, the browser extension) without a Sandbox. Tests and comments are
// skipped; each rule names the fix. The AI review still looks for what patterns can't see.
import type { Finding, Validator } from '@pr-reviewer/core'
import { addedLines, finding } from './util.js'

interface Rule {
  id: string
  /** File extensions it applies to. */
  ext: RegExp
  test: RegExp
  /** When set, the line must also match this (narrows noisy patterns). */
  also?: RegExp
  severity: Finding['severity']
  confidence: Finding['confidence']
  title: string
  description: string
  recommendation: string
}

const JS = /\.(m|c)?[jt]sx?$/
const PY = /\.py$/
const CODE = /\.(m|c)?[jt]sx?$|\.(py|go|java|kt|rb|php|cs|scala)$/
const TESTS = /(^|\/)(__tests__|tests?|spec|fixtures?|__mocks__)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/i
const COMMENT = /^\s*(\/\/|#|\*|\/\*|--)/

export const SECURITY_RULES: readonly Rule[] = [
  {
    id: 'security/sql-built-from-strings',
    ext: CODE,
    test: /["'`]\s*(SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*\b(FROM|INTO|WHERE|SET)\b/i,
    also: /\$\{|["'`]\s*\+\s*[\w.[\]]|\+\s*["'`]|%s|\.format\(|\bf["']/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'SQL built by joining strings',
    description: 'Values joined into SQL text can change the query (SQL injection) when any of them comes from a user.',
    recommendation: 'Pass values as query parameters (placeholders) instead of building the SQL string.',
  },
  {
    id: 'security/eval',
    ext: JS,
    test: /(^|[^.\w])eval\s*\(|new\s+Function\s*\(/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Code built and run at runtime',
    description: 'eval and new Function run text as code; if any part of that text can come from outside, so can the code.',
    recommendation: 'Use a parser or a lookup table instead of evaluating code.',
  },
  {
    // In Python exec runs code; in JavaScript exec runs a shell (its own rule below).
    id: 'security/eval',
    ext: PY,
    test: /(^|[^.\w])(eval|exec)\s*\(/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Code built and run at runtime',
    description: 'eval, exec and new Function run text as code; if any part of that text can come from outside, so can the code.',
    recommendation: 'Use a parser or a lookup table instead of evaluating code.',
  },
  {
    id: 'security/shell-with-interpolation',
    ext: JS,
    test: /\b(exec|execSync)\s*\(\s*(`[^`]*\$\{|["'][^"']*["']\s*\+)/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Shell command built from variables',
    description: 'exec runs a shell, so a value with ;, | or $( in it runs extra commands (command injection).',
    recommendation: 'Use execFile or spawn with an argument array, which runs no shell.',
  },
  {
    id: 'security/shell-true',
    ext: PY,
    test: /subprocess\.\w+\([^)]*shell\s*=\s*True|\bos\.system\s*\(/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Command run through a shell',
    description: 'shell=True and os.system pass the command to a shell, so values in it can run extra commands.',
    recommendation: 'Pass a list of arguments to subprocess.run without shell=True.',
  },
  {
    id: 'security/tls-verification-off',
    ext: CODE,
    test: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|\bverify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(false|0)/,
    severity: 'CRITICAL',
    confidence: 'HIGH',
    title: 'TLS certificate checks turned off',
    description: 'Without certificate checks anyone on the network path can read and change the traffic (man in the middle).',
    recommendation: 'Keep verification on; trust a private CA by adding its certificate instead.',
  },
  {
    id: 'security/html-injection',
    ext: /\.(m|c)?[jt]sx?$|\.html?$/,
    test: /\.(innerHTML|outerHTML)\s*\+?=\s*(?!\s*["'][^"'$`]*["']\s*;?\s*$)|dangerouslySetInnerHTML|\bdocument\.write\s*\(|bypassSecurityTrust(Html|Script|Url|ResourceUrl|Style)\s*\(/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'HTML inserted without escaping',
    description: 'HTML built from data and inserted into the page runs any script in that data (cross-site scripting).',
    recommendation: 'Set textContent, let the framework escape it, or sanitise with a vetted sanitiser first.',
  },
  {
    id: 'security/jwt-unverified',
    ext: CODE,
    test: /algorithms?\s*[:=]\s*\[?\s*["']none["']|ignoreExpiration\s*:\s*true|verify_signature["']?\s*:\s*False/i,
    severity: 'CRITICAL',
    confidence: 'HIGH',
    title: 'JWT accepted without a valid signature or expiry',
    description: 'A token that is not verified, or never expires, can be forged or replayed by anyone.',
    recommendation: 'Verify the signature with an explicit algorithm list and keep expiry checks on.',
  },
  {
    id: 'security/unsafe-deserialization',
    ext: /\.(py|java|kt|rb|php|(m|c)?[jt]sx?)$/,
    test: /\bpickle\.loads?\s*\(|\byaml\.load\s*\((?![^)]*Loader\s*=\s*yaml\.(Safe|CSafe)Loader)|\bnew\s+ObjectInputStream\s*\(|\bMarshal\.load\b|\bunserialize\s*\(|require\(['"]node-serialize['"]\)/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Data deserialised in a way that can run code',
    description: 'pickle, yaml.load, Java serialization, Marshal and unserialize can create arbitrary objects and run code when the data is untrusted.',
    recommendation: 'Use a data-only format (JSON) or the safe loader, e.g. yaml.safe_load.',
  },
  {
    id: 'security/cors-any-origin-with-credentials',
    ext: CODE,
    test: /origin\s*:\s*["']\*["']|Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']/i,
    also: /credentials\s*:\s*true|Allow-Credentials/i,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Any website may call this API with the user’s cookies',
    description: 'A wildcard origin together with credentials lets other sites make requests as the signed-in user.',
    recommendation: 'Allow a list of known origins, not "*".',
  },
  {
    id: 'security/weak-hash',
    ext: CODE,
    test: /createHash\(\s*["'](md5|sha1)["']|hashlib\.(md5|sha1)\s*\(|MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"/i,
    also: /pass(word)?|secret|token|sign|auth/i,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Weak hash used for a secret',
    description: 'MD5 and SHA-1 are fast and broken; passwords and tokens hashed with them can be cracked or forged.',
    recommendation: 'Use a password hash (argon2, bcrypt, scrypt) for passwords and SHA-256 or HMAC otherwise.',
  },
  {
    id: 'security/insecure-random',
    ext: JS,
    test: /Math\.random\s*\(\)/,
    also: /token|secret|password|otp|nonce|salt|session|apikey|api_key/i,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Predictable random value used for a secret',
    description: 'Math.random is not cryptographically secure; tokens made with it can be guessed.',
    recommendation: 'Use crypto.randomBytes or crypto.getRandomValues.',
  },
  {
    id: 'security/insecure-random-java-py',
    ext: /\.(java|kt|py)$/,
    test: /\bnew\s+(?:java\.util\.)?Random\s*\(|\brandom\.(?:choice|randint|randrange|random)\s*\(/,
    also: /token|secret|password|otp|nonce|salt|session|apikey|api_key/i,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'Predictable random generator used for a security value',
    description: 'Standard Random / Python random is predictable and unsafe for tokens, OTPs, keys, or secrets.',
    recommendation: 'Use `java.security.SecureRandom` (Java) or the `secrets` module (Python).',
  },
  {
    id: 'security/xxe-parser',
    ext: /\.(java|kt)$/,
    test: /(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory)\.newInstance\s*\(/,
    severity: 'MAJOR',
    confidence: 'LOW',
    title: 'XML parser created — verify XXE protection is configured',
    description: 'Default Java XML parsers may allow XML External Entity (XXE) injection unless secure processing / disallow-doctype-decl is explicitly enabled.',
    recommendation: 'Disable DOCTYPE declarations and external entities (`disallow-doctype-decl`, `FEATURE_SECURE_PROCESSING`) on the factory.',
  },
  {
    id: 'security/java-runtime-exec',
    ext: /\.(java|kt)$/,
    test: /Runtime\.getRuntime\(\)\.exec\s*\(/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'OS command execution via Runtime.exec',
    description: 'Passing dynamic input to Runtime.exec can lead to command injection or argument splitting bugs.',
    recommendation: 'Validate all inputs strictly and prefer `ProcessBuilder` with explicit argument arrays.',
  },
  {
    id: 'security/weak-cipher',
    ext: /\.(java|kt)$/,
    test: /Cipher\.getInstance\s*\(\s*"(?:DES|DESede|RC4|Blowfish|AES\/ECB|AES(?="))/i,
    severity: 'CRITICAL',
    confidence: 'HIGH',
    title: 'Weak or ECB-mode cipher algorithm',
    description: 'DES, RC4, Blowfish, and AES/ECB (or bare "AES", which defaults to ECB in JCE) do not provide semantic security.',
    recommendation: 'Use authenticated encryption such as `AES/GCM/NoPadding`.',
  },
  {
    id: 'security/spring-csrf-disabled',
    ext: /\.(java|kt)$/,
    test: /\.csrf\s*\(\s*(?:\)|[^)]*disable)/,
    severity: 'MAJOR',
    confidence: 'MEDIUM',
    title: 'CSRF protection disabled in Spring Security configuration',
    description: 'Disabling CSRF leaves cookie-authenticated browser endpoints vulnerable to cross-site request forgery.',
    recommendation: 'Keep CSRF enabled for browser/session-based endpoints; disable only for stateless token-only APIs.',
  },
  {
    id: 'security/spring-cors-wildcard',
    ext: /\.(java|kt)$/,
    test: /@CrossOrigin\s*\(\s*(?:origins\s*=\s*)?["']\*["']/,
    severity: 'MINOR',
    confidence: 'MEDIUM',
    title: 'Wildcard @CrossOrigin("*") allows any origin',
    description: 'Allowing every origin lets arbitrary sites read API responses from a user’s browser.',
    recommendation: 'Restrict `origins` to an explicit list of trusted domains.',
  },
]

export const securityPatternsValidator: Validator = {
  id: 'security.patterns',
  version: '1',
  layers: ['SECURITY'],
  needsSandbox: false,
  baseline: false,
  hermetic: true,
  supports: (ctx) => (ctx.pr.files.some((f) => CODE.test(f.path) || /\.html?$/.test(f.path)) ? { applicable: true } : { applicable: false, reason: 'NOT_SUPPORTED', detail: 'No source files changed.' }),
  async run(ctx) {
    const findings: Finding[] = []
    for (const file of ctx.pr.files) {
      if (file.status === 'removed' || TESTS.test(file.path)) continue
      for (const [line, text] of addedLines(file)) {
        if (COMMENT.test(text)) continue
        for (const rule of SECURITY_RULES) {
          if (!rule.ext.test(file.path) || !rule.test.test(text) || (rule.also && !rule.also.test(text))) continue
          findings.push(
            finding({
              ruleId: rule.id,
              category: 'SECURITY',
              severity: rule.severity,
              confidence: rule.confidence,
              title: rule.title,
              description: rule.description,
              recommendation: rule.recommendation,
              location: { anchorKind: 'LINE', path: file.path, startLine: line, endLine: line },
              provenance: { validator: 'security.patterns' },
            }),
          )
        }
      }
    }
    return {
      layers: [{ layer: 'SECURITY', status: findings.length ? 'WARNING' : 'PASSED', detail: findings.length ? `${findings.length} risky pattern(s) on added lines.` : 'No known risky patterns on added lines.' }],
      findings,
    }
  },
}
