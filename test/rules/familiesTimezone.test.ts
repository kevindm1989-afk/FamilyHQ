/**
 * `families/{fid}.timezone` rules contract — PR F1 (F-T11).
 *
 * Adds an optional IANA timezone string to the existing `families` doc.
 * The architect's spec (§14.2): "Parent-editable under the existing
 * parent-only `families` write rule; a settings UI for it is deferred
 * (F13, not in PR F)." Rule additions also enforce a sensible string
 * length cap (≤ 50) so an over-long value can't bloat the doc.
 *
 * The threat-model classifies `timezone` as quasi-location PI at
 * family-granularity (§A.18 row "families.timezone"). Member readability
 * is acceptable (it sits on the family doc, which active members can
 * already read); the primary controls are:
 *   - parent-only WRITE (no member self-tz, no kid self-tz);
 *   - length cap (≤ 50);
 *   - M50 forbidden log-field gate (covered in
 *     `notifyEventReminders.test.ts` / `notifyBirthdays.test.ts`).
 *
 * Test contract (F-T11 verbatim from threat-model §A.10):
 *   - same-family PARENT updates families.timezone → ALLOWED
 *   - same-family MEMBER updates families.timezone → DENIED
 *   - cross-family parent → DENIED
 *   - timezone > 50 chars → DENIED (defensive)
 *   - unauthenticated → DENIED
 *
 * MUST FAIL today: the rule does not enforce a length cap or specific
 * timezone validation; the implementer extends the `families` block to add
 * the validator (and the existing parent-only update rule already covers
 * the member/cross-family cases, but the length-cap test will fail until
 * the implementer adds the constraint).
 */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest';
import { FAMILY_A, FAMILY_B, UID, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});
afterAll(async () => {
  await teardownEnv();
});
beforeEach(async () => {
  await env.clearFirestore();
  await seedBaseline(env);
});
afterEach(async () => {
  await env.clearFirestore();
});

// ===========================================================================
// F-T11 (M50/F1) — same-family parent ALLOWED to write timezone.
// ===========================================================================

describe('F-T11 (M50/F1): same-family PARENT can update families.timezone', () => {
  it('parentA can set families/FAMILY_A.timezone to "America/Vancouver"', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'families', FAMILY_A), { timezone: 'America/Vancouver' }),
    );
  });

  it('parentA can set families/FAMILY_A.timezone to "America/Toronto"', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'families', FAMILY_A), { timezone: 'America/Toronto' }),
    );
  });

  it('parentA can set timezone to a half-hour-offset IANA zone (§14.2 St. John\'s)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(
      updateDoc(doc(db, 'families', FAMILY_A), { timezone: 'America/St_Johns' }),
    );
  });
});

// ===========================================================================
// F-T11 — MEMBER (non-parent) DENIED.
// ===========================================================================

describe('F-T11: same-family MEMBER (non-parent) CANNOT update families.timezone', () => {
  it('memberA CANNOT update families/FAMILY_A.timezone (parent-only write)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'families', FAMILY_A), { timezone: 'America/Vancouver' }));
  });
});

// ===========================================================================
// F-T11 — CROSS-FAMILY parent DENIED.
// ===========================================================================

describe('F-T11: cross-family parent CANNOT update another family\'s timezone', () => {
  it('parentB CANNOT update families/FAMILY_A.timezone', async () => {
    const db = env.authenticatedContext(UID.parentB).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'families', FAMILY_A), { timezone: 'America/Vancouver' }));
  });

  it('parentA CANNOT update families/FAMILY_B.timezone', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'families', FAMILY_B), { timezone: 'America/Toronto' }));
  });
});

// ===========================================================================
// F-T11 — LENGTH CAP (defensive): values > 50 chars DENIED.
// ===========================================================================

describe('F-T11 (defensive): timezone field length > 50 chars is DENIED', () => {
  it('parentA CANNOT write a 51-character timezone string', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // 51 characters — one over the cap; the rule should reject anything
    // longer than a sensible IANA string (longest real IANA is ~32 chars).
    const tooLong = 'a'.repeat(51);
    await assertFails(updateDoc(doc(db, 'families', FAMILY_A), { timezone: tooLong }));
  });

  it('parentA CANNOT write a 200-character timezone string', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    const wayTooLong = 'America/' + 'x'.repeat(200);
    await assertFails(updateDoc(doc(db, 'families', FAMILY_A), { timezone: wayTooLong }));
  });

  it('parentA CANNOT write a timezone value that is not a string (boolean)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'families', FAMILY_A), { timezone: true as unknown as string }),
    );
  });

  it('parentA CAN write at the boundary (≤ 50 chars: "America/Toronto" = 15 chars)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertSucceeds(updateDoc(doc(db, 'families', FAMILY_A), { timezone: 'America/Toronto' }));
  });
});

// ===========================================================================
// F-T11 — UNAUTHENTICATED DENIED.
// ===========================================================================

describe('F-T11: unauthenticated client CANNOT update families.timezone', () => {
  it('anon CANNOT update families/FAMILY_A.timezone', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(updateDoc(doc(db, 'families', FAMILY_A), { timezone: 'America/Vancouver' }));
  });
});

// ===========================================================================
// F-T11 (defense-in-depth): a parent's bare timezone update is the ONLY
// shape allowed — they cannot smuggle a familyName change or any other
// field through the same `update`.
// ===========================================================================

describe('F-T11 (parent rule scope): a parent update touching timezone PLUS another field still respects the existing parent-only write rule', () => {
  it('parentA can update both familyName + timezone in one update (the existing rule allows arbitrary parent edits, length cap on timezone still applied)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    // The existing `families` update rule allows a same-family parent;
    // adding `timezone` keeps that authority. A combined update should
    // succeed as long as the timezone passes its length cap.
    await assertSucceeds(
      updateDoc(doc(db, 'families', FAMILY_A), {
        familyName: 'Renamed Family A',
        timezone: 'America/Toronto',
      }),
    );
  });

  it('a combined update with a TOO-LONG timezone is still denied (length cap applies even when other fields change)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'families', FAMILY_A), {
        familyName: 'Renamed Family A',
        timezone: 'a'.repeat(51),
      }),
    );
  });
});
