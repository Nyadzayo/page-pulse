global.chrome = {
  storage: {
    local: {
      _store: {},
      get: vi.fn(async (keys) => {
        if (typeof keys === 'string') keys = [keys];
        if (keys === null || keys === undefined) return { ...global.chrome.storage.local._store };
        const result = {};
        for (const key of keys) {
          if (key in global.chrome.storage.local._store) {
            result[key] = global.chrome.storage.local._store[key];
          }
        }
        return result;
      }),
      set: vi.fn(async (items) => {
        Object.assign(global.chrome.storage.local._store, items);
      }),
      remove: vi.fn(async (keys) => {
        if (typeof keys === 'string') keys = [keys];
        for (const key of keys) {
          delete global.chrome.storage.local._store[key];
        }
      }),
    },
    sync: {
      _store: {},
      get: vi.fn(async (keys) => {
        if (typeof keys === 'string') keys = [keys];
        const result = {};
        for (const key of keys) {
          if (key in global.chrome.storage.sync._store) {
            result[key] = global.chrome.storage.sync._store[key];
          }
        }
        return result;
      }),
      set: vi.fn(async (items) => {
        Object.assign(global.chrome.storage.sync._store, items);
      }),
    },
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  notifications: {
    create: vi.fn(async () => 'notification-id'),
    clear: vi.fn(),
    onClicked: { addListener: vi.fn() },
    onButtonClicked: { addListener: vi.fn() },
  },
  permissions: {
    request: vi.fn(async () => true),
    contains: vi.fn(async () => true),
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
    getURL: vi.fn((path) => `chrome-extension://fakeid/${path}`),
    getContexts: vi.fn(async () => []),
  },
  scripting: {
    executeScript: vi.fn(),
  },
  offscreen: {
    createDocument: vi.fn(),
    closeDocument: vi.fn(),
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(async () => [{ id: 1 }]),
  },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
};

beforeEach(() => {
  chrome.storage.local._store = {};
  chrome.storage.sync._store = {};
  vi.clearAllMocks();
});
