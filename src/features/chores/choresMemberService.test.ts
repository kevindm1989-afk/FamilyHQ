/**
 * Chores member service — unit contract (Task 10; ADR-0001/0002, threat-model
 * T1.4/M4, T1.8/M8). Mirrors boardService.test.ts / calendarService.test.ts.
 *
 * Level: unit. Firestore is mocked at the SDK boundary so we assert the SERVICE
 * behavior — the EXACT mark-complete write (status only, no value fields),
 * PII-free error mapping, the copy constants, and the pure STATIC
 * statusBadgeClass map — without a live emulator. Server-side authority (a
 * member may ONLY move their own chore pending->complete, never self-approve or
 * touch the balance) is covered by test/rules/chores-*.ts.
 *
 * FAILS today: choresMemberService.ts is a declare-only contract stub.
 *
 * Isolation: clock frozen (vi.useFakeTimers); no network/RNG; each test
 * re-creates its mocks (no shared mutable state, order-independent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface UpdatedRef {
  collection: string;
  id: string;
  data: Record<string, unknown>;
}
let updated: UpdatedRef[];
let updateShouldReject: boolean;

const docMock = vi.fn((_db: unknown, name: string, id: string) => ({
  __collection: name,
  __id: id,
}));
const updateDocMock = vi.fn(
  async (ref: { __collection: string; __id: string }, data: Record<string, unknown>) => {
    if (updateShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
    updated.push({ collection: ref.__collection, id: ref.__id, data });
  },
);

vi.mock('firebase/firestore', () => ({
  doc: (...a: [unknown, string, string]) => docMock(...a),
  updateDoc: (...a: [{ __collection: string; __id: string }, Record<string, unknown>]) =>
    updateDocMock(...a),
}));

import {
  CHORE_COMPLETE_SUCCESS,
  CHORE_GENERIC_ERROR,
  ChoreActionError,
  markComplete,
  statusBadgeClass,
} from './choresMemberService';
import type { ChoreStatus } from '../../lib/types';

const db = {} as import('firebase/firestore').Firestore;
const FIXED_NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

beforeEach(() => {
  updated = [];
  updateShouldReject = false;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('markComplete — happy path: writes ONLY the pending->complete status', () => {
  it('updates the chores doc by id', async () => {
    await markComplete({ db }, 'chore-1');
    expect(updated).toHaveLength(1);
    expect(updated[0]!.collection).toBe('chores');
    expect(updated[0]!.id).toBe('chore-1');
  });

  it('sets status to "complete"', async () => {
    await markComplete({ db }, 'chore-1');
    expect(updated[0]!.data.status).toBe('complete');
  });

  it('writes ONLY status — never assignedTo/pointValue/dollarValue/familyId (member may not edit those)', async () => {
    await markComplete({ db }, 'chore-1');
    const data = updated[0]!.data;
    // The member transition rule forbids touching these fields; the service must
    // not even attempt to write them, or the rule denies the whole update.
    for (const forbidden of [
      'assignedTo',
      'pointValue',
      'dollarValue',
      'familyId',
      'createdBy',
      'allowanceBalance',
    ]) {
      expect(forbidden in data, `${forbidden} must NOT be written by markComplete`).toBe(false);
    }
    expect(Object.keys(data)).toEqual(['status']);
  });

  it('never writes an approval status — a member cannot self-approve', async () => {
    await markComplete({ db }, 'chore-1');
    expect(updated[0]!.data.status).not.toBe('approved');
    expect(updated[0]!.data.status).not.toBe('rejected');
  });

  // Redo loop (Phase 3, Task 11 lifecycle decision): the SAME markComplete drives
  // both pending->complete and rejected->complete — it only ever writes the
  // status='complete' field, so it is reused verbatim for the "Try again"
  // affordance. The transition-legality (which prior states may move to complete)
  // is enforced server-side and pinned in test/rules/chores-create-hardening.ts.
  it('the redo path uses the SAME write (status:"complete" only) — reusable for rejected -> complete', async () => {
    await markComplete({ db }, 'rejected-chore');
    expect(updated[0]!.data).toEqual({ status: 'complete' });
  });
});

describe('markComplete — error path (security/privacy): raw Firestore errors never surface', () => {
  it('maps a Firestore failure to the generic PII-free message', async () => {
    updateShouldReject = true;
    await expect(markComplete({ db }, 'chore-1')).rejects.toThrow(CHORE_GENERIC_ERROR);
  });

  it('rejects with a ChoreActionError instance (typed, generic)', async () => {
    updateShouldReject = true;
    await expect(markComplete({ db }, 'chore-1')).rejects.toBeInstanceOf(ChoreActionError);
  });

  it('the surfaced error contains no raw Firebase text and no chore id', async () => {
    updateShouldReject = true;
    const err = await markComplete({ db }, 'secret-chore-id').then(
      () => new Error('expected markComplete to reject'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe(CHORE_GENERIC_ERROR);
    expect(err.message).not.toMatch(/emulated-firestore-failure/);
    expect(err.message).not.toContain('secret-chore-id');
  });
});

describe('toast copy — defined for the toast-everything rule', () => {
  it('the complete-success copy is the design string "Marked complete — waiting for approval"', () => {
    expect(CHORE_COMPLETE_SUCCESS).toBe('Marked complete — waiting for approval');
  });

  it('success + generic error copy are non-empty strings', () => {
    for (const s of [CHORE_COMPLETE_SUCCESS, CHORE_GENERIC_ERROR]) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('the error copy carries no PII / raw provider token', () => {
    expect(CHORE_GENERIC_ERROR).not.toMatch(/permission-denied|firestore|@|uid-/i);
  });
});

describe('statusBadgeClass — STATIC literal map by status (no interpolation; lessons.md Tailwind)', () => {
  // The four ChoreStatus values map to a FULL literal Badge tone class. These
  // are the literal class strings Badge.tsx / a static map declare so Tailwind's
  // JIT can see them. An interpolation-built string (`bg-${status}`) is NOT
  // statically analysable and the rule would never be emitted — so we pin the
  // observable proxy: every output is a member of the finite KNOWN set, AND the
  // unknown-value fallback (which interpolation cannot satisfy) is safe.
  const KNOWN_LITERALS = new Set([
    // pending -> muted/grey; complete -> amber "waiting"; approved -> green;
    // rejected -> red. Expressed as the Badge tone-class literals (mirror
    // Badge.tsx TONE_CLASS values).
    'bg-surface-line2 text-ink-2', // mute / pending
    'bg-accent-light text-accent-dark', // amber / complete (waiting for approval)
    'bg-status-ok-light text-status-ok-text', // ok / approved
    'bg-status-danger-light text-status-danger-text', // danger / rejected
  ]);

  it('pending -> the muted/grey tone class', () => {
    expect(statusBadgeClass('pending')).toBe('bg-surface-line2 text-ink-2');
  });

  // RECONCILIATION (flagged): the enum has 4 values, the design lists 5 badge
  // colours. `complete` maps to the AMBER "waiting for approval" state.
  it('complete -> the AMBER "waiting for approval" tone class (4-enum / 5-colour reconciliation)', () => {
    expect(statusBadgeClass('complete')).toBe('bg-accent-light text-accent-dark');
  });

  it('approved -> the green/ok tone class', () => {
    expect(statusBadgeClass('approved')).toBe('bg-status-ok-light text-status-ok-text');
  });

  it('rejected -> the red/danger tone class', () => {
    expect(statusBadgeClass('rejected')).toBe('bg-status-danger-light text-status-danger-text');
  });

  it('every valid status maps to one of the KNOWN full literal classes (static set, not interpolation-shaped)', () => {
    for (const status of ['pending', 'complete', 'approved', 'rejected'] as ChoreStatus[]) {
      expect(
        KNOWN_LITERALS.has(statusBadgeClass(status)),
        `${status} must map to a known full literal token class (a static map member)`,
      ).toBe(true);
    }
  });

  it('no returned class embeds a raw hex colour (tokens only)', () => {
    for (const status of ['pending', 'complete', 'approved', 'rejected'] as ChoreStatus[]) {
      expect(statusBadgeClass(status)).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });

  it('an UNKNOWN/invalid status returns a SAFE fallback literal — never undefined/empty/interpolated', () => {
    // An invalid status can arrive from stale cache / a future schema value. The
    // function must fail SAFE to a real, JIT-visible token class — NOT
    // `bg-undefined` (the interpolation artefact) and NOT '' / undefined.
    const fallback = statusBadgeClass('totally-unknown' as ChoreStatus);
    expect(typeof fallback, 'fallback must be a string').toBe('string');
    expect(fallback.length, 'fallback must be non-empty').toBeGreaterThan(0);
    expect(fallback).not.toMatch(/undefined|null/);
    expect(
      fallback,
      'fallback must not be the interpolation artefact for an unknown status',
    ).not.toBe('bg-totally-unknown');
    expect(
      KNOWN_LITERALS.has(fallback),
      'fallback must be one of the known full literal token classes',
    ).toBe(true);
  });
});
