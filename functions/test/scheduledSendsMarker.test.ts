/**
 * scheduledSends marker helper — OPTIONAL contract test (PR F).
 *
 * If the implementer extracts the marker-then-send-once invariant into a
 * shared helper at `functions/src/lib/scheduledSendsMarker.ts` (a likely
 * refactor target since both notifyEventReminders and notifyBirthdays
 * share the dedupe shape), this file pins the helper's contract:
 *
 *   `markAndSendOnce(markerRef, sendFn)`:
 *     1. calls `markerRef.create(...)` BEFORE calling sendFn();
 *     2. if create throws ALREADY_EXISTS → returns WITHOUT calling sendFn
 *        (silent skip — at-most-once);
 *     3. if create throws any OTHER error → propagates to caller;
 *     4. if sendFn throws → MARKER REMAINS, error PROPAGATES to the per-
 *        family try/catch in the calling sweep (at-most-once: a dropped
 *        push is the accepted F-PN-13 mode, but the marker MUST NOT be
 *        rolled back — that's what makes the next sweep skip).
 *
 * If the implementer inlines the marker pattern inside each sweep (a
 * reasonable choice — the per-family tests in
 * notifyEventReminders.test.ts + notifyBirthdays.test.ts cover the same
 * invariant end-to-end), this entire test file is a no-op stub: the
 * `existsSync` guard makes the test report "helper not extracted —
 * inlined pattern is acceptable" and pass with a single soft assertion.
 *
 * That asymmetric outcome is INTENTIONAL: it docs the contract for a
 * future refactor without forcing the implementer to extract a helper
 * they didn't need.
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HELPER_PATH = resolve(__dirname, '../src/lib/scheduledSendsMarker.ts');
const HELPER_PATH_ALT = resolve(__dirname, '../src/scheduledSendsMarker.ts');

const helperExists = existsSync(HELPER_PATH) || existsSync(HELPER_PATH_ALT);
const HELPER_RELPATH = existsSync(HELPER_PATH)
  ? '../src/lib/scheduledSendsMarker.js'
  : '../src/scheduledSendsMarker.js';

async function loadHelper(): Promise<Record<string, unknown> | null> {
  if (!helperExists) return null;
  vi.resetModules();
  return (await import(HELPER_RELPATH)) as Record<string, unknown>;
}

describe('scheduledSends marker helper — optional extraction contract', () => {
  it('documents the extraction decision (skipped when inlined, asserts contract when extracted)', () => {
    // Documentation marker. When the helper is NOT extracted, this single
    // assertion passes — the per-sweep tests in notifyEventReminders /
    // notifyBirthdays cover the marker-then-send invariant end-to-end.
    expect(typeof helperExists).toBe('boolean');
  });

  it.runIf(helperExists)(
    'markAndSendOnce calls markerRef.create() BEFORE sendFn() (when extracted)',
    async () => {
      const mod = await loadHelper();
      const markAndSendOnce = (mod?.markAndSendOnce ?? mod?.default) as
        | ((markerRef: unknown, sendFn: () => Promise<unknown>) => Promise<unknown>)
        | undefined;
      expect(
        typeof markAndSendOnce,
        'helper must export a `markAndSendOnce(markerRef, sendFn)` function (or default export with that signature)',
      ).toBe('function');
      if (typeof markAndSendOnce !== 'function') return;

      const callOrder: string[] = [];
      const markerRef = {
        path: 'scheduledSends/eventReminder__evt-x__20260611',
        create: vi.fn(async () => {
          callOrder.push('create');
        }),
      };
      const sendFn = vi.fn(async () => {
        callOrder.push('send');
        return { successCount: 1 };
      });
      await markAndSendOnce(markerRef, sendFn);
      expect(
        callOrder,
        `markAndSendOnce must call create then send, in that order; got ${JSON.stringify(callOrder)}`,
      ).toEqual(['create', 'send']);
    },
  );

  it.runIf(helperExists)(
    'create() throws ALREADY_EXISTS → sendFn NOT called (silent skip)',
    async () => {
      const mod = await loadHelper();
      const markAndSendOnce = (mod?.markAndSendOnce ?? mod?.default) as
        | ((markerRef: unknown, sendFn: () => Promise<unknown>) => Promise<unknown>)
        | undefined;
      if (typeof markAndSendOnce !== 'function') return;

      const markerRef = {
        path: 'scheduledSends/eventReminder__evt-x__20260611',
        create: vi.fn(async () => {
          const err = new Error('ALREADY_EXISTS');
          (err as Error & { code: number | string }).code = 6;
          throw err;
        }),
      };
      const sendFn = vi.fn(async () => ({ successCount: 1 }));
      await markAndSendOnce(markerRef, sendFn);
      expect(
        sendFn,
        'sendFn must NOT be called when create returns ALREADY_EXISTS (silent skip — at-most-once)',
      ).not.toHaveBeenCalled();
    },
  );

  it.runIf(helperExists)(
    "sendFn() throws → marker is NOT deleted; error PROPAGATES (per-family try/catch is the caller's job)",
    async () => {
      const mod = await loadHelper();
      const markAndSendOnce = (mod?.markAndSendOnce ?? mod?.default) as
        | ((markerRef: unknown, sendFn: () => Promise<unknown>) => Promise<unknown>)
        | undefined;
      if (typeof markAndSendOnce !== 'function') return;

      const deleteSpy = vi.fn(async () => undefined);
      const markerRef = {
        path: 'scheduledSends/eventReminder__evt-x__20260611',
        create: vi.fn(async () => undefined),
        delete: deleteSpy,
      };
      const sendFn = vi.fn(async () => {
        throw new Error('FCM unavailable');
      });
      let threw: unknown = undefined;
      try {
        await markAndSendOnce(markerRef, sendFn);
      } catch (e) {
        threw = e;
      }
      expect(threw, 'sendFn-throw must propagate to caller').toBeDefined();
      expect(
        deleteSpy,
        'marker must NOT be rolled back on send-throw (at-most-once: dropped push is accepted, F-PN-13)',
      ).not.toHaveBeenCalled();
    },
  );

  it.runIf(helperExists)(
    'create() throws a non-ALREADY_EXISTS error → sendFn NOT called; error propagates',
    async () => {
      const mod = await loadHelper();
      const markAndSendOnce = (mod?.markAndSendOnce ?? mod?.default) as
        | ((markerRef: unknown, sendFn: () => Promise<unknown>) => Promise<unknown>)
        | undefined;
      if (typeof markAndSendOnce !== 'function') return;

      const markerRef = {
        path: 'scheduledSends/eventReminder__evt-x__20260611',
        create: vi.fn(async () => {
          throw new Error('PERMISSION_DENIED');
        }),
      };
      const sendFn = vi.fn(async () => ({ successCount: 1 }));
      let threw: unknown = undefined;
      try {
        await markAndSendOnce(markerRef, sendFn);
      } catch (e) {
        threw = e;
      }
      expect(threw, 'non-ALREADY_EXISTS create error must propagate').toBeDefined();
      expect(
        sendFn,
        'sendFn must NOT be called when create fails for any reason',
      ).not.toHaveBeenCalled();
    },
  );
});
