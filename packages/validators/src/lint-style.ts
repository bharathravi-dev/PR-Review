// Which lint rules are about style (formatting, whitespace, quotes, commas, ordering, naming) rather than
// behaviour. Their findings are MINOR at most, whatever severity the repository configured, so a missing
// trailing comma never ranks with a real bug (Epic 9 Story 9.1). Everything else keeps its configured mapping.

const ESLINT_STYLISTIC = new Set([
  'array-bracket-newline', 'array-bracket-spacing', 'array-element-newline', 'arrow-body-style', 'arrow-parens', 'arrow-spacing',
  'block-spacing', 'brace-style', 'camelcase', 'capitalized-comments', 'comma-dangle', 'comma-spacing', 'comma-style',
  'computed-property-spacing', 'dot-location', 'dot-notation', 'eol-last', 'func-call-spacing', 'func-style',
  'function-call-argument-newline', 'function-paren-newline', 'generator-star-spacing', 'id-length', 'id-match',
  'implicit-arrow-linebreak', 'indent', 'jsx-quotes', 'key-spacing', 'keyword-spacing', 'line-comment-position', 'linebreak-style',
  'lines-around-comment', 'lines-around-directive', 'lines-between-class-members', 'max-len', 'max-statements-per-line',
  'multiline-comment-style', 'multiline-ternary', 'naming-convention', 'new-parens', 'newline-per-chained-call', 'no-confusing-arrow',
  'no-else-return', 'no-extra-parens', 'no-extra-semi', 'no-floating-decimal', 'no-lonely-if', 'no-mixed-spaces-and-tabs',
  'no-multi-spaces', 'no-multiple-empty-lines', 'no-plusplus', 'no-tabs', 'no-trailing-spaces', 'no-unneeded-ternary',
  'no-whitespace-before-property', 'nonblock-statement-body-position', 'object-curly-newline', 'object-curly-spacing',
  'object-property-newline', 'object-shorthand', 'one-var', 'one-var-declaration-per-line', 'operator-assignment', 'operator-linebreak',
  'padded-blocks', 'padding-line-between-statements', 'prefer-arrow-callback', 'prefer-const', 'prefer-destructuring',
  'prefer-exponentiation-operator', 'prefer-object-spread', 'prefer-template', 'quote-props', 'quotes', 'rest-spread-spacing', 'semi',
  'semi-spacing', 'semi-style', 'sort-imports', 'sort-keys', 'sort-vars', 'space-before-blocks', 'space-before-function-paren',
  'space-in-parens', 'space-infix-ops', 'space-unary-ops', 'spaced-comment', 'switch-colon-spacing', 'template-curly-spacing',
  'template-tag-spacing', 'unicode-bom', 'wrap-iife', 'wrap-regex', 'yield-star-spacing', 'yoda',
  // @typescript-eslint stylistic rules that are not also core rule names
  'array-type', 'consistent-type-definitions', 'consistent-indexed-object-style', 'consistent-type-imports', 'member-delimiter-style',
  'member-ordering', 'type-annotation-spacing', 'consistent-generic-constructors', 'prefer-function-type',
])

const ESLINT_STYLISTIC_PLUGINS = ['@stylistic/', 'prettier/', 'simple-import-sort/', 'perfectionist/']
const ESLINT_STYLISTIC_SCOPED = new Set([
  'import/order', 'import/newline-after-import', 'import/first', 'import/exports-last', 'import/group-exports',
  'react/jsx-indent', 'react/jsx-indent-props', 'react/jsx-curly-spacing', 'react/jsx-closing-bracket-location', 'react/jsx-closing-tag-location',
  'react/jsx-props-no-multi-spaces', 'react/jsx-tag-spacing', 'react/jsx-wrap-multilines', 'react/jsx-first-prop-new-line',
  'react/jsx-max-props-per-line', 'react/jsx-one-expression-per-line', 'react/jsx-sort-props', 'react/jsx-equals-spacing',
  'react/jsx-curly-newline', 'react/jsx-newline', 'react/jsx-curly-brace-presence', 'react/self-closing-comp',
])

const TSLINT_STYLISTIC = new Set([
  'align', 'array-type', 'arrow-parens', 'arrow-return-shorthand', 'callable-types', 'class-name', 'comment-format', 'encoding', 'eofline',
  'file-header', 'file-name-casing', 'import-spacing', 'increment-decrement', 'indent', 'interface-name', 'interface-over-type-literal',
  'jsdoc-format', 'linebreak-style', 'max-line-length', 'member-access', 'member-ordering', 'new-parens', 'newline-before-return',
  'newline-per-chained-call', 'no-angle-bracket-type-assertion', 'no-consecutive-blank-lines', 'no-irregular-whitespace',
  'no-trailing-whitespace', 'number-literal-format', 'object-literal-key-quotes', 'object-literal-shorthand', 'object-literal-sort-keys',
  'one-line', 'one-variable-per-declaration', 'ordered-imports', 'prefer-const', 'prefer-template', 'quotemark', 'semicolon',
  'space-before-function-paren', 'space-within-parens', 'trailing-comma', 'type-literal-delimiter', 'typedef-whitespace', 'variable-name',
  'whitespace', 'no-unnecessary-initializer',
  // tslint-eslint-rules and other common plugins
  'brace-style', 'object-curly-spacing', 'array-bracket-spacing', 'block-spacing', 'no-multi-spaces', 'object-shorthand-properties-first',
  'no-increment-decrement', 'prefer-const-enum', 'early-exit', 'naming-convention',
  // codelyzer naming conventions
  'component-selector', 'directive-selector', 'component-class-suffix', 'directive-class-suffix', 'pipe-naming',
])

/** True when a lint rule only concerns style; its findings are then MINOR at most. */
export function isStylisticRule(tool: 'eslint' | 'tslint', rule: string): boolean {
  const name = rule.trim()
  if (tool === 'tslint') return TSLINT_STYLISTIC.has(name) || name.startsWith('ter-')
  if (ESLINT_STYLISTIC.has(name) || ESLINT_STYLISTIC_SCOPED.has(name)) return true
  if (ESLINT_STYLISTIC_PLUGINS.some((p) => name.startsWith(p))) return true
  // @typescript-eslint/<rule> mirrors core rules (indent, quotes, semi, …) and adds its own stylistic ones.
  if (name.startsWith('@typescript-eslint/')) return ESLINT_STYLISTIC.has(name.slice('@typescript-eslint/'.length))
  return false
}
