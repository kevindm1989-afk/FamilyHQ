/**
 * Bulletin Board service — unit contract (Task 9; ADR-0001/0002, threat-model
 * T1.8/M8).
 *
 * Level: unit. Firestore is mocked at the SDK boundary so we assert the SERVICE
 * behavior (exact created-post shape, whitespace validation, delete-by-id,
 * PII-free error mapping, the pure permission/role derivations) without a live
 * emulator. Server-side authority is covered by test/rules/posts.test.ts.
 *
 * These FAIL today because boardService.ts is a declare-only contract stub.
 *
 * Isolation: clock frozen via vi.useFakeTimers; no network/RNG; every test
 * re-creates its mocks (no shared mutable state, order-independent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock the Firestore SDK surfaces the service depends on. ---
interface AddedDoc {
  collection: string;
  data: Record<string, unknown>;
}
interface DeletedRef {
  collection: string;
  id: string;
}
let added: AddedDoc[];
let deleted: DeletedRef[];
let addShouldReject: boolean;
let deleteShouldReject: boolean;

const collectionMock = vi.fn((_db: unknown, name: string) => ({ __collection: name }));
const docMock = vi.fn((_db: unknown, name: string, id: string) => ({
  __collection: name,
  __id: id,
}));
const addDocMock = vi.fn(async (ref: { __collection: string }, data: Record<string, unknown>) => {
  if (addShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
  added.push({ collection: ref.__collection, data });
  return { id: 'generated-id' };
});
const deleteDocMock = vi.fn(async (ref: { __collection: string; __id: string }) => {
  if (deleteShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
  deleted.push({ collection: ref.__collection, id: ref.__id });
});

vi.mock('firebase/firestore', () => ({
  collection: (...a: [unknown, string]) => collectionMock(...a),
  doc: (...a: [unknown, string, string]) => docMock(...a),
  addDoc: (...a: [{ __collection: string }, Record<string, unknown>]) => addDocMock(...a),
  deleteDoc: (...a: [{ __collection: string; __id: string }]) => deleteDocMock(...a),
  // Some implementations use withConverter — make it a harmless passthrough.
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));

// Imported AFTER mocks are registered.
import {
  BoardActionError,
  POST_CREATE_SUCCESS,
  POST_DELETE_SUCCESS,
  POST_GENERIC_ERROR,
  authorRole,
  canDeletePost,
  createPost,
  deletePost,
} from './boardService';

const db = {} as import('firebase/firestore').Firestore;
const FIXED_NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

beforeEach(() => {
  added = [];
  deleted = [];
  addShouldReject = false;
  deleteShouldReject = false;
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const validInput = {
  content: 'Pizza for dinner tonight!',
  authorId: 'uid-member-a',
  authorName: 'Member A',
  familyId: 'fam-A',
};

describe('createPost — happy path: writes exactly the Post shape', () => {
  it('writes to the posts collection', async () => {
    await createPost({ db }, validInput);
    expect(added).toHaveLength(1);
    expect(added[0]!.collection).toBe('posts');
  });

  it('persists exactly {content, authorId, authorName, familyId, createdAt} and NO read/unread field', async () => {
    await createPost({ db }, validInput);
    const data = added[0]!.data;
    expect(data).toMatchObject({
      content: 'Pizza for dinner tonight!',
      authorId: 'uid-member-a',
      authorName: 'Member A',
      familyId: 'fam-A',
    });
    expect(typeof data.createdAt === 'number' || typeof data.createdAt === 'object').toBe(true);
    // DATA-MODEL GAP: there is no read-state field on Post — assert none leaked in.
    expect(Object.keys(data).sort()).toEqual(
      ['authorId', 'authorName', 'content', 'createdAt', 'familyId'].sort(),
    );
    expect('read' in data).toBe(false);
    expect('isRead' in data).toBe(false);
    expect('readBy' in data).toBe(false);
  });
});

describe('createPost — validation (edge): empty / whitespace content rejected before any write', () => {
  it('rejects an empty string with a BoardActionError and writes nothing', async () => {
    await expect(createPost({ db }, { ...validInput, content: '' })).rejects.toBeInstanceOf(
      BoardActionError,
    );
    expect(added).toHaveLength(0);
  });

  it('rejects whitespace-only content (spaces/tabs/newlines) and writes nothing', async () => {
    await expect(
      createPost({ db }, { ...validInput, content: '   \t\n  ' }),
    ).rejects.toBeInstanceOf(BoardActionError);
    expect(added).toHaveLength(0);
  });

  it('trims surrounding whitespace from accepted content', async () => {
    await createPost({ db }, { ...validInput, content: '  hi family  ' });
    expect(added[0]!.data.content).toBe('hi family');
  });

  it('accepts unicode / emoji content', async () => {
    await createPost({ db }, { ...validInput, content: 'Movie night 🎬 — café' });
    expect(added[0]!.data.content).toBe('Movie night 🎬 — café');
  });
});

describe('createPost — error path (security/privacy): raw Firestore errors are never surfaced', () => {
  it('maps a Firestore failure to the generic PII-free message', async () => {
    addShouldReject = true;
    await expect(createPost({ db }, validInput)).rejects.toThrow(POST_GENERIC_ERROR);
  });

  it('the generic error copy contains no raw error text, no email, no content', async () => {
    addShouldReject = true;
    const err = await createPost({ db }, validInput).then(
      () => new Error('expected createPost to reject'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe(POST_GENERIC_ERROR);
    expect(err.message).not.toMatch(/emulated-firestore-failure/);
    expect(err.message).not.toContain(validInput.content);
    expect(err.message).not.toContain(validInput.authorName);
  });
});

describe('deletePost — happy + error path', () => {
  it('deletes the posts doc by id', async () => {
    await deletePost({ db }, 'post-123');
    expect(deleted).toEqual([{ collection: 'posts', id: 'post-123' }]);
  });

  it('maps a Firestore delete failure to the generic PII-free message', async () => {
    deleteShouldReject = true;
    await expect(deletePost({ db }, 'post-123')).rejects.toThrow(POST_GENERIC_ERROR);
  });
});

describe('canDeletePost — UI permission mirrors the rule (security)', () => {
  const parent = { uid: 'uid-parent', role: 'parent' as const };
  const member = { uid: 'uid-member', role: 'member' as const };

  it('a parent CAN delete another member’s post', () => {
    expect(canDeletePost(parent, { authorId: 'someone-else' })).toBe(true);
  });

  it('a parent CAN delete their own post', () => {
    expect(canDeletePost(parent, { authorId: 'uid-parent' })).toBe(true);
  });

  it('a member CAN delete their OWN post', () => {
    expect(canDeletePost(member, { authorId: 'uid-member' })).toBe(true);
  });

  it('a member CANNOT delete another member’s post', () => {
    expect(canDeletePost(member, { authorId: 'someone-else' })).toBe(false);
  });
});

describe('authorRole — derived from the live member list, NEVER from the post', () => {
  const members = [
    { id: 'uid-parent-a', role: 'parent' as const },
    { id: 'uid-member-a', role: 'member' as const },
  ];

  it('returns parent for a parent author', () => {
    expect(authorRole(members, 'uid-parent-a')).toBe('parent');
  });

  it('returns member for a member author', () => {
    expect(authorRole(members, 'uid-member-a')).toBe('member');
  });

  it('returns member (no crown) when the author is no longer in the active member list', () => {
    expect(authorRole(members, 'uid-departed')).toBe('member');
  });
});

describe('toast copy — success messages are defined for the toast-everything rule', () => {
  it('create + delete success copy are non-empty strings', () => {
    expect(typeof POST_CREATE_SUCCESS).toBe('string');
    expect(POST_CREATE_SUCCESS.length).toBeGreaterThan(0);
    expect(typeof POST_DELETE_SUCCESS).toBe('string');
    expect(POST_DELETE_SUCCESS.length).toBeGreaterThan(0);
  });
});
