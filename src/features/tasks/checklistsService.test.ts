/**
 * Unit contract for the checklists service (templates + instances).
 *
 * Mocks the Firestore SDK so we can pin the exact body shapes the
 * create rules accept (closed key set, no `undefined` leaks), the
 * dot-path `itemsProgress.{itemId}` patch on toggle, the
 * `deleteField()` clearing on re-open, validation before any write,
 * and clean Firestore-failure → ChecklistActionError mapping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addDocMock = vi.fn();
const updateDocMock = vi.fn();
const deleteDocMock = vi.fn();
const deleteFieldSentinel = { __sentinel: 'deleteField' };
const serverTimestampSentinel = { __sentinel: 'serverTimestamp' };

vi.mock('firebase/firestore', () => ({
  addDoc: (...args: unknown[]) => addDocMock(...args),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  collection: (_db: unknown, name: string) => ({
    __ref: `col:${name}`,
    withConverter: () => ({ __ref: `col:${name}` }),
  }),
  doc: (_db: unknown, name: string, id: string) => ({ __ref: `doc:${name}/${id}` }),
  deleteField: () => deleteFieldSentinel,
  serverTimestamp: () => serverTimestampSentinel,
}));

vi.mock('../../lib/converters', () => ({
  checklistTemplateConverter: { __converter: 'template' },
  checklistInstanceConverter: { __converter: 'instance' },
}));

import {
  CHECKLIST_ITEMS_EMPTY,
  CHECKLIST_TITLE_EMPTY,
  CHECKLIST_TOO_MANY_ITEMS,
  ChecklistActionError,
  createTemplate,
  deleteInstance,
  deleteTemplate,
  instanceProgress,
  newItemId,
  normaliseItems,
  setInstanceCompletion,
  setInstanceItemProgress,
  startInstance,
  updateTemplate,
} from './checklistsService';

const db = { __db: true } as unknown as import('firebase/firestore').Firestore;

beforeEach(() => {
  addDocMock.mockReset();
  updateDocMock.mockReset();
  deleteDocMock.mockReset();
  addDocMock.mockResolvedValue({ id: 'generated-id' });
  updateDocMock.mockResolvedValue(undefined);
  deleteDocMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// normaliseItems
// ---------------------------------------------------------------------------

describe('normaliseItems', () => {
  it('trims items, drops empties, and stamps new items with an id', () => {
    const out = normaliseItems([
      { text: '  Brush teeth ' },
      { text: '   ' },
      { id: 'kept', text: 'Make bed' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.text).toBe('Brush teeth');
    expect(typeof out[0]?.id).toBe('string');
    expect(out[0]?.id.length).toBeGreaterThan(0);
    expect(out[1]).toEqual({ id: 'kept', text: 'Make bed' });
  });

  it('throws when every item is empty (no items at all)', () => {
    expect(() => normaliseItems([{ text: '' }, { text: '   ' }])).toThrow(
      CHECKLIST_ITEMS_EMPTY,
    );
  });

  it('throws when the total exceeds CHECKLIST_MAX_ITEMS', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ text: `Item ${i}` }));
    expect(() => normaliseItems(many)).toThrow(CHECKLIST_TOO_MANY_ITEMS);
  });

  it('throws when any item is over the per-item max', () => {
    expect(() => normaliseItems([{ text: 'a'.repeat(201) }])).toThrow(ChecklistActionError);
  });
});

// ---------------------------------------------------------------------------
// newItemId
// ---------------------------------------------------------------------------

describe('newItemId', () => {
  it('returns a non-empty string', () => {
    expect(typeof newItemId()).toBe('string');
    expect(newItemId().length).toBeGreaterThan(0);
  });

  it('returns distinct ids on subsequent calls', () => {
    const a = newItemId();
    const b = newItemId();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// createTemplate
// ---------------------------------------------------------------------------

describe('createTemplate', () => {
  it('rejects an empty title without writing', async () => {
    await expect(
      createTemplate(
        { db },
        {
          familyId: 'fam-A',
          createdBy: 'uid-a',
          title: '   ',
          isSharedWithFamily: true,
          items: [{ text: 'x' }],
        },
      ),
    ).rejects.toMatchObject({ message: CHECKLIST_TITLE_EMPTY });
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('writes EXACTLY the keys the create rule allows', async () => {
    await createTemplate(
      { db },
      {
        familyId: 'fam-A',
        createdBy: 'uid-a',
        title: '  Morning routine  ',
        isSharedWithFamily: true,
        items: [{ id: 'i1', text: 'Brush' }, { text: '  Make bed  ' }],
      },
    );
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc was not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(body).toMatchObject({
      familyId: 'fam-A',
      createdBy: 'uid-a',
      title: 'Morning routine',
      isSharedWithFamily: true,
      createdAt: serverTimestampSentinel,
      updatedAt: serverTimestampSentinel,
    });
    const items = body.items as { id: string; text: string }[];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'i1', text: 'Brush' });
    expect(items[1]?.text).toBe('Make bed');
    expect(typeof items[1]?.id).toBe('string');
  });

  it('maps a Firestore failure to ChecklistActionError', async () => {
    addDocMock.mockRejectedValueOnce(new Error('FIRESTORE/permission-denied'));
    await expect(
      createTemplate(
        { db },
        {
          familyId: 'fam-A',
          createdBy: 'uid-a',
          title: 'x',
          isSharedWithFamily: true,
          items: [{ text: 'a' }],
        },
      ),
    ).rejects.toBeInstanceOf(ChecklistActionError);
  });
});

// ---------------------------------------------------------------------------
// updateTemplate
// ---------------------------------------------------------------------------

describe('updateTemplate', () => {
  it('writes only the changed fields + always bumps updatedAt', async () => {
    await updateTemplate({ db }, 'tpl-1', { title: '  Renamed  ' });
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const call = updateDocMock.mock.calls[0];
    if (call === undefined) throw new Error('updateDoc was not called');
    const [, patch] = call as [unknown, Record<string, unknown>];
    expect(patch).toEqual({ title: 'Renamed', updatedAt: serverTimestampSentinel });
  });

  it('rejects an empty-trimmed title without writing', async () => {
    await expect(
      updateTemplate({ db }, 'tpl-1', { title: '   ' }),
    ).rejects.toBeInstanceOf(ChecklistActionError);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('runs items through normaliseItems on update (drops empties, keeps ids)', async () => {
    await updateTemplate({ db }, 'tpl-1', {
      items: [{ id: 'a', text: 'Keep' }, { text: '   ' }, { text: 'Add' }],
    });
    const call = updateDocMock.mock.calls[0];
    if (call === undefined) throw new Error('updateDoc was not called');
    const [, patch] = call as [unknown, Record<string, unknown>];
    const items = patch.items as { id: string; text: string }[];
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'a', text: 'Keep' });
    expect(items[1]?.text).toBe('Add');
    expect(typeof items[1]?.id).toBe('string');
  });

  it('toggles isSharedWithFamily through to the patch', async () => {
    await updateTemplate({ db }, 'tpl-1', { isSharedWithFamily: false });
    const call = updateDocMock.mock.calls[0];
    if (call === undefined) throw new Error('updateDoc was not called');
    const [, patch] = call as [unknown, Record<string, unknown>];
    expect(patch.isSharedWithFamily).toBe(false);
  });

  it('maps a Firestore failure to ChecklistActionError', async () => {
    updateDocMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      updateTemplate({ db }, 'tpl-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(ChecklistActionError);
  });
});

// ---------------------------------------------------------------------------
// deleteTemplate / deleteInstance
// ---------------------------------------------------------------------------

describe('deleteTemplate', () => {
  it('calls deleteDoc on the matching ref', async () => {
    await deleteTemplate({ db }, 'tpl-1');
    expect(deleteDocMock).toHaveBeenCalledWith({ __ref: 'doc:checklistTemplates/tpl-1' });
  });
});

describe('deleteInstance', () => {
  it('calls deleteDoc on the matching ref', async () => {
    await deleteInstance({ db }, 'inst-1');
    expect(deleteDocMock).toHaveBeenCalledWith({ __ref: 'doc:checklistInstances/inst-1' });
  });
});

// ---------------------------------------------------------------------------
// startInstance
// ---------------------------------------------------------------------------

describe('startInstance', () => {
  it('writes the closed key set with userId bound to the caller, isCompleted=false, empty itemsProgress', async () => {
    await startInstance(
      { db },
      { familyId: 'fam-A', templateId: 'tpl-1', userId: 'uid-a', date: '2026-06-05' },
    );
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc was not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(body).toEqual({
      familyId: 'fam-A',
      templateId: 'tpl-1',
      userId: 'uid-a',
      date: '2026-06-05',
      isCompleted: false,
      itemsProgress: {},
      createdAt: serverTimestampSentinel,
    });
  });

  it('wraps a Firestore failure', async () => {
    addDocMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      startInstance(
        { db },
        { familyId: 'fam-A', templateId: 'tpl-1', userId: 'uid-a', date: '2026-06-05' },
      ),
    ).rejects.toBeInstanceOf(ChecklistActionError);
  });
});

// ---------------------------------------------------------------------------
// setInstanceItemProgress
// ---------------------------------------------------------------------------

describe('setInstanceItemProgress', () => {
  it('writes a dot-path itemsProgress.{itemId} = checked (does not round-trip the map)', async () => {
    await setInstanceItemProgress({ db }, 'inst-1', 'item-a', true);
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:checklistInstances/inst-1' },
      { 'itemsProgress.item-a': true },
    );
  });
});

// ---------------------------------------------------------------------------
// setInstanceCompletion
// ---------------------------------------------------------------------------

describe('setInstanceCompletion', () => {
  it('writes isCompleted=true paired with a completedAt timestamp on complete', async () => {
    await setInstanceCompletion({ db }, 'inst-1', true);
    const call = updateDocMock.mock.calls[0];
    if (call === undefined) throw new Error('updateDoc was not called');
    const [, patch] = call as [unknown, Record<string, unknown>];
    expect(patch.isCompleted).toBe(true);
    expect(typeof patch.completedAt).toBe('number');
  });

  it('clears completedAt with deleteField() on re-open', async () => {
    await setInstanceCompletion({ db }, 'inst-1', false);
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:checklistInstances/inst-1' },
      { isCompleted: false, completedAt: deleteFieldSentinel },
    );
  });
});

// ---------------------------------------------------------------------------
// instanceProgress (pure selector)
// ---------------------------------------------------------------------------

describe('instanceProgress', () => {
  it('counts items whose itemsProgress entry is true; ignores absent / false', () => {
    const template = {
      familyId: 'fam-A',
      createdBy: 'uid-a',
      title: 'x',
      isSharedWithFamily: true,
      items: [
        { id: 'i1', text: 'A' },
        { id: 'i2', text: 'B' },
        { id: 'i3', text: 'C' },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const instance = {
      familyId: 'fam-A',
      templateId: 'tpl',
      userId: 'uid-a',
      date: '2026-06-05',
      isCompleted: false,
      itemsProgress: { i1: true, i2: false },
      createdAt: 0,
    };
    expect(instanceProgress(template, instance)).toEqual({ checked: 1, total: 3 });
  });

  it('returns 0/0 when the template is null (e.g. template was deleted)', () => {
    const instance = {
      familyId: 'fam-A',
      templateId: 'gone',
      userId: 'uid-a',
      date: '2026-06-05',
      isCompleted: false,
      itemsProgress: { i1: true },
      createdAt: 0,
    };
    expect(instanceProgress(null, instance)).toEqual({ checked: 0, total: 0 });
  });
});
