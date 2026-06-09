/**
 * `public/firebase-messaging-sw.js` — service worker contract (PR B4).
 *
 * The SW runs outside the Vite bundle (the browser fetches it from /) so we
 * can't import it through the module graph. Instead we:
 *
 *   1. Read the file as a STRING and assert it never contains PI substrings
 *      or template markers (M34-style static scan, lightweight version
 *      since the SW does not template — it relays the FCM-delivered
 *      payload as-is).
 *   2. Eval the file inside a controlled sandbox with a mocked `self`
 *      (ServiceWorkerGlobalScope-shaped) + a mocked `firebase` /
 *      `firebase.messaging` global, and assert:
 *        - `onBackgroundMessage` is registered.
 *        - On `notificationclick`, an existing app client is focused if
 *          present, otherwise a new window opens at `event.notification.
 *          data.url` (default '/').
 *
 * These FAIL today: the SW file does not exist.
 *
 * Determinism guarantees: no clock; the file is read once per test; no
 * shared global between tests (every test instantiates a fresh sandbox).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const SW_PATH = resolve(__dirname, '../../../public/firebase-messaging-sw.js');

function readSwSource(): string {
  if (!existsSync(SW_PATH)) {
    throw new Error(
      `firebase-messaging-sw.js not found at ${SW_PATH}. ` +
        'PR B4 implementer must create the file (vanilla JS, no bundler).',
    );
  }
  return readFileSync(SW_PATH, 'utf8');
}

// ---------------------------------------------------------------------------
// Static-source scans — no PI / template substitution / hardcoded names
// ---------------------------------------------------------------------------
describe('SW source: no PI substrings, no template markers (M34, lightweight)', () => {
  it('the SW file exists at public/firebase-messaging-sw.js', () => {
    expect(existsSync(SW_PATH), `expected SW file at ${SW_PATH}`).toBe(true);
  });

  it('the SW contains NO template substitution markers (${ or {{ — body is always FCM-delivered)', () => {
    const src = readSwSource();
    expect(src.includes('${'), 'no JS template literals in SW (no client-side templating)').toBe(
      false,
    );
    expect(src.includes('{{'), 'no Handlebars-style templating in SW').toBe(false);
  });

  it('the SW does NOT hardcode any of the forbidden PI substrings (child / kid / parent / chore / wishlist / amount / dollar / name)', () => {
    const src = readSwSource().toLowerCase();
    const forbidden = [
      'child',
      'kid',
      'parent',
      'name', // covers "childName", "userName", etc.
      'chore',
      'wishlist',
      'amount',
      'balance',
      'dollar',
    ];
    for (const word of forbidden) {
      // The SW MAY contain "data.url" / "click" — none of those overlap
      // with the forbidden list. The PI scan rejects any literal mention
      // of a domain-content concept that would imply hardcoded user PI.
      expect(
        src.includes(word),
        `SW source must not include the forbidden substring "${word}" (PI on lock screen risk)`,
      ).toBe(false);
    }
  });

  it('the SW registers onBackgroundMessage on the messaging instance', () => {
    const src = readSwSource();
    expect(src).toMatch(/onBackgroundMessage\s*\(/);
  });

  it('the SW imports firebase scripts via importScripts (the canonical Web Push SW pattern)', () => {
    const src = readSwSource();
    expect(src).toMatch(/importScripts\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// Sandbox eval — handler-registration + click-handler behaviour
// ---------------------------------------------------------------------------
interface MockClient {
  url: string;
  focused: boolean;
  focus: () => Promise<MockClient>;
}
interface SwSandbox {
  registeredBackgroundHandler: ((payload: unknown) => void) | null;
  registeredClickHandler: ((event: unknown) => Promise<void> | void) | null;
  clientsList: MockClient[];
  openedUrls: string[];
}

function buildSandbox(): { ctx: vm.Context; sandbox: SwSandbox } {
  const sandbox: SwSandbox = {
    registeredBackgroundHandler: null,
    registeredClickHandler: null,
    clientsList: [],
    openedUrls: [],
  };

  const mockMessaging = {
    onBackgroundMessage: (handler: (payload: unknown) => void) => {
      sandbox.registeredBackgroundHandler = handler;
    },
  };
  const mockFirebase = {
    initializeApp: () => undefined,
    messaging: () => mockMessaging,
    apps: [] as unknown[],
  };

  const mockSelf = {
    firebase: mockFirebase,
    registration: {
      showNotification: (_title: string, _opts: unknown) => Promise.resolve(),
    },
    clients: {
      matchAll: async (_opts?: { type?: string }) => sandbox.clientsList,
      openWindow: async (url: string) => {
        sandbox.openedUrls.push(url);
        return { url, focused: true, focus: async () => ({ url, focused: true }) } as MockClient;
      },
    },
    addEventListener: (event: string, listener: (e: unknown) => Promise<void> | void) => {
      if (event === 'notificationclick') {
        sandbox.registeredClickHandler = listener;
      }
    },
    importScripts: (..._scripts: string[]) => {
      // No-op — the real importScripts pulls firebase compat into the SW
      // global; in our sandbox `mockFirebase` is already on `self`.
    },
  };

  const ctx = vm.createContext({
    self: mockSelf,
    firebase: mockFirebase,
    importScripts: mockSelf.importScripts,
    console: { log: () => undefined, error: () => undefined, warn: () => undefined },
  });
  return { ctx, sandbox };
}

describe('SW behaviour: onBackgroundMessage + notificationclick (focus-or-open)', () => {
  it('registering the SW calls firebase.messaging().onBackgroundMessage with a handler', () => {
    const src = readSwSource();
    const { ctx, sandbox } = buildSandbox();
    vm.runInContext(src, ctx);
    expect(sandbox.registeredBackgroundHandler, 'onBackgroundMessage handler must be set').not.toBeNull();
    expect(typeof sandbox.registeredBackgroundHandler).toBe('function');
  });

  it('on notificationclick with an EXISTING client whose URL matches, focuses that client (no new window)', async () => {
    const src = readSwSource();
    const { ctx, sandbox } = buildSandbox();
    let focusCalled = false;
    sandbox.clientsList = [
      {
        url: 'https://example.test/',
        focused: false,
        focus: async () => {
          focusCalled = true;
          return { url: 'https://example.test/', focused: true } as MockClient;
        },
      },
    ];
    vm.runInContext(src, ctx);
    expect(sandbox.registeredClickHandler, 'notificationclick handler must be set').not.toBeNull();

    const event: {
      notification: { close: () => void; data: { url: string } };
      waitUntil: (p: Promise<unknown>) => void;
    } = {
      notification: { close: () => undefined, data: { url: '/' } },
      waitUntil: (p) => p,
    };
    await sandbox.registeredClickHandler!(event);
    expect(focusCalled, 'existing client must be focused').toBe(true);
    expect(sandbox.openedUrls, 'no new window when an existing client is focused').toHaveLength(0);
  });

  it('on notificationclick with NO existing clients, opens a new window at data.url', async () => {
    const src = readSwSource();
    const { ctx, sandbox } = buildSandbox();
    sandbox.clientsList = []; // no app open

    vm.runInContext(src, ctx);
    const event: {
      notification: { close: () => void; data: { url: string } };
      waitUntil: (p: Promise<unknown>) => void;
    } = {
      notification: { close: () => undefined, data: { url: '/inbox' } },
      waitUntil: (p) => p,
    };
    await sandbox.registeredClickHandler!(event);
    expect(sandbox.openedUrls).toEqual(['/inbox']);
  });

  it('on notificationclick with NO existing clients AND missing data.url, opens at default "/"', async () => {
    const src = readSwSource();
    const { ctx, sandbox } = buildSandbox();
    sandbox.clientsList = [];

    vm.runInContext(src, ctx);
    const event: {
      notification: { close: () => void; data: Record<string, never> };
      waitUntil: (p: Promise<unknown>) => void;
    } = {
      notification: { close: () => undefined, data: {} },
      waitUntil: (p) => p,
    };
    await sandbox.registeredClickHandler!(event);
    expect(sandbox.openedUrls, 'default to "/" when data.url is absent').toEqual(['/']);
  });
});
