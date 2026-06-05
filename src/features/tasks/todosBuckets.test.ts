/**
 * Unit-level contract for the pure bucketer.
 * Sorting + boundary behaviour pinned here; the panel is just a renderer.
 */
import { describe, expect, it } from 'vitest';
import { bucketTodos, todayISOInLocalTZ } from './todosBuckets';
import type { TodoWithId } from './todosService';

function mk(over: Partial<TodoWithId> & { id: string }): TodoWithId {
  return {
    familyId: 'fam-A',
    createdBy: 'uid-a',
    title: `T-${over.id}`,
    isCompleted: false,
    createdAt: 1000,
    ...over,
  };
}

const TODAY = '2026-06-05';

describe('bucketTodos', () => {
  it('splits todos into overdue / upcoming / someday / completed buckets', () => {
    const todos: TodoWithId[] = [
      mk({ id: 'overdue-1', dueDate: '2026-06-01' }),
      mk({ id: 'upcoming-1', dueDate: '2026-06-10' }),
      mk({ id: 'someday-1' }),
      mk({ id: 'done-1', isCompleted: true, completedAt: 500 }),
    ];
    const b = bucketTodos(todos, TODAY);
    expect(b.overdue.map((t) => t.id)).toEqual(['overdue-1']);
    expect(b.upcoming.map((t) => t.id)).toEqual(['upcoming-1']);
    expect(b.someday.map((t) => t.id)).toEqual(['someday-1']);
    expect(b.completed.map((t) => t.id)).toEqual(['done-1']);
  });

  it('treats today as "upcoming", not overdue (boundary)', () => {
    const todos: TodoWithId[] = [mk({ id: 'today', dueDate: TODAY })];
    const b = bucketTodos(todos, TODAY);
    expect(b.upcoming.map((t) => t.id)).toEqual(['today']);
    expect(b.overdue).toHaveLength(0);
  });

  it('sorts overdue + upcoming by dueDate ascending (earliest first)', () => {
    const todos: TodoWithId[] = [
      mk({ id: 'b', dueDate: '2026-06-10' }),
      mk({ id: 'a', dueDate: '2026-06-08' }),
      mk({ id: 'c', dueDate: '2026-06-15' }),
    ];
    const b = bucketTodos(todos, TODAY);
    expect(b.upcoming.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts someday by createdAt ascending (oldest first)', () => {
    const todos: TodoWithId[] = [
      mk({ id: 'newer', createdAt: 3000 }),
      mk({ id: 'older', createdAt: 1000 }),
      mk({ id: 'mid', createdAt: 2000 }),
    ];
    const b = bucketTodos(todos, TODAY);
    expect(b.someday.map((t) => t.id)).toEqual(['older', 'mid', 'newer']);
  });

  it('sorts completed by completedAt descending (most recent first)', () => {
    const todos: TodoWithId[] = [
      mk({ id: 'older', isCompleted: true, completedAt: 1000 }),
      mk({ id: 'newer', isCompleted: true, completedAt: 3000 }),
      mk({ id: 'mid', isCompleted: true, completedAt: 2000 }),
    ];
    const b = bucketTodos(todos, TODAY);
    expect(b.completed.map((t) => t.id)).toEqual(['newer', 'mid', 'older']);
  });

  it('ignores dueDate on a completed todo (always lives in completed)', () => {
    const todos: TodoWithId[] = [
      mk({ id: 'done-overdue', isCompleted: true, dueDate: '2026-06-01' }),
    ];
    const b = bucketTodos(todos, TODAY);
    expect(b.overdue).toHaveLength(0);
    expect(b.completed.map((t) => t.id)).toEqual(['done-overdue']);
  });
});

describe('todayISOInLocalTZ', () => {
  it('formats a date as YYYY-MM-DD in the local timezone', () => {
    // Construct a Date so the local-tz components are deterministic regardless
    // of the runner's TZ — Date's getFullYear/getMonth/getDate are all local.
    const fixed = new Date(2026, 5, 5, 12, 0, 0, 0); // 2026-06-05 local noon
    expect(todayISOInLocalTZ(fixed)).toBe('2026-06-05');
  });
});
