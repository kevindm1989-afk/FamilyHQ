/**
 * Shared harness for the Firestore security-rules emulator suite (Task 5).
 *
 * These tests are SECURITY-CRITICAL (threat-model §3, §4, §8 priority-1 rows;
 * constraints.md "Tenant isolation — the #1 security requirement"). They run
 * against the local Firestore emulator under `npm run test:rules`, which wraps
 * Vitest in `firebase emulators:exec` so the emulator is up.
 *
 * Pattern (from @firebase/rules-unit-testing docs):
 *   - Seed data with security rules DISABLED (`withSecurityRulesDisabled`), so
 *     the fixtures themselves are never gated by the rules under test.
 *   - Then assert allow/deny with AUTHENTICATED contexts that go THROUGH the
 *     rules. `assertSucceeds` / `assertFails` encode the expected verdict.
 *
 * Each test maps to a threat-model mitigation / leakage-path id (M#, P#, tests
 * A-G) so a reviewer can trace coverage straight to the model.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesPath = path.resolve(here, '../../firestore.rules');

export const PROJECT_ID = 'familyhq-rules-test';

// Two independent tenants. Cross-tenant assertions live or die on these.
export const FAMILY_A = 'family-A';
export const FAMILY_B = 'family-B';

// Stable actor UIDs (synthetic — no real PI, per constraints "No PII in test
// fixtures"). Names are placeholder strings, never real people.
export const UID = {
  parentA: 'uid-parent-a',
  memberA: 'uid-member-a',
  member2A: 'uid-member-2-a',
  deactivatedA: 'uid-deactivated-a',
  parentB: 'uid-parent-b',
  memberB: 'uid-member-b',
  // a freshly-authenticated user with NO users/{uid} doc yet (signup bootstrap).
  fresh: 'uid-fresh-founder',
} as const;

export type SeededUser = {
  name: string;
  email: string;
  role: 'parent' | 'member';
  familyId: string;
  isActive: boolean;
  allowanceBalance: number;
  theme: 'light' | 'dark';
};

/**
 * Canonical seed: two families, each with a parent + a member, plus a
 * deactivated member in A. All written with rules disabled.
 */
export async function seedBaseline(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { doc, setDoc } = await import('firebase/firestore');

    await setDoc(doc(db, 'families', FAMILY_A), {
      familyName: 'Family A',
      createdBy: UID.parentA,
      createdAt: Date.now(),
    });
    await setDoc(doc(db, 'families', FAMILY_B), {
      familyName: 'Family B',
      createdBy: UID.parentB,
      createdAt: Date.now(),
    });

    const users: Record<string, SeededUser> = {
      [UID.parentA]: mkUser('Parent A', 'parent', FAMILY_A, true),
      [UID.memberA]: mkUser('Member A', 'member', FAMILY_A, true),
      [UID.member2A]: mkUser('Member Two A', 'member', FAMILY_A, true),
      [UID.deactivatedA]: mkUser('Deactivated A', 'member', FAMILY_A, false),
      [UID.parentB]: mkUser('Parent B', 'parent', FAMILY_B, true),
      [UID.memberB]: mkUser('Member B', 'member', FAMILY_B, true),
    };
    for (const [uid, data] of Object.entries(users)) {
      await setDoc(doc(db, 'users', uid), data);
    }

    // One doc per tenant collection, per family, for cross-tenant read/list.
    for (const fid of [FAMILY_A, FAMILY_B]) {
      const ownerUid = fid === FAMILY_A ? UID.parentA : UID.parentB;
      const memberUid = fid === FAMILY_A ? UID.memberA : UID.memberB;
      await setDoc(doc(db, 'events', `event-${fid}`), {
        title: 'Event',
        description: '',
        date: '2026-05-26',
        tag: 'family',
        familyId: fid,
        createdBy: ownerUid,
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'posts', `post-${fid}`), {
        content: 'A family post',
        authorId: ownerUid,
        authorName: 'Parent',
        familyId: fid,
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'chores', `chore-${fid}`), {
        title: 'Take out trash',
        assignedTo: memberUid,
        dueDate: '2026-05-27',
        pointValue: 10,
        dollarValue: 3,
        status: 'pending',
        familyId: fid,
        createdBy: ownerUid,
        createdAt: Date.now(),
        isRecurring: false,
        recurrenceFrequency: 'none',
      });
      await setDoc(doc(db, 'transactions', `txn-${fid}`), {
        uid: memberUid,
        choreId: `chore-${fid}`,
        choreTitle: 'Take out trash',
        amount: 3,
        type: 'earning',
        familyId: fid,
        createdAt: Date.now(),
      });
      await setDoc(doc(db, 'invites', `invite-${fid}`), {
        email: 'invitee@example.test',
        role: 'member',
        familyId: fid,
        invitedBy: ownerUid,
        createdAt: Date.now(),
        status: 'pending',
      });
    }
  });
}

function mkUser(
  name: string,
  role: 'parent' | 'member',
  familyId: string,
  isActive: boolean,
): SeededUser {
  return {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
    role,
    familyId,
    isActive,
    allowanceBalance: 0,
    theme: 'light',
  };
}

let sharedEnv: RulesTestEnvironment | null = null;

/** One emulator-connected environment per suite file. */
export async function getEnv(): Promise<RulesTestEnvironment> {
  if (sharedEnv) return sharedEnv;
  sharedEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(rulesPath, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  return sharedEnv;
}

export async function teardownEnv(): Promise<void> {
  if (sharedEnv) {
    await sharedEnv.cleanup();
    sharedEnv = null;
  }
}
