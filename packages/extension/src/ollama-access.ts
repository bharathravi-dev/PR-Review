// Ollama only answers requests whose Origin it trusts (localhost by default), and a request from the panel carries
// chrome-extension://<id>. This session rule sets a trusted Origin on this extension's own requests to the Ollama
// address the user chose, so no Ollama setting is needed. Requests from web pages are untouched: the rule matches
// only requests this extension starts (initiatorDomains), so it cannot be used to reach Ollama from a site.
const RULE_ID = 1147

export function ollamaRule(origin: string, extensionId: string) {
  return {
    id: RULE_ID,
    priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'set', value: 'http://127.0.0.1' }] },
    condition: { urlFilter: `|${origin}/`, initiatorDomains: [extensionId], resourceTypes: ['xmlhttprequest', 'other'] },
  }
}

/** Lets this extension call Ollama at `origin` (until the browser restarts; the panel sets it again when it opens). */
export async function allowOllama(origin: string): Promise<void> {
  if (!chrome.declarativeNetRequest) return
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [RULE_ID], addRules: [ollamaRule(origin, chrome.runtime.id)] }).catch(() => undefined)
}

/** The host permission Chrome is asked for: the declared optional pattern for this computer, or one https host. */
export function ollamaPermission(origin: string): string {
  const u = new URL(origin)
  return `${u.protocol}//${u.hostname}/*`
}
