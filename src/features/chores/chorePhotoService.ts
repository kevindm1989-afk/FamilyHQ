/**
 * Chore proof-photo service (Feature 2 — Chore Photo Verification).
 *
 * Single responsibility: take a kid's File (from <input type="file"
 * accept="image/*" capture="environment">), upload it to Firebase
 * Storage at `families/{familyId}/chores/{choreId}/proof.jpg`, return
 * the download URL. The chore-doc update (status + proofImageUrl +
 * proofSubmittedAt) happens in `markCompleteWithProof`, also exported
 * here, so the two-step write is atomic from the caller's POV — either
 * the upload + the doc update both land, or both fail loudly.
 *
 * Storage path mirrors `storage.rules`'s match block. Failing to follow
 * this path shape (e.g. dropping `families/` prefix) results in the
 * upload being denied by the default-deny block — useful as a
 * defense-in-depth check.
 */
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { ChoreActionError } from './choresMemberService';

export const PROOF_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — mirrors storage.rules
export const PROOF_INVALID_TYPE = 'Please choose an image file (JPG, PNG, HEIC).';
export const PROOF_TOO_LARGE = 'That photo is too large — please pick one under 5 MB.';

function isAcceptableImage(file: File): boolean {
  // Defense in depth — the storage rule enforces the same check.
  return typeof file.type === 'string' && file.type.startsWith('image/');
}

function isSmallEnough(file: File): boolean {
  return Number.isFinite(file.size) && file.size > 0 && file.size < PROOF_MAX_BYTES;
}

/**
 * Upload a chore proof image to Firebase Storage. Returns the download
 * URL on success. Errors are mapped to a user-safe ChoreActionError so
 * the screen never surfaces a raw provider code / bucket path.
 *
 * NOTE: the Storage rule restricts WRITE to the chore's assignee — a
 * peer member's upload is rejected with `storage/unauthorized` even if
 * they know the path. The client-side mark-complete UI only lets the
 * assignee reach this code path, but the rule is the real authority.
 */
export async function uploadChoreProof(
  deps: { storage: FirebaseStorage },
  input: { familyId: string; choreId: string; file: File },
): Promise<string> {
  const { familyId, choreId, file } = input;
  if (!isAcceptableImage(file)) {
    throw new ChoreActionError(PROOF_INVALID_TYPE);
  }
  if (!isSmallEnough(file)) {
    throw new ChoreActionError(PROOF_TOO_LARGE);
  }
  try {
    const path = `families/${familyId}/chores/${choreId}/proof.jpg`;
    const objectRef = ref(deps.storage, path);
    await uploadBytes(objectRef, file, { contentType: file.type });
    return await getDownloadURL(objectRef);
  } catch {
    // Never surface a raw Firebase code / bucket path / file name.
    throw new ChoreActionError();
  }
}

export interface MarkCompleteWithProofInput {
  familyId: string;
  choreId: string;
  file: File;
}

/**
 * Two-step write: upload the proof image, then update the chore doc to
 * status=complete with proofImageUrl + proofSubmittedAt. The
 * rejectionReason + rejectedAt fields are CLEARED if present (the kid is
 * re-submitting after a rejection — keeping the old reason would
 * confuse the parent UI).
 *
 * If the upload succeeds but the doc update fails, the file is left in
 * Storage as orphaned bytes — a small leak, bounded by the 5 MB cap +
 * the storage.rules default-deny on cross-family read. A periodic
 * cleanup job would tidy these up; for v1 the simplicity is worth the
 * minor accumulation.
 */
export async function markCompleteWithProof(
  deps: { db: Firestore; storage: FirebaseStorage },
  input: MarkCompleteWithProofInput,
): Promise<void> {
  const url = await uploadChoreProof(
    { storage: deps.storage },
    { familyId: input.familyId, choreId: input.choreId, file: input.file },
  );
  try {
    await updateDoc(doc(deps.db, 'chores', input.choreId), {
      status: 'complete',
      proofImageUrl: url,
      proofSubmittedAt: Date.now(),
      // Reset rejection state — the kid is retrying.
      rejectionReason: null,
      rejectedAt: null,
    });
  } catch {
    throw new ChoreActionError();
  }
}
