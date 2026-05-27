/**
 * CONTRACT STUB — Bulletin Board service (Phase 3, Task 9; ADR-0001/0002).
 *
 * Signatures only, no logic. Authored by the test-writer to PIN the shape the
 * implementer must fulfill; the colocated *.test.ts files import these. The
 * implementer writes the bodies — they must NOT change these signatures, field
 * names, or the error type without updating the tests + the threat model.
 *
 * Authority (who may create/delete a post) is enforced SERVER-SIDE in
 * firestore.rules and proven by test/rules/posts.test.ts. This service is the
 * well-behaved client: it shapes the payload, derives UI-level permission
 * affordances, and maps raw errors to user-safe, PII-free toast copy
 * (constraints "No PII in error messages"; threat-model T1.8/M8).
 *
 * DATA-MODEL NOTE (do not "fix" by inventing a field): the `Post` schema has NO
 * read/unread field. This service neither reads nor writes read-state. The
 * Dashboard "Unread Posts" count is a separate, later decision and must NOT be
 * implemented as a per-post boolean here.
 */
import type { Firestore } from 'firebase/firestore';
import type { Post, Role } from '../../lib/types';

/** A post enriched with its document id for list rendering + delete. */
export interface PostWithId extends Post {
  id: string;
}

/** A generic, user-safe error — never leaks a raw Firebase code or PII. */
export declare class BoardActionError extends Error {}

/** User-safe copy the service surfaces; asserted by the tests. */
export declare const POST_CREATE_SUCCESS: string;
export declare const POST_DELETE_SUCCESS: string;
export declare const POST_GENERIC_ERROR: string;

/**
 * Input to create a post. The service fills `authorId`, `authorName`,
 * `familyId`, and `createdAt` from the supplied identity — the caller passes
 * only the content + identity, never a forged familyId/authorId.
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
 */
export declare function createPost(
  deps: { db: Firestore },
  input: CreatePostInput,
): Promise<void>;

/**
 * Delete a `posts` doc by id. UI offers this only where permitted (see
 * `canDeletePost`); the rule is the real boundary. Maps failures to
 * POST_GENERIC_ERROR.
 */
export declare function deletePost(
  deps: { db: Firestore },
  postId: string,
): Promise<void>;

/**
 * Pure UI-permission derivation (mirrors the firestore.rules posts delete rule
 * the implementer must write): a PARENT may delete ANY post in their family; a
 * MEMBER may delete ONLY their own post (`authorId === viewerUid`). This is a
 * cosmetic affordance — the server rule is authoritative.
 */
export declare function canDeletePost(
  viewer: { uid: string; role: Role },
  post: Pick<Post, 'authorId'>,
): boolean;

/**
 * Pure derivation of an author's CURRENT role from the live family member list
 * (the `Post` doc stores only `authorName`, never a role — so role MUST be
 * derived from the members list, never read off the post). Returns 'member'
 * when the author is no longer an active member (no crown for a non-member).
 */
export declare function authorRole(
  members: ReadonlyArray<{ id: string; role: Role }>,
  authorId: string,
): Role;
