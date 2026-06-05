/**
 * storage.rules — Feature 2 (Chore Photo Verification).
 *
 * Pins every rule branch of the proof-image path
 * `families/{familyId}/chores/{choreId}/{fileName}`:
 *
 *   READ: parent same-family, member same-family — both OK; cross-tenant,
 *   deactivated, signed-out — all denied.
 *
 *   CREATE/UPDATE: the chore's assignee (rules `choreAssignedToCaller`)
 *   OK; a same-family peer member denied; a same-family parent denied
 *   (separation of duties); cross-tenant denied; non-image MIME denied;
 *   over-5MB denied.
 *
 *   DELETE: parent same-family OK; member same-family denied.
 *
 * Each test maps to a single rule branch so a reviewer can trace
 * coverage to the rules file line-by-line.
 */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { CHORE, FAMILY_A, UID, getEnv, mkBlob, seedBaseline, teardownEnv } from './helpers';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});
afterAll(async () => {
  await teardownEnv();
});

beforeEach(async () => {
  await env.clearStorage();
  await env.clearFirestore();
  await seedBaseline(env);
});

function proofPath(familyId: string, choreId: string): string {
  return `families/${familyId}/chores/${choreId}/proof.jpg`;
}

// Helper: stage a proof image under withSecurityRulesDisabled so READ
// tests can see something to fetch (the CREATE rule is exercised by its
// own describe).
async function stageProof(env: RulesTestEnvironment, path: string): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const storage = ctx.storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    await uploadBytes(ref(storage, path), mkBlob(), { contentType: 'image/jpeg' });
  });
}

describe('storage.rules — READ (proof image fetch)', () => {
  beforeEach(async () => {
    await stageProof(env, proofPath(FAMILY_A, CHORE.aAssigned));
  });

  it('PARENT in same family CAN read a proof image', async () => {
    const storage = env.authenticatedContext(UID.parentA).storage();
    const { ref, getDownloadURL } = await import('firebase/storage');
    await assertSucceeds(getDownloadURL(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });

  it('MEMBER (the assignee) CAN read their own proof image', async () => {
    const storage = env.authenticatedContext(UID.memberA).storage();
    const { ref, getDownloadURL } = await import('firebase/storage');
    await assertSucceeds(getDownloadURL(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });

  it("SAME-FAMILY peer member CAN read a sibling's proof image (family-wide read)", async () => {
    // storage.rules allows any active same-family caller to read; this
    // is intentional — kids see each other's chores anyway via the
    // family-chore feed once a parent is viewing.
    const storage = env.authenticatedContext(UID.member2A).storage();
    const { ref, getDownloadURL } = await import('firebase/storage');
    await assertSucceeds(getDownloadURL(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });

  it('cross-tenant: parent of B CANNOT read a family-A proof', async () => {
    const storage = env.authenticatedContext(UID.parentB).storage();
    const { ref, getDownloadURL } = await import('firebase/storage');
    await assertFails(getDownloadURL(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });

  it('DEACTIVATED same-family caller CANNOT read (isActive check)', async () => {
    const storage = env.authenticatedContext(UID.deactivatedA).storage();
    const { ref, getDownloadURL } = await import('firebase/storage');
    await assertFails(getDownloadURL(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });

  it('UNAUTHENTICATED caller CANNOT read', async () => {
    const storage = env.unauthenticatedContext().storage();
    const { ref, getDownloadURL } = await import('firebase/storage');
    await assertFails(getDownloadURL(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });
});

describe('storage.rules — CREATE (proof image upload)', () => {
  it('the chore ASSIGNEE CAN upload a proof image', async () => {
    const storage = env.authenticatedContext(UID.memberA).storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    await assertSucceeds(
      uploadBytes(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned)), mkBlob(), {
        contentType: 'image/jpeg',
      }),
    );
  });

  it("a SAME-FAMILY PEER member CANNOT upload to someone else's chore", async () => {
    // member2A is in family A but the chore is assigned to memberA — the
    // assignee-check denies this even though they share a tenant.
    const storage = env.authenticatedContext(UID.member2A).storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    await assertFails(
      uploadBytes(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned)), mkBlob(), {
        contentType: 'image/jpeg',
      }),
    );
  });

  it('SAME-FAMILY PARENT CANNOT upload on behalf of the kid (separation of duties)', async () => {
    // Parents can REVIEW + DELETE but not impersonate the kid's
    // submission. Rule enforces assignee == request.auth.uid.
    const storage = env.authenticatedContext(UID.parentA).storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    await assertFails(
      uploadBytes(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned)), mkBlob(), {
        contentType: 'image/jpeg',
      }),
    );
  });

  it('cross-tenant: member of B CANNOT upload to a family-A chore', async () => {
    const storage = env.authenticatedContext(UID.memberB).storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    await assertFails(
      uploadBytes(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned)), mkBlob(), {
        contentType: 'image/jpeg',
      }),
    );
  });

  it('non-image MIME type (application/pdf) is REJECTED', async () => {
    const storage = env.authenticatedContext(UID.memberA).storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    await assertFails(
      uploadBytes(
        ref(storage, proofPath(FAMILY_A, CHORE.aAssigned)),
        mkBlob({ type: 'application/pdf' }),
        { contentType: 'application/pdf' },
      ),
    );
  });

  it('a 6 MB upload is REJECTED (above the 5 MB cap)', async () => {
    const storage = env.authenticatedContext(UID.memberA).storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    await assertFails(
      uploadBytes(
        ref(storage, proofPath(FAMILY_A, CHORE.aAssigned)),
        mkBlob({ size: 6 * 1024 * 1024 }),
        { contentType: 'image/jpeg' },
      ),
    );
  });
});

describe('storage.rules — DELETE (proof image cleanup)', () => {
  beforeEach(async () => {
    await stageProof(env, proofPath(FAMILY_A, CHORE.aAssigned));
  });

  it('PARENT in same family CAN delete a proof image', async () => {
    const storage = env.authenticatedContext(UID.parentA).storage();
    const { ref, deleteObject } = await import('firebase/storage');
    await assertSucceeds(deleteObject(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });

  it('the ASSIGNEE MEMBER CANNOT delete their own proof image (audit trail)', async () => {
    const storage = env.authenticatedContext(UID.memberA).storage();
    const { ref, deleteObject } = await import('firebase/storage');
    await assertFails(deleteObject(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });

  it('cross-tenant: parent of B CANNOT delete a family-A proof', async () => {
    const storage = env.authenticatedContext(UID.parentB).storage();
    const { ref, deleteObject } = await import('firebase/storage');
    await assertFails(deleteObject(ref(storage, proofPath(FAMILY_A, CHORE.aAssigned))));
  });
});

describe('storage.rules — default-deny catch-all', () => {
  it('a write to a path OUTSIDE the families/<f>/chores/<c>/ shape is denied (default deny)', async () => {
    const storage = env.authenticatedContext(UID.parentA).storage();
    const { ref, uploadBytes } = await import('firebase/storage');
    // No `families/` prefix → not matched by the main block →
    // catch-all match /{allPaths=**} `allow read, write: if false`.
    await assertFails(uploadBytes(ref(storage, 'random/path.jpg'), mkBlob()));
  });
});
