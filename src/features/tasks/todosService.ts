/**
 * Todos service — Task Management feature (PR B).
 *
 * Thin client-side wrapper over the `todos` collection. Authority: ANY active
 * same-family caller has full CRUD (firestore.rules is authoritative — see
 * `test/rules/todos.test.ts`). This module validates input shape + trims
 * strings + maps any Firestore failure to a PII-free, user-safe `Error`, so
 * the UI never surfaces raw Firebase codes.
 *
 * `createdAt` is written as `serverTimestamp()` on create so the server
 * timeline is the source of truth (consistent with the rest of the app —
 * see chores/posts/savings). The hook's `toMillis` normalises it back to
 * epoch ms for the UI.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { todoConverter } from '../../lib/converters';
import type { Todo } from '../../lib/types';

/**
 * Fire-and-forget invocation of a server-side todo notification callable
 * (PR D6 + D7). Push is non-essential (ADR-0014); a callable failure or
 * missing Functions runtime must NEVER undo the transactional write. Both
 * a sync throw at `httpsCallable(...)` lookup AND an async rejection from
 * the invocation are swallowed.
 */
async function fireAndForgetTodoNotify(
  name: 'notifyTodoCreated' | 'notifyTodoCompleted',
  todoId: string,
): Promise<void> {
  try {
    const fns = getFunctions();
    const fn = httpsCallable<
      { todoId: string },
      { sent: number; cleaned?: number; reason?: string }
    >(fns, name);
    await fn({ todoId });
  } catch {
    // Intentionally swallowed.
  }
}

const TODOS_COLLECTION = 'todos';

export const TODO_TITLE_MAX = 200;
export const TODO_DESCRIPTION_MAX = 2000;

export const TODO_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const TODO_TITLE_EMPTY = 'Please enter a title for your to-do.';
export const TODO_TITLE_TOO_LONG = `Keep the title under ${TODO_TITLE_MAX} characters.`;
export const TODO_DESCRIPTION_TOO_LONG = `Keep the description under ${TODO_DESCRIPTION_MAX} characters.`;
export const TODO_DUE_DATE_INVALID = 'Please pick a valid due date.';

export class TodoActionError extends Error {
  constructor(message: string = TODO_GENERIC_ERROR) {
    super(message);
    this.name = 'TodoActionError';
  }
}

/** A `Todo` doc enriched with its id, for UI lists. `createdAt` is epoch ms. */
export interface TodoWithId extends Todo {
  id: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True when `s` is an ISO `YYYY-MM-DD` AND a real calendar date. */
export function isValidISODate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const parts = s.split('-').map((n) => Number.parseInt(n, 10));
  if (parts.length !== 3) return false;
  const [y, m, d] = parts as [number, number, number];
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Reject impossible day-of-month (Feb 30, Apr 31, etc.) by round-tripping.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export interface CreateTodoInput {
  familyId: string;
  createdBy: string;
  title: string;
  description?: string;
  assignedTo?: string;
  dueDate?: string;
}

/**
 * Create a Todo. Trims title/description; rejects an empty title BEFORE any
 * write. `isCompleted` is fixed to false at create — the rule denies a
 * create with `isCompleted: true`.
 */
export async function createTodo(deps: { db: Firestore }, input: CreateTodoInput): Promise<string> {
  const title = input.title.trim();
  if (title.length === 0) {
    throw new TodoActionError(TODO_TITLE_EMPTY);
  }
  if (title.length > TODO_TITLE_MAX) {
    throw new TodoActionError(TODO_TITLE_TOO_LONG);
  }
  let description: string | undefined;
  if (typeof input.description === 'string') {
    const trimmed = input.description.trim();
    if (trimmed.length > TODO_DESCRIPTION_MAX) {
      throw new TodoActionError(TODO_DESCRIPTION_TOO_LONG);
    }
    if (trimmed.length > 0) description = trimmed;
  }
  if (input.dueDate !== undefined && input.dueDate !== '' && !isValidISODate(input.dueDate)) {
    throw new TodoActionError(TODO_DUE_DATE_INVALID);
  }

  // Build the body explicitly so the converter writes EXACTLY the keys the
  // create rule allows. exactOptionalPropertyTypes: include optional keys
  // ONLY when a value exists — never write `key: undefined` (invalid
  // Firestore input).
  const body = {
    familyId: input.familyId,
    createdBy: input.createdBy,
    title,
    isCompleted: false,
    createdAt: serverTimestamp(),
    ...(description !== undefined ? { description } : {}),
    ...(input.assignedTo !== undefined && input.assignedTo !== ''
      ? { assignedTo: input.assignedTo }
      : {}),
    ...(input.dueDate !== undefined && input.dueDate !== '' ? { dueDate: input.dueDate } : {}),
  };

  let todoId: string;
  try {
    const ref = await addDoc(
      collection(deps.db, TODOS_COLLECTION).withConverter(todoConverter),
      // The converter's strict generic types are stricter than the body's
      // mixed Timestamp/string/number shape (serverTimestamp returns a
      // FieldValue at write time). Cast at the boundary; runtime payload
      // is unchanged.
      body as unknown as Todo,
    );
    todoId = ref.id;
  } catch {
    throw new TodoActionError();
  }
  await fireAndForgetTodoNotify('notifyTodoCreated', todoId);
  return todoId;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string | null;
  assignedTo?: string | null;
  /** `null` clears the field (moves the Todo back to "Someday"). */
  dueDate?: string | null;
}

/**
 * Edit a Todo's mutable fields. Title, when present, is trimmed and
 * non-empty (the rule enforces this server-side; we mirror it for cleaner
 * error toasts). Passing `null` for an optional field clears it.
 */
export async function updateTodo(
  deps: { db: Firestore },
  todoId: string,
  input: UpdateTodoInput,
): Promise<void> {
  const patch: { [k: string]: unknown } = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length === 0) throw new TodoActionError(TODO_TITLE_EMPTY);
    if (title.length > TODO_TITLE_MAX) throw new TodoActionError(TODO_TITLE_TOO_LONG);
    patch.title = title;
  }
  if (input.description === null) {
    patch.description = deleteField();
  } else if (typeof input.description === 'string') {
    const trimmed = input.description.trim();
    if (trimmed.length > TODO_DESCRIPTION_MAX) {
      throw new TodoActionError(TODO_DESCRIPTION_TOO_LONG);
    }
    if (trimmed.length === 0) {
      patch.description = deleteField();
    } else {
      patch.description = trimmed;
    }
  }
  if (input.assignedTo === null || input.assignedTo === '') {
    patch.assignedTo = deleteField();
  } else if (typeof input.assignedTo === 'string') {
    patch.assignedTo = input.assignedTo;
  }
  if (input.dueDate === null || input.dueDate === '') {
    patch.dueDate = deleteField();
  } else if (typeof input.dueDate === 'string') {
    if (!isValidISODate(input.dueDate)) {
      throw new TodoActionError(TODO_DUE_DATE_INVALID);
    }
    patch.dueDate = input.dueDate;
  }
  if (Object.keys(patch).length === 0) return; // nothing to write
  try {
    await updateDoc(
      doc(deps.db, TODOS_COLLECTION, todoId),
      patch as unknown as { [k: string]: string | number | null },
    );
  } catch {
    throw new TodoActionError();
  }
}

/**
 * Flip `isCompleted`. Paired with `completedAt` (set on complete, cleared
 * on un-complete) so the UI can show "completed N minutes ago" without a
 * separate listener.
 */
export async function setTodoCompletion(
  deps: { db: Firestore },
  todoId: string,
  isCompleted: boolean,
): Promise<void> {
  try {
    await updateDoc(doc(deps.db, TODOS_COLLECTION, todoId), {
      isCompleted,
      ...(isCompleted ? { completedAt: Date.now() } : { completedAt: deleteField() }),
    } as unknown as { [k: string]: number | boolean });
  } catch {
    throw new TodoActionError();
  }
  // Fire the completion push only on the true → false unwind is a noop;
  // the kid un-completing their own todo shouldn't ping anyone.
  if (isCompleted) {
    await fireAndForgetTodoNotify('notifyTodoCompleted', todoId);
  }
}

/**
 * Hard-delete the Todo. Any active same-family caller may delete (no soft
 * archive — Todos are ephemeral by design).
 */
export async function deleteTodo(deps: { db: Firestore }, todoId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, TODOS_COLLECTION, todoId));
  } catch {
    throw new TodoActionError();
  }
}
