/**
 * `scheduledSends/{kind}__{sourceId}__{yyyymmdd}` rules contract — PR F2.
 *
 * SECURITY-CRITICAL — F-T8 BLOCKING (T7.4 marker-suppression defense).
 *
 * The scheduled-push functions (`notifyEventReminders`, `notifyBirthdays`)
 * write per-(family, source, day) dedupe markers at this path from the
 * server (Admin SDK, which bypasses these rules). The marker doc id is
 * FULLY PREDICTABLE to a family insider (members read own-family
 * `events`/`birthdays` ids). If a client could create a marker, they could
 * pre-poison tomorrow's id and silently SUPPRESS a parent's reminder
 * (a tampering attack with confidentiality consequences — see
 * threat-model T7.4). The create-deny is therefore the load-bearing
 * suppression defense, not hygiene.
 *
 * Rule contract pinned here (deny-all clients):
 *   - get/list: DENIED for any authenticated parent, member, deactivated
 *     user, or unauthenticated client.
 *   - create: DENIED for all the above (suppression defense, T7.4).
 *   - update: DENIED for all the above.
 *   - delete: DENIED for all the above.
 *
 * Server-side TTL on `expiresAt` purges markers after 7d (runbook F12);
 * that is OUT OF SCOPE of these rules tests.
 *
 * MUST FAIL today: the `match /scheduledSends/{any}` block does not exist
 * in firestore.rules. The default-deny catch-all DOES cover this path, so
 * the assertFails calls below pass for the wrong reason on a green
 * baseline. To pin the EXPLICIT rule block (per F-T8) we also add a
 * static-source assertion that `match /scheduledSends/{any}` is present
 * with `allow read, write: if false;` — the marker docs survive any
 * future rule reorder.
 */
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UID, FAMILY_A, getEnv, seedBaseline, teardownEnv } from './helpers';

let env: RulesTestEnvironment;

const RULES_PATH = resolve(__dirname, '../../firestore.rules');

// Predictable marker id (the suppression-attack-surface shape): a family
// insider can construct this id from a same-family event/birthday id.
const PREDICTABLE_MARKER_ID = `eventReminder__event-${FAMILY_A}__20260611`;
const ANOTHER_PREDICTABLE_ID = `birthday__bd-fixture-1__20260611`;

async function seedMarker(id: string = PREDICTABLE_MARKER_ID): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await setDoc(doc(db, 'scheduledSends', id), {
      kind: 'eventReminder',
      familyId: FAMILY_A,
      sourceId: `event-${FAMILY_A}`,
      localDay: '2026-06-11',
      sentAt: Date.now(),
      recipientCount: 2,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
  });
}

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
// F-T8 (M48) — BLOCKING. Authenticated parent.
// ===========================================================================

describe('F-T8 [BLOCKING — security-critical]: authenticated PARENT cannot read/list/create/update/delete', () => {
  it('parent CANNOT get a scheduledSends doc', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID)));
  });

  it('parent CANNOT list the scheduledSends collection', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'scheduledSends')));
  });

  it('parent CANNOT create a scheduledSends doc (T7.4 SUPPRESSION DEFENSE — this test is the load-bearing one)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID), {
        kind: 'eventReminder',
        familyId: FAMILY_A,
        sourceId: `event-${FAMILY_A}`,
        localDay: '2026-06-11',
        sentAt: Date.now(),
        recipientCount: 1,
        expiresAt: Date.now() + 86_400_000,
      }),
    );
  });

  it('parent CANNOT pre-poison tomorrow\'s marker (the literal attack scenario)', async () => {
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    // Tomorrow's id — a family insider can construct it from a same-family
    // event id. If create succeeded, the marker would suppress tomorrow's
    // reminder for everyone.
    await assertFails(
      setDoc(doc(db, 'scheduledSends', `eventReminder__event-${FAMILY_A}__20260612`), {
        kind: 'eventReminder',
        familyId: FAMILY_A,
        sourceId: `event-${FAMILY_A}`,
        localDay: '2026-06-12',
        sentAt: Date.now(),
        recipientCount: 0,
        expiresAt: Date.now() + 86_400_000,
      }),
    );
  });

  it('parent CANNOT update a scheduledSends doc', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID), { recipientCount: 0 }),
    );
  });

  it('parent CANNOT delete a scheduledSends doc', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.parentA).firestore();
    const { doc, deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID)));
  });
});

// ===========================================================================
// F-T8 — Authenticated KID (non-parent member).
// ===========================================================================

describe('F-T8 [BLOCKING]: authenticated MEMBER (non-parent) cannot read/list/create/update/delete', () => {
  it('member CANNOT get', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID)));
  });

  it('member CANNOT list', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'scheduledSends')));
  });

  it('member CANNOT create (suppression defense T7.4)', async () => {
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'scheduledSends', ANOTHER_PREDICTABLE_ID), {
        kind: 'birthday',
        familyId: FAMILY_A,
        sourceId: 'bd-fixture-1',
        localDay: '2026-06-11',
        sentAt: Date.now(),
        recipientCount: 0,
        expiresAt: Date.now() + 86_400_000,
      }),
    );
  });

  it('member CANNOT update', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID), { recipientCount: 0 }),
    );
  });

  it('member CANNOT delete', async () => {
    await seedMarker();
    const db = env.authenticatedContext(UID.memberA).firestore();
    const { doc, deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID)));
  });
});

// ===========================================================================
// F-T8 — Unauthenticated.
// ===========================================================================

describe('F-T8 [BLOCKING]: unauthenticated client cannot read/list/create/update/delete', () => {
  it('anon CANNOT get', async () => {
    await seedMarker();
    const db = env.unauthenticatedContext().firestore();
    const { doc, getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID)));
  });

  it('anon CANNOT list', async () => {
    await seedMarker();
    const db = env.unauthenticatedContext().firestore();
    const { collection, getDocs } = await import('firebase/firestore');
    await assertFails(getDocs(collection(db, 'scheduledSends')));
  });

  it('anon CANNOT create', async () => {
    const db = env.unauthenticatedContext().firestore();
    const { doc, setDoc } = await import('firebase/firestore');
    await assertFails(
      setDoc(doc(db, 'scheduledSends', 'anon-forged'), {
        kind: 'eventReminder',
        familyId: FAMILY_A,
        sourceId: 'x',
        localDay: '2026-06-11',
        sentAt: Date.now(),
        recipientCount: 0,
        expiresAt: Date.now() + 86_400_000,
      }),
    );
  });

  it('anon CANNOT update', async () => {
    await seedMarker();
    const db = env.unauthenticatedContext().firestore();
    const { doc, updateDoc } = await import('firebase/firestore');
    await assertFails(
      updateDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID), { recipientCount: 0 }),
    );
  });

  it('anon CANNOT delete', async () => {
    await seedMarker();
    const db = env.unauthenticatedContext().firestore();
    const { doc, deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'scheduledSends', PREDICTABLE_MARKER_ID)));
  });
});

// ===========================================================================
// F-T8 — EXPLICIT rule-block static-source assertion (defense-in-depth
// against the default-deny catch-all making this test green for the WRONG
// reason; mirrors test/rules/rateLimits.test.ts intent).
// ===========================================================================

describe('F-T8 (defense-in-depth): the EXPLICIT `match /scheduledSends/{any}` deny-all block is present in firestore.rules', () => {
  it('firestore.rules exists', () => {
    expect(existsSync(RULES_PATH)).toBe(true);
  });

  it('contains an explicit `match /scheduledSends/{...}` block (NOT relying solely on the default-deny catch-all)', () => {
    const rules = readFileSync(RULES_PATH, 'utf8');
    expect(
      /match\s+\/scheduledSends\/\{[A-Za-z_]+\}/.test(rules),
      'firestore.rules must contain an explicit `match /scheduledSends/{any}` block — the suppression defense (T7.4) survives any future rule reorder via this explicit block, not the default-deny catch-all',
    ).toBe(true);
  });

  it('the scheduledSends block contains `allow read, write: if false;` (or equivalent deny-all)', () => {
    const rules = readFileSync(RULES_PATH, 'utf8');
    // Pull the block content between `match /scheduledSends/{...}` and the
    // closing brace (allowing one level of nesting tolerance via a
    // non-greedy scan).
    const m = rules.match(/match\s+\/scheduledSends\/\{[A-Za-z_]+\}\s*\{([\s\S]*?)\}/);
    expect(m, 'expected to find the scheduledSends match block body').not.toBeNull();
    const body = m?.[1] ?? '';
    const hasDenyAll =
      /allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/.test(body) ||
      (/allow\s+get\s*:\s*if\s+false\s*;/.test(body) &&
        /allow\s+list\s*:\s*if\s+false\s*;/.test(body) &&
        /allow\s+create\s*:\s*if\s+false\s*;/.test(body) &&
        /allow\s+update\s*:\s*if\s+false\s*;/.test(body) &&
        /allow\s+delete\s*:\s*if\s+false\s*;/.test(body));
    expect(
      hasDenyAll,
      `scheduledSends rule must explicitly deny all: 'allow read, write: if false;' (or each verb individually as 'if false'); got body:\n${body}`,
    ).toBe(true);
  });
});
