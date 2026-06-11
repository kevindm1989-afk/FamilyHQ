/**
 * Bulletin Board service (Phase 3, Task 9; ADR-0001/0002).
 *
 * The well-behaved client: it shapes the `posts` payload, derives UI-level
 * permission affordances, and maps raw errors to user-safe, PII-free toast copy
 * (constraints "No PII in error messages"; threat-model T1.8/M8).
 *
 * Authority (who may create/delete a post) is enforced SERVER-SIDE in
 * firestore.rules and proven by test/rules/posts.test.ts. The pure derivations
 * here are cosmetic affordances; the server rule is authoritative.
 *
 * DATA-MODEL NOTE: the `Post` schema has NO read/unread field. This service
 * neither reads nor writes read-state.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { Post, Role } from '../../lib/types';

/** A post enriched with its document id for list rendering + delete. */
export interface PostWithId extends Post {
  id: string;
}

/** A generic, user-safe error — never leaks a raw Firebase code or PII. */
export class BoardActionError extends Error {
  constructor(message: string = POST_GENERIC_ERROR) {
    super(message);
    this.name = 'BoardActionError';
  }
}

/** User-safe copy the service surfaces; asserted by the tests. */
export const POST_CREATE_SUCCESS = 'Posted to the board.';
export const POST_DELETE_SUCCESS = 'Post deleted.';
export const POST_GENERIC_ERROR = 'Something went wrong. Please try again.';

const POSTS_COLLECTION = 'posts';

/**
 * Input to create a post. The service fills `createdAt` and writes exactly the
 * supplied identity — the caller passes only the content + its own identity,
 * never a forged familyId/authorId.
 */
export interface CreatePostInput {
  content: string;
  authorId: string;
  authorName: string;
  familyId: string;
}

/**
 * Create a `posts` doc shaped EXACTLY as
 * `{ content, authorId, authorName, familyId, createdAt }` (no read/unread
 * field). Trims surrounding whitespace; rejects empty/whitespace-only content
 * with a BoardActionError BEFORE any write. Maps any Firestore failure to
 * POST_GENERIC_ERROR (no raw error / PII surfaced).
 *
 * Returns the new doc id so PR D5's fire-and-forget `notifyBoardPost`
 * callable can address the server-side push by post id.
 */
export async function createPost(deps: { db: Firestore }, input: CreatePostInput): Promise<string> {
  const content = input.content.trim();
  if (content.length === 0) {
    // Reject before any write — empty/whitespace-only content is never stored.
    throw new BoardActionError();
  }

  let postId: string;
  try {
    const ref = await addDoc(collection(deps.db, POSTS_COLLECTION), {
      content,
      authorId: input.authorId,
      authorName: input.authorName,
      familyId: input.familyId,
      createdAt: serverTimestamp(),
    });
    postId = ref.id;
  } catch {
    // Never surface a raw Firebase code / PII to the caller.
    throw new BoardActionError();
  }
  // PR D5: fire-and-forget the notifyBoardPost callable AFTER the write.
  // The callable's failure must NEVER undo the post creation — push is
  // non-essential (ADR-0014); the in-app inbox is the source of truth.
  try {
    const fns = getFunctions();
    const fn = httpsCallable<
      { postId: string },
      { sent: number; cleaned?: number; reason?: string }
    >(fns, 'notifyBoardPost');
    await fn({ postId });
  } catch {
    // Intentionally swallowed.
  }
  return postId;
}

/**
 * Delete a `posts` doc by id. UI offers this only where permitted (see
 * `canDeletePost`); the rule is the real boundary. Maps failures to
 * POST_GENERIC_ERROR.
 */
export async function deletePost(deps: { db: Firestore }, postId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, POSTS_COLLECTION, postId));
  } catch {
    throw new BoardActionError();
  }
}

/**
 * Pure UI-permission derivation (mirrors the firestore.rules posts delete rule):
 * a PARENT may delete ANY post in their family; a MEMBER may delete ONLY their
 * own post (`authorId === viewerUid`). Cosmetic affordance — the server rule is
 * authoritative.
 */
export function canDeletePost(
  viewer: { uid: string; role: Role },
  post: Pick<Post, 'authorId'>,
): boolean {
  return viewer.role === 'parent' || post.authorId === viewer.uid;
}

/**
 * Pure derivation of an author's CURRENT role from the live family member list
 * (the `Post` doc stores only `authorName`, never a role — so role MUST be
 * derived from the members list, never read off the post). Returns 'member'
 * when the author is no longer an active member (no crown for a non-member).
 */
export function authorRole(
  members: ReadonlyArray<{ id: string; role: Role }>,
  authorId: string,
): Role {
  return members.find((m) => m.id === authorId)?.role ?? 'member';
}
