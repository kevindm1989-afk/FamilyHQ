/**
 * Live family Todos feed (Task Management — PR B).
 *
 * Subscribes to `todos` scoped by `familyId == familyId`. Any active
 * same-family caller is allowed by the rule to read the family-wide list,
 * so this hook is the same for parents and members — no role branching.
 *
 * `createdAt` may be a Firestore Timestamp on a fresh server-written doc
 * (createdTodo uses serverTimestamp()); we normalise to epoch ms so the
 * UI deals in a single shape.
 */
import { useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { todoConverter } from '../../lib/converters';
import type { Todo } from '../../lib/types';
import type { TodoWithId } from './todosService';

export interface UseFamilyTodosResult {
  todos: TodoWithId[];
  loading: boolean;
  error: string | null;
}

const TODO_LOAD_ERROR = 'We could not load to-dos. Please try again.';

function toMillis(createdAt: unknown): number {
  if (createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function') {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  if (typeof createdAt === 'number') return createdAt;
  return Date.now();
}

function toTodo(snap: QueryDocumentSnapshot<Todo>): TodoWithId {
  const data = snap.data() as Todo & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

function buildQuery(db: Firestore, familyId: string) {
  return query(
    collection(db, 'todos').withConverter(todoConverter),
    where('familyId', '==', familyId),
  );
}

export function useFamilyTodos(familyId: string | null): UseFamilyTodosResult {
  const [todos, setTodos] = useState<TodoWithId[]>([]);
  const [loading, setLoading] = useState<boolean>(familyId !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTodos([]);
    if (familyId === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    let unsub: (() => void) | undefined;
    let cancelled = false;
    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        unsub = onSnapshot(
          buildQuery(db, familyId),
          (snap) => {
            setTodos(snap.docs.map(toTodo));
            setLoading(false);
            setError(null);
          },
          () => {
            setTodos([]);
            setLoading(false);
            setError(TODO_LOAD_ERROR);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(TODO_LOAD_ERROR);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [familyId]);

  return { todos, loading, error };
}
