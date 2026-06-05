/**
 * Pure bucketing helper for the Todos panel.
 *
 * Splits a flat list of Todos into the three UI buckets the spec asked for:
 *   - Overdue: not yet completed AND `dueDate < today`
 *   - Upcoming: not yet completed AND `dueDate >= today`
 *   - Someday: not yet completed AND no `dueDate`
 *   - Completed: `isCompleted === true` (lives in a collapsed section)
 *
 * `today` is passed in (ISO `YYYY-MM-DD`) so the buckets are deterministic
 * + unit-testable without freezing the system clock.
 */
import type { TodoWithId } from './todosService';

export interface TodoBuckets {
  overdue: TodoWithId[];
  upcoming: TodoWithId[];
  someday: TodoWithId[];
  completed: TodoWithId[];
}

/**
 * Comparator for non-completed Todos with a dueDate.
 * Earlier dueDate first; ties broken by createdAt (earlier first).
 */
function byDueDateAsc(a: TodoWithId, b: TodoWithId): number {
  const ad = a.dueDate ?? '';
  const bd = b.dueDate ?? '';
  if (ad === bd) return a.createdAt - b.createdAt;
  return ad < bd ? -1 : 1;
}

function byCreatedAtAsc(a: TodoWithId, b: TodoWithId): number {
  return a.createdAt - b.createdAt;
}

function byCompletedAtDesc(a: TodoWithId, b: TodoWithId): number {
  const ac = a.completedAt ?? 0;
  const bc = b.completedAt ?? 0;
  if (ac === bc) return b.createdAt - a.createdAt;
  return bc - ac;
}

export function bucketTodos(todos: TodoWithId[], todayISO: string): TodoBuckets {
  const overdue: TodoWithId[] = [];
  const upcoming: TodoWithId[] = [];
  const someday: TodoWithId[] = [];
  const completed: TodoWithId[] = [];

  for (const todo of todos) {
    if (todo.isCompleted) {
      completed.push(todo);
      continue;
    }
    if (todo.dueDate === undefined || todo.dueDate === '') {
      someday.push(todo);
      continue;
    }
    if (todo.dueDate < todayISO) overdue.push(todo);
    else upcoming.push(todo);
  }

  overdue.sort(byDueDateAsc);
  upcoming.sort(byDueDateAsc);
  someday.sort(byCreatedAtAsc);
  completed.sort(byCompletedAtDesc);

  return { overdue, upcoming, someday, completed };
}

/** Today's date in ISO YYYY-MM-DD, in the caller's local timezone. */
export function todayISOInLocalTZ(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
