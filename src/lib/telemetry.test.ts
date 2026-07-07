/**
 * telemetry — unit contract (first-party analytics + error reporting).
 *
 * Pins the privacy + reliability invariants:
 *  - scrubText masks emails + long digit runs and caps length;
 *  - scrubRoute collapses id-like path segments;
 *  - stackHead keeps ONE origin-stripped frame;
 *  - usageEvents writes carry EXACTLY {event, day} (no uid/familyId);
 *  - clientErrors writes are scrubbed, shaped, and session-capped;
 *  - the writers NEVER throw/reject, even when the firebase import fails;
 *  - telemetry is inert under vitest unless force-enabled (so feature
 *    suites never see stray telemetry addDoc calls in their mocks).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addDocMock = vi.fn(async (_col: unknown, _data: unknown) => ({ id: 'x' }));
const collectionMock = vi.fn((_db: unknown, name: string) => ({ __col: name }));

vi.mock('firebase/firestore', () => ({
  addDoc: (col: unknown, data: unknown) => addDocMock(col, data),
  collection: (db: unknown, name: string) => collectionMock(db, name),
}));
vi.mock('../firebase/config', () => ({ db: { __db: true } }));

import {
  ERROR_REPORT_SESSION_CAP,
  _forceEnableForTests,
  _resetErrorReportCountForTests,
  reportClientError,
  scrubRoute,
  scrubText,
  stackHead,
  trackUsage,
} from './telemetry';

/** Let the detached writer's microtasks settle. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  addDocMock.mockClear();
  collectionMock.mockClear();
  _resetErrorReportCountForTests();
  _forceEnableForTests(true);
});
afterEach(() => {
  _forceEnableForTests(false);
});

describe('scrubText', () => {
  it('masks email-shaped substrings', () => {
    expect(scrubText('failed for maya.kim+test@example.com today', 100)).toBe(
      'failed for [email] today',
    );
  });
  it('masks digit runs of 6+ (ids, phone numbers) but keeps short numbers', () => {
    expect(scrubText('code 1234 uid 4903384950181234', 100)).toBe('code 1234 uid [num]');
  });
  it('caps the length', () => {
    expect(scrubText('a'.repeat(500), 300)).toHaveLength(300);
  });
});

describe('scrubRoute', () => {
  it('collapses id-like segments (>12 chars) to :id', () => {
    expect(scrubRoute('/join/aBcDeFgH1234567890')).toBe('/join/:id');
  });
  it('keeps ordinary route segments', () => {
    expect(scrubRoute('/family')).toBe('/family');
    expect(scrubRoute('/chores')).toBe('/chores');
  });
});

describe('stackHead', () => {
  it('keeps one frame and strips the origin', () => {
    const stack = [
      'Error: boom',
      '    at ChoreCard (https://familyhq-68638.web.app/assets/ChoresRoute-abc.js:1:4567)',
      '    at renderWithHooks (https://familyhq-68638.web.app/assets/vendor.js:2:999)',
    ].join('\n');
    const head = stackHead(stack);
    expect(head).toContain('ChoreCard');
    expect(head).not.toContain('familyhq-68638.web.app');
    expect(head).not.toContain('renderWithHooks');
  });
  it('returns empty string for missing stacks', () => {
    expect(stackHead(undefined)).toBe('');
  });
});

describe('trackUsage', () => {
  it('writes EXACTLY {event, day} to usageEvents — no uid, no familyId', async () => {
    trackUsage('chore_approved');
    await flush();
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [colRef, payload] = addDocMock.mock.calls[0] as unknown as [
      { __col: string },
      Record<string, unknown>,
    ];
    expect(colRef.__col).toBe('usageEvents');
    expect(Object.keys(payload).sort()).toEqual(['day', 'event']);
    expect(payload.event).toBe('chore_approved');
    expect(payload.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('NEVER rejects/throws when the write fails', async () => {
    addDocMock.mockRejectedValueOnce(new Error('rules denied'));
    expect(() => trackUsage('chore_created')).not.toThrow();
    await flush(); // an unhandled rejection here would fail the test run
  });

  it('is inert when not force-enabled (feature suites see no writes)', async () => {
    _forceEnableForTests(false);
    trackUsage('family_created');
    await flush();
    expect(addDocMock).not.toHaveBeenCalled();
  });
});

describe('reportClientError', () => {
  it('writes the scrubbed shape to clientErrors', async () => {
    const err = new Error('lookup failed for maya.kim@example.com (uid 4903384950)');
    reportClientError({ error: err, pathname: '/join/aBcDeFgH1234567890' });
    await flush();
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [colRef, payload] = addDocMock.mock.calls[0] as unknown as [
      { __col: string },
      Record<string, unknown>,
    ];
    expect(colRef.__col).toBe('clientErrors');
    expect(Object.keys(payload).sort()).toEqual(['day', 'message', 'name', 'route', 'stackHead']);
    expect(payload.message).not.toContain('maya.kim@example.com');
    expect(payload.message).toContain('[email]');
    expect(payload.message).toContain('[num]');
    expect(payload.route).toBe('/join/:id');
  });

  it('caps reports per session', async () => {
    for (let i = 0; i < ERROR_REPORT_SESSION_CAP + 3; i += 1) {
      reportClientError({ error: new Error(`boom ${i}`) });
    }
    // waitFor the real condition (the 2026-07-07 de-flake lesson): N parallel
    // detached writers each cross several async turns; a fixed flush races.
    await vi.waitFor(() => expect(addDocMock).toHaveBeenCalledTimes(ERROR_REPORT_SESSION_CAP));
    // Settle a little longer and confirm no 6th write ever lands.
    await flush();
    expect(addDocMock).toHaveBeenCalledTimes(ERROR_REPORT_SESSION_CAP);
  });
});
