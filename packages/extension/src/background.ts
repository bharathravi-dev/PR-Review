// Service worker: the toolbar icon and the keyboard command open the side panel. No review runs here; Standalone
// reviews run in the panel page (AD-16).
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel' && tab) void chrome.sidePanel.open({ windowId: tab.windowId })
})
