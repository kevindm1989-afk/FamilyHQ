/**
 * Checklists service — Task Management feature (PR C).
 *
 * Thin client-side wrapper over `checklistTemplates` + `checklistInstances`.
 * Authority is enforced by firestore.rules (see
 * `test/rules/checklists.test.ts`):
 *
 *   - Templates: ANY active same-family caller creates; creator OR
 *     same-family parent updates / deletes (per Q-A — stricter than
 *     the literal spec to prevent sibling-pranks).
 *
 *   - Instances: ANY active same-family caller creates with
 *     `userId=self` (parents don't impersonate); UPDATE is owner-only;
 *     DELETE is owner OR same-family parent.
 *
 * This module validates input shape + trims strings + maps any
 * Firestore failure to a PII-free, user-safe error so the UI never
 * surfaces a raw Firebase code.
 *
 * Item ids: every `ChecklistTemplateItem.id` is a stable UUID-ish
 * string generated at edit time. Stability is required because a
 * running `ChecklistInstance.itemsProgress` map is keyed by that id —
 * renaming / reordering items must NOT lose check state.
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
import { checklistInstanceConverter, checklistTemplateConverter } from '../../lib/converters';
import type { ChecklistInstance, ChecklistTemplate, ChecklistTemplateItem } from '../../lib/types';

const TEMPLATES_COLLECTION = 'checklistTemplates';
const INSTANCES_COLLECTION = 'checklistInstances';

export const CHECKLIST_TITLE_MAX = 200;
export const CHECKLIST_ITEM_MAX = 200;
export const CHECKLIST_MAX_ITEMS = 50;

export const CHECKLIST_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const CHECKLIST_TITLE_EMPTY = 'Please enter a title for the routine.';
export const CHECKLIST_TITLE_TOO_LONG = `Keep the title under ${CHECKLIST_TITLE_MAX} characters.`;
export const CHECKLIST_ITEMS_EMPTY = 'Add at least one item to the routine.';
export const CHECKLIST_ITEM_EMPTY = 'Each item needs some text.';
export const CHECKLIST_ITEM_TOO_LONG = `Keep each item under ${CHECKLIST_ITEM_MAX} characters.`;
export const CHECKLIST_TOO_MANY_ITEMS = `Routines can have at most ${CHECKLIST_MAX_ITEMS} items.`;

export class ChecklistActionError extends Error {
  constructor(message: string = CHECKLIST_GENERIC_ERROR) {
    super(message);
    this.name = 'ChecklistActionError';
  }
}

export interface ChecklistTemplateWithId extends ChecklistTemplate {
  id: string;
}

export interface ChecklistInstanceWithId extends ChecklistInstance {
  id: string;
}

/**
 * Generate a stable id for a new item. Uses `crypto.randomUUID()` when
 * the browser supports it (all evergreen browsers do); falls back to a
 * timestamp+random string otherwise (e.g. in older jsdom test envs).
 */
export function newItemId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface RawTemplateItem {
  id?: string;
  text: string;
}

/**
 * Normalise a list of raw user-edited items into validated, id-stable
 * `ChecklistTemplateItem`s. Trims text, drops empty items, throws if any
 * non-empty item is over the per-item max or if the total is over
 * `CHECKLIST_MAX_ITEMS`. Items without an `id` get a freshly generated one
 * so a brand-new row inherits a stable identity for the instance map.
 */
export function normaliseItems(raw: RawTemplateItem[]): ChecklistTemplateItem[] {
  const out: ChecklistTemplateItem[] = [];
  for (const item of raw) {
    const text = item.text.trim();
    if (text.length === 0) continue;
    if (text.length > CHECKLIST_ITEM_MAX) {
      throw new ChecklistActionError(CHECKLIST_ITEM_TOO_LONG);
    }
    out.push({ id: item.id ?? newItemId(), text });
  }
  if (out.length === 0) {
    throw new ChecklistActionError(CHECKLIST_ITEMS_EMPTY);
  }
  if (out.length > CHECKLIST_MAX_ITEMS) {
    throw new ChecklistActionError(CHECKLIST_TOO_MANY_ITEMS);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface CreateTemplateInput {
  familyId: string;
  createdBy: string;
  title: string;
  isSharedWithFamily: boolean;
  items: RawTemplateItem[];
}

export async function createTemplate(
  deps: { db: Firestore },
  input: CreateTemplateInput,
): Promise<string> {
  const title = input.title.trim();
  if (title.length === 0) throw new ChecklistActionError(CHECKLIST_TITLE_EMPTY);
  if (title.length > CHECKLIST_TITLE_MAX) throw new ChecklistActionError(CHECKLIST_TITLE_TOO_LONG);
  const items = normaliseItems(input.items);

  const body = {
    familyId: input.familyId,
    createdBy: input.createdBy,
    title,
    isSharedWithFamily: input.isSharedWithFamily,
    items,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    const ref = await addDoc(
      collection(deps.db, TEMPLATES_COLLECTION).withConverter(checklistTemplateConverter),
      body as unknown as ChecklistTemplate,
    );
    return ref.id;
  } catch {
    throw new ChecklistActionError();
  }
}

export interface UpdateTemplateInput {
  title?: string;
  isSharedWithFamily?: boolean;
  items?: RawTemplateItem[];
}

/**
 * Edit a template. Title (when present) is trimmed + bounded. Items
 * (when present) are normalised through `normaliseItems` — empty rows
 * are dropped, new rows get a fresh id, EXISTING rows keep their id so
 * the instance map survives.
 */
export async function updateTemplate(
  deps: { db: Firestore },
  templateId: string,
  input: UpdateTemplateInput,
): Promise<void> {
  const patch: { [k: string]: unknown } = { updatedAt: serverTimestamp() };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length === 0) throw new ChecklistActionError(CHECKLIST_TITLE_EMPTY);
    if (title.length > CHECKLIST_TITLE_MAX)
      throw new ChecklistActionError(CHECKLIST_TITLE_TOO_LONG);
    patch.title = title;
  }
  if (input.isSharedWithFamily !== undefined) {
    patch.isSharedWithFamily = input.isSharedWithFamily;
  }
  if (input.items !== undefined) {
    patch.items = normaliseItems(input.items);
  }
  try {
    await updateDoc(
      doc(deps.db, TEMPLATES_COLLECTION, templateId),
      patch as unknown as { [k: string]: string | number | boolean | unknown[] },
    );
  } catch {
    throw new ChecklistActionError();
  }
}

export async function deleteTemplate(deps: { db: Firestore }, templateId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, TEMPLATES_COLLECTION, templateId));
  } catch {
    throw new ChecklistActionError();
  }
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

export interface StartInstanceInput {
  familyId: string;
  templateId: string;
  userId: string;
  /** ISO YYYY-MM-DD — the day this run is "for". */
  date: string;
}

/**
 * Start a new run of a template for the caller. `userId` MUST be the
 * caller's own uid (firestore.rules denies a foreign userId — "parents
 * don't impersonate"); the route always passes `currentUser.id`.
 */
export async function startInstance(
  deps: { db: Firestore },
  input: StartInstanceInput,
): Promise<string> {
  const body = {
    familyId: input.familyId,
    templateId: input.templateId,
    userId: input.userId,
    date: input.date,
    isCompleted: false,
    itemsProgress: {},
    createdAt: serverTimestamp(),
  };
  try {
    const ref = await addDoc(
      collection(deps.db, INSTANCES_COLLECTION).withConverter(checklistInstanceConverter),
      body as unknown as ChecklistInstance,
    );
    return ref.id;
  } catch {
    throw new ChecklistActionError();
  }
}

/**
 * Toggle a single item's checked state inside a running instance.
 * Writes the dot-path `itemsProgress.{itemId}` so the merge stays
 * minimal (we don't round-trip the whole map). Absent key reads as
 * unchecked — no need to seed every item to false at create time.
 */
export async function setInstanceItemProgress(
  deps: { db: Firestore },
  instanceId: string,
  itemId: string,
  checked: boolean,
): Promise<void> {
  try {
    await updateDoc(doc(deps.db, INSTANCES_COLLECTION, instanceId), {
      [`itemsProgress.${itemId}`]: checked,
    });
  } catch {
    throw new ChecklistActionError();
  }
}

/**
 * Flip `isCompleted`. Paired with `completedAt` (set on complete,
 * cleared on re-open) so the UI can sort "recently completed" runs.
 */
export async function setInstanceCompletion(
  deps: { db: Firestore },
  instanceId: string,
  isCompleted: boolean,
): Promise<void> {
  try {
    await updateDoc(doc(deps.db, INSTANCES_COLLECTION, instanceId), {
      isCompleted,
      ...(isCompleted ? { completedAt: Date.now() } : { completedAt: deleteField() }),
    } as unknown as { [k: string]: number | boolean });
  } catch {
    throw new ChecklistActionError();
  }
}

export async function deleteInstance(deps: { db: Firestore }, instanceId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, INSTANCES_COLLECTION, instanceId));
  } catch {
    throw new ChecklistActionError();
  }
}

/**
 * Pure selector — count of items in the template that are NOT yet
 * checked in this instance. Drives the "3 of 5 done" line on a row.
 */
export function instanceProgress(
  template: ChecklistTemplate | null,
  instance: ChecklistInstance,
): { checked: number; total: number } {
  const items = template?.items ?? [];
  let checked = 0;
  for (const item of items) {
    if (instance.itemsProgress[item.id] === true) checked += 1;
  }
  return { checked, total: items.length };
}
