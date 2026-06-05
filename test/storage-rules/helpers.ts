/**
 * Shared harness for the Firebase Storage security-rules emulator suite.
 *
 * Mirrors `test/rules/helpers.ts` (the Firestore tier) but adds the
 * Storage emulator. storage.rules uses cross-collection
 * `firestore.get()` lookups for callerDoc + chore-assignee checks, so
 * BOTH emulators must be live; the seed step plants users/chores docs
 * under `withSecurityRulesDisabled` before the suite asserts allow/deny.
 *
 * One emulator-connected environment per suite file (module-singleton
 * `sharedEnv`). `clearStorage()` + `clearFirestore()` in beforeEach so
 * tests don't bleed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storageRulesPath = path.join(__dirname, '..', '..', 'storage.rules');
const firestoreRulesPath = path.join(__dirname, '..', '..', 'firestore.rules');

// "demo-" prefix activates the Firebase emulator's demo-mode (no
// service-account / billing). Aligned with the project the emulator is
// booted with (see the npm script that wraps `firebase emulators:exec`)
// so storage.rules's cross-service `firestore.get()` call routes to the
// SAME project namespace where we seeded the user / chore docs. Without
// this alignment, Storage's rules engine queries the emulator's default
// (.firebaserc) project, finds no callerDoc, and denies every "allowed"
// request.
export const PROJECT_ID = 'demo-storage-rules-test';

export const FAMILY_A = 'family-A';
export const FAMILY_B = 'family-B';

export const UID = {
  parentA: 'uid-parent-a',
  memberA: 'uid-member-a',
  member2A: 'uid-member-2-a',
  deactivatedA: 'uid-deactivated-a',
  parentB: 'uid-parent-b',
  memberB: 'uid-member-b',
};

export const CHORE = {
  /** Belongs to FAMILY_A, assigned to memberA. */
  aAssigned: 'chore-a-assigned-to-member-a',
  /** Belongs to FAMILY_A, assigned to member2A (a peer). */
  aPeer: 'chore-a-assigned-to-peer',
  /** Belongs to FAMILY_B, assigned to memberB (cross-tenant). */
  bAssigned: 'chore-b-assigned-to-member-b',
};

let sharedEnv: RulesTestEnvironment | null = null;

/** One emulator-connected environment per suite file. */
export async function getEnv(): Promise<RulesTestEnvironment> {
  if (sharedEnv) return sharedEnv;
  sharedEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(firestoreRulesPath, 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: fs.readFileSync(storageRulesPath, 'utf8'),
      host: '127.0.0.1',
      port: 9199,
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

/**
 * Plant the baseline users + chores under `withSecurityRulesDisabled`
 * so the tests themselves see a stable world. Two families, four
 * members, three chores covering own / peer / cross-tenant.
 */
export async function seedBaseline(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const { doc, setDoc } = await import('firebase/firestore');

    const baseUser = (
      name: string,
      role: 'parent' | 'member',
      familyId: string,
      isActive: boolean,
    ): Record<string, unknown> => ({
      name,
      role,
      familyId,
      isActive,
      allowanceBalance: 0,
      theme: 'light',
    });

    await setDoc(
      doc(adminDb, 'users', UID.parentA),
      baseUser('Parent A', 'parent', FAMILY_A, true),
    );
    await setDoc(
      doc(adminDb, 'users', UID.memberA),
      baseUser('Member A', 'member', FAMILY_A, true),
    );
    await setDoc(
      doc(adminDb, 'users', UID.member2A),
      baseUser('Member 2 A', 'member', FAMILY_A, true),
    );
    await setDoc(
      doc(adminDb, 'users', UID.deactivatedA),
      baseUser('Deactivated A', 'member', FAMILY_A, false),
    );
    await setDoc(
      doc(adminDb, 'users', UID.parentB),
      baseUser('Parent B', 'parent', FAMILY_B, true),
    );
    await setDoc(
      doc(adminDb, 'users', UID.memberB),
      baseUser('Member B', 'member', FAMILY_B, true),
    );

    const baseChore = (
      assignedTo: string,
      familyId: string,
      createdBy: string,
    ): Record<string, unknown> => ({
      title: 'Take out trash',
      assignedTo,
      dueDate: '2026-06-15',
      pointValue: 5,
      dollarValue: 100,
      status: 'pending',
      familyId,
      createdBy,
      createdAt: 1_700_000_000_000,
      isRecurring: false,
      recurrenceFrequency: 'none',
    });

    await setDoc(
      doc(adminDb, 'chores', CHORE.aAssigned),
      baseChore(UID.memberA, FAMILY_A, UID.parentA),
    );
    await setDoc(
      doc(adminDb, 'chores', CHORE.aPeer),
      baseChore(UID.member2A, FAMILY_A, UID.parentA),
    );
    await setDoc(
      doc(adminDb, 'chores', CHORE.bAssigned),
      baseChore(UID.memberB, FAMILY_B, UID.parentB),
    );
  });
}

/**
 * Build a synthetic Blob of the requested size + mime type. The
 * Storage emulator inspects `contentType` from the metadata; size comes
 * from the byte length the Blob reports.
 */
export function mkBlob(opts: { type?: string; size?: number } = {}): Blob {
  const type = opts.type ?? 'image/jpeg';
  const size = opts.size ?? 1024;
  return new Blob([new Uint8Array(size)], { type });
}
