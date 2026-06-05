/**
 * Unit-level contract for the todos service.
 *
 * The Firestore SDK calls are mocked so we can pin:
 *   - validation BEFORE any write (empty title, oversized title, invalid
 *     dueDate),
 *   - the EXACT shape of the body we pass to addDoc (only the keys the
 *     create rule permits — no undefined leaks),
 *   - the field deletes on un-complete / un-assign / clear due,
 *   - error mapping (any thrown Firestore failure becomes a clean
 *     `TodoActionError`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const addDocMock = vi.fn();
const updateDocMock = vi.fn();
const deleteDocMock = vi.fn();
const deleteFieldSentinel = { __sentinel: 'deleteField' };
const serverTimestampSentinel = { __sentinel: 'serverTimestamp' };

// `collection()` is followed by `.withConverter()` on the create path, so the
// mock returns an object with that chainable method. `doc()` is used directly
// (no chain).
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
  todoConverter: { __converter: 'todo' },
}));

import {
  TODO_DUE_DATE_INVALID,
  TODO_TITLE_EMPTY,
  TodoActionError,
  createTodo,
  deleteTodo,
  isValidISODate,
  setTodoCompletion,
  updateTodo,
} from './todosService';

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
// isValidISODate
// ---------------------------------------------------------------------------

describe('isValidISODate', () => {
  it.each([
    ['2026-06-05', true],
    ['2026-12-31', true],
    ['2024-02-29', true], // leap day
    ['2026-13-01', false], // bad month
    ['2026-06-31', false], // June has 30
    ['2026-02-30', false], // bad day
    ['2026/06/05', false], // wrong separator
    ['06-05-2026', false], // wrong order
    ['', false],
  ])('isValidISODate(%j) === %s', (input, expected) => {
    expect(isValidISODate(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// createTodo
// ---------------------------------------------------------------------------

describe('createTodo — validation rejects BEFORE any write', () => {
  it('rejects an empty title without writing', async () => {
    await expect(
      createTodo({ db }, { familyId: 'fam-A', createdBy: 'uid-a', title: '   ' }),
    ).rejects.toMatchObject({ name: 'TodoActionError', message: TODO_TITLE_EMPTY });
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects a title over 200 chars without writing', async () => {
    await expect(
      createTodo(
        { db },
        { familyId: 'fam-A', createdBy: 'uid-a', title: 'a'.repeat(201) },
      ),
    ).rejects.toBeInstanceOf(TodoActionError);
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed dueDate without writing', async () => {
    await expect(
      createTodo(
        { db },
        { familyId: 'fam-A', createdBy: 'uid-a', title: 'Buy bread', dueDate: '2026/06/05' },
      ),
    ).rejects.toMatchObject({ message: TODO_DUE_DATE_INVALID });
    expect(addDocMock).not.toHaveBeenCalled();
  });
});

describe('createTodo — happy path body shape', () => {
  it('writes EXACTLY the keys the create rule allows (no undefined leaks)', async () => {
    await createTodo(
      { db },
      { familyId: 'fam-A', createdBy: 'uid-a', title: '  Pick up groceries  ' },
    );
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc was not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(body).toEqual({
      familyId: 'fam-A',
      createdBy: 'uid-a',
      title: 'Pick up groceries',
      isCompleted: false,
      createdAt: serverTimestampSentinel,
    });
  });

  it('includes assignedTo / dueDate / description when supplied', async () => {
    await createTodo(
      { db },
      {
        familyId: 'fam-A',
        createdBy: 'uid-a',
        title: 'Plan birthday',
        description: 'cake + balloons',
        assignedTo: 'uid-b',
        dueDate: '2026-06-10',
      },
    );
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc was not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect(body).toMatchObject({
      familyId: 'fam-A',
      createdBy: 'uid-a',
      title: 'Plan birthday',
      description: 'cake + balloons',
      assignedTo: 'uid-b',
      dueDate: '2026-06-10',
      isCompleted: false,
      createdAt: serverTimestampSentinel,
    });
  });

  it('returns the generated id', async () => {
    const id = await createTodo(
      { db },
      { familyId: 'fam-A', createdBy: 'uid-a', title: 'x' },
    );
    expect(id).toBe('generated-id');
  });

  it('wraps any Firestore failure in TodoActionError (no raw Firebase code leaked)', async () => {
    addDocMock.mockRejectedValueOnce(new Error('FIRESTORE/permission-denied'));
    await expect(
      createTodo({ db }, { familyId: 'fam-A', createdBy: 'uid-a', title: 'x' }),
    ).rejects.toBeInstanceOf(TodoActionError);
  });
});

// ---------------------------------------------------------------------------
// updateTodo
// ---------------------------------------------------------------------------

describe('updateTodo', () => {
  it('writes a trimmed, validated title patch', async () => {
    await updateTodo({ db }, 't-1', { title: '  Walk the dog  ' });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:todos/t-1' }, {
      title: 'Walk the dog',
    });
  });

  it('rejects an empty-trimmed title with TodoActionError, no write', async () => {
    await expect(updateTodo({ db }, 't-1', { title: '   ' })).rejects.toBeInstanceOf(
      TodoActionError,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('clears description with deleteField() when null is passed', async () => {
    await updateTodo({ db }, 't-1', { description: null });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:todos/t-1' }, {
      description: deleteFieldSentinel,
    });
  });

  it('clears assignedTo with deleteField() when null is passed', async () => {
    await updateTodo({ db }, 't-1', { assignedTo: null });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:todos/t-1' }, {
      assignedTo: deleteFieldSentinel,
    });
  });

  it('clears dueDate with deleteField() when null is passed (moves to "Someday")', async () => {
    await updateTodo({ db }, 't-1', { dueDate: null });
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:todos/t-1' }, {
      dueDate: deleteFieldSentinel,
    });
  });

  it('rejects an invalid dueDate string before writing', async () => {
    await expect(
      updateTodo({ db }, 't-1', { dueDate: '2026/06/05' }),
    ).rejects.toBeInstanceOf(TodoActionError);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('does NOT write if there is no patch to apply', async () => {
    await updateTodo({ db }, 't-1', {});
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('writes a trimmed description', async () => {
    await updateTodo({ db }, 't-1', { description: '  notes  ' });
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:todos/t-1' },
      { description: 'notes' },
    );
  });

  it('clears description with deleteField() when the trimmed value is empty', async () => {
    await updateTodo({ db }, 't-1', { description: '   ' });
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:todos/t-1' },
      { description: deleteFieldSentinel },
    );
  });

  it('rejects an oversized description before writing', async () => {
    await expect(
      updateTodo({ db }, 't-1', { description: 'a'.repeat(2001) }),
    ).rejects.toBeInstanceOf(TodoActionError);
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('writes a non-empty assignedTo straight through', async () => {
    await updateTodo({ db }, 't-1', { assignedTo: 'uid-b' });
    expect(updateDocMock).toHaveBeenCalledWith(
      { __ref: 'doc:todos/t-1' },
      { assignedTo: 'uid-b' },
    );
  });

  it('maps a Firestore failure on update to TodoActionError', async () => {
    updateDocMock.mockRejectedValueOnce(new Error('boom'));
    await expect(
      updateTodo({ db }, 't-1', { title: 'x' }),
    ).rejects.toBeInstanceOf(TodoActionError);
  });
});

describe('createTodo — description validation', () => {
  it('rejects a description over 2000 chars before writing', async () => {
    await expect(
      createTodo(
        { db },
        {
          familyId: 'fam-A',
          createdBy: 'uid-a',
          title: 'x',
          description: 'a'.repeat(2001),
        },
      ),
    ).rejects.toBeInstanceOf(TodoActionError);
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('omits an empty-trimmed description from the create body', async () => {
    await createTodo(
      { db },
      { familyId: 'fam-A', createdBy: 'uid-a', title: 'x', description: '   ' },
    );
    const call = addDocMock.mock.calls[0];
    if (call === undefined) throw new Error('addDoc was not called');
    const [, body] = call as [unknown, Record<string, unknown>];
    expect('description' in body).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setTodoCompletion
// ---------------------------------------------------------------------------

describe('setTodoCompletion', () => {
  it('sets isCompleted=true AND a completedAt timestamp on complete', async () => {
    await setTodoCompletion({ db }, 't-1', true);
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const call = updateDocMock.mock.calls[0];
    if (call === undefined) throw new Error('updateDoc was not called');
    const [, patch] = call as [unknown, Record<string, unknown>];
    expect(patch.isCompleted).toBe(true);
    expect(typeof patch.completedAt).toBe('number');
  });

  it('clears completedAt with deleteField() on un-complete', async () => {
    await setTodoCompletion({ db }, 't-1', false);
    expect(updateDocMock).toHaveBeenCalledWith({ __ref: 'doc:todos/t-1' }, {
      isCompleted: false,
      completedAt: deleteFieldSentinel,
    });
  });

  it('maps a Firestore failure to TodoActionError', async () => {
    updateDocMock.mockRejectedValueOnce(new Error('boom'));
    await expect(setTodoCompletion({ db }, 't-1', true)).rejects.toBeInstanceOf(
      TodoActionError,
    );
  });
});

// ---------------------------------------------------------------------------
// deleteTodo
// ---------------------------------------------------------------------------

describe('deleteTodo', () => {
  it('calls deleteDoc on the matching doc ref', async () => {
    await deleteTodo({ db }, 't-1');
    expect(deleteDocMock).toHaveBeenCalledWith({ __ref: 'doc:todos/t-1' });
  });

  it('maps a Firestore failure to TodoActionError', async () => {
    deleteDocMock.mockRejectedValueOnce(new Error('boom'));
    await expect(deleteTodo({ db }, 't-1')).rejects.toBeInstanceOf(TodoActionError);
  });
});
