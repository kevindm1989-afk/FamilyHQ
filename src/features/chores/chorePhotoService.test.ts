/**
 * chorePhotoService — unit contract (Feature 2).
 *
 * Pins:
 *   - uploadChoreProof rejects non-image MIME types BEFORE touching
 *     Storage (defense in depth — storage.rules also rejects).
 *   - uploadChoreProof rejects files at or above PROOF_MAX_BYTES.
 *   - Happy path writes to `families/{familyId}/chores/{choreId}/proof.jpg`
 *     with the file's contentType, then returns the download URL.
 *   - Firestore / Storage failures are mapped to a user-safe
 *     ChoreActionError (never the raw provider code / bucket path).
 *   - markCompleteWithProof uploads the file then patches the chore
 *     doc with status=complete + proofImageUrl + proofSubmittedAt, AND
 *     clears `rejectionReason` + `rejectedAt` (kid resubmitting).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadBytesMock = vi.fn();
const getDownloadURLMock = vi.fn();
const refMock = vi.fn();
const updateDocMock = vi.fn();
const docMock = vi.fn();

vi.mock('firebase/storage', () => ({
  ref: (...a: unknown[]) => refMock(...a),
  uploadBytes: (...a: unknown[]) => uploadBytesMock(...a),
  getDownloadURL: (...a: unknown[]) => getDownloadURLMock(...a),
}));
vi.mock('firebase/firestore', () => ({
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  doc: (...a: unknown[]) => docMock(...a),
}));

import {
  markCompleteWithProof,
  PROOF_INVALID_TYPE,
  PROOF_MAX_BYTES,
  PROOF_TOO_LARGE,
  uploadChoreProof,
} from './chorePhotoService';
import { ChoreActionError } from './choresMemberService';

const db = { __db: true } as never;
const storage = { __storage: true } as never;

function mkFile(opts: { type?: string; size?: number; name?: string } = {}): File {
  // jsdom's File / Blob constructors accept the standard Web API surface.
  const type = opts.type ?? 'image/jpeg';
  const size = opts.size ?? 1024;
  const name = opts.name ?? 'proof.jpg';
  // Synthesize a Blob of the desired size — jsdom honors the byte length.
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

beforeEach(() => {
  uploadBytesMock.mockReset();
  getDownloadURLMock.mockReset();
  refMock.mockReset().mockImplementation((_storage, path) => ({ __ref: path }));
  updateDocMock.mockReset();
  docMock.mockReset().mockImplementation((_db, coll, id) => ({ __doc: `${coll}/${id}` }));
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('uploadChoreProof — validation', () => {
  it('rejects a non-image MIME type BEFORE calling Storage', async () => {
    const file = mkFile({ type: 'application/pdf' });
    await expect(
      uploadChoreProof({ storage }, { familyId: 'fam-A', choreId: 'c-1', file }),
    ).rejects.toMatchObject({
      name: 'ChoreActionError',
      message: PROOF_INVALID_TYPE,
    });
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('rejects a file at or above PROOF_MAX_BYTES', async () => {
    const file = mkFile({ size: PROOF_MAX_BYTES });
    await expect(
      uploadChoreProof({ storage }, { familyId: 'fam-A', choreId: 'c-1', file }),
    ).rejects.toMatchObject({
      message: PROOF_TOO_LARGE,
    });
    expect(uploadBytesMock).not.toHaveBeenCalled();
  });

  it('rejects a zero-byte file', async () => {
    const file = mkFile({ size: 0 });
    await expect(
      uploadChoreProof({ storage }, { familyId: 'fam-A', choreId: 'c-1', file }),
    ).rejects.toMatchObject({ message: PROOF_TOO_LARGE });
  });
});

describe('uploadChoreProof — happy path', () => {
  it('uploads to families/<fid>/chores/<cid>/proof.jpg with the file contentType and returns the download URL', async () => {
    uploadBytesMock.mockResolvedValue(undefined);
    getDownloadURLMock.mockResolvedValue('https://example.com/proof.jpg');
    const file = mkFile({ type: 'image/png', size: 4096 });
    const url = await uploadChoreProof(
      { storage },
      { familyId: 'fam-A', choreId: 'c-1', file },
    );
    expect(refMock).toHaveBeenCalledWith(storage, 'families/fam-A/chores/c-1/proof.jpg');
    expect(uploadBytesMock).toHaveBeenCalledTimes(1);
    const [, uploadedFile, opts] = uploadBytesMock.mock.calls[0]!;
    expect(uploadedFile).toBe(file);
    expect((opts as { contentType: string }).contentType).toBe('image/png');
    expect(url).toBe('https://example.com/proof.jpg');
  });

  it('wraps a Storage failure in a user-safe ChoreActionError (no raw provider text)', async () => {
    uploadBytesMock.mockRejectedValue(new Error('storage/unauthorized: long path'));
    const file = mkFile();
    await expect(
      uploadChoreProof({ storage }, { familyId: 'fam-A', choreId: 'c-1', file }),
    ).rejects.toBeInstanceOf(ChoreActionError);
  });
});

describe('markCompleteWithProof', () => {
  it('uploads the file then patches the chore doc with status, proof url + timestamp, and CLEARS rejection state', async () => {
    uploadBytesMock.mockResolvedValue(undefined);
    getDownloadURLMock.mockResolvedValue('https://example.com/proof.jpg');
    updateDocMock.mockResolvedValue(undefined);
    const file = mkFile();
    await markCompleteWithProof(
      { db, storage },
      { familyId: 'fam-A', choreId: 'c-1', file },
    );
    // Doc path is correct.
    expect(docMock).toHaveBeenCalledWith(db, 'chores', 'c-1');
    // Patch shape locks in the contract: status flip + proof attachment +
    // rejection state reset. A drift here breaks the rule's reset-on-retry
    // assumption.
    const patch = updateDocMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(patch.status).toBe('complete');
    expect(patch.proofImageUrl).toBe('https://example.com/proof.jpg');
    expect(typeof patch.proofSubmittedAt).toBe('number');
    expect(patch.rejectionReason).toBeNull();
    expect(patch.rejectedAt).toBeNull();
  });

  it('does NOT write the chore doc when the upload fails (no partial state)', async () => {
    uploadBytesMock.mockRejectedValue(new Error('storage/unauthorized'));
    const file = mkFile();
    await expect(
      markCompleteWithProof({ db, storage }, { familyId: 'fam-A', choreId: 'c-1', file }),
    ).rejects.toBeInstanceOf(ChoreActionError);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('wraps a Firestore write failure in a user-safe ChoreActionError', async () => {
    uploadBytesMock.mockResolvedValue(undefined);
    getDownloadURLMock.mockResolvedValue('https://example.com/proof.jpg');
    updateDocMock.mockRejectedValue(new Error('rules-denied: chores/c-1'));
    const file = mkFile();
    await expect(
      markCompleteWithProof({ db, storage }, { familyId: 'fam-A', choreId: 'c-1', file }),
    ).rejects.toBeInstanceOf(ChoreActionError);
  });
});
