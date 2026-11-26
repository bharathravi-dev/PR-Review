// The slice of the Chrome extension API this extension uses (no @types/chrome dependency).
declare namespace chrome {
  namespace runtime {
    const id: string
    function getURL(path: string): string
    function getManifest(): { version: string }
    const onInstalled: { addListener(cb: () => void): void }
    const onMessage: { addListener(cb: (msg: unknown, sender: unknown, reply: (r?: unknown) => void) => boolean | void): void }
    function sendMessage(msg: unknown): Promise<unknown>
  }
  namespace storage {
    interface Area {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string | string[]): Promise<void>
    }
    const local: Area
    const session: Area
  }
  namespace tabs {
    interface Tab {
      id?: number
      url?: string
      windowId: number
      active: boolean
    }
    function query(q: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>
    function update(tabId: number, props: { url?: string }): Promise<Tab>
    function create(props: { url: string; active?: boolean }): Promise<Tab>
    const onActivated: { addListener(cb: (info: { tabId: number; windowId: number }) => void): void }
    const onUpdated: { addListener(cb: (tabId: number, change: { url?: string; status?: string }, tab: Tab) => void): void }
  }
  namespace sidePanel {
    function setPanelBehavior(b: { openPanelOnActionClick: boolean }): Promise<void>
    function open(o: { windowId?: number; tabId?: number }): Promise<void>
  }
  namespace commands {
    const onCommand: { addListener(cb: (command: string, tab?: tabs.Tab) => void): void }
  }
  namespace windows {
    function getCurrent(): Promise<{ id: number }>
  }
}
declare const __GITHUB_CLIENT_ID__: string
