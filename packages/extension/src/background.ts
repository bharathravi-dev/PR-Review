// Service worker: the toolbar icon and the keyboard command open the side panel. No review runs here; Standalone
// reviews run in the panel page (AD-16).
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel' && tab) void chrome.sidePanel.open({ windowId: tab.windowId })
})

// The Review button on the page (Story 7.5): open the panel for that tab; ask it to start when the PR has no review yet.
chrome.runtime.onMessage.addListener((msg, sender) => {
  const m = msg as { type?: string; pr?: string; start?: boolean }
  const tab = (sender as { tab?: { id?: number; windowId: number } }).tab
  if (m.type !== 'open-panel' || !tab) return
  if (m.start && m.pr) void chrome.storage.session.set({ 'auto-review': m.pr })
  void chrome.sidePanel.open(tab.id !== undefined ? { tabId: tab.id } : { windowId: tab.windowId })
})
