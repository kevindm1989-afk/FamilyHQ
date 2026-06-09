/**
 * Allowance-history feed hook (Allowance History feature; ADR-0004).
 *
 * Mirrors useMyChores: subscribes to the existing `transactions` ledger scoped
 * with BOTH equality filters the rules allow —
 * `where('familyId','==', familyId)` AND `where('uid','==', uid)` — plus
 * `orderBy('createdAt','desc')`, so a viewer sees ONLY the selected member's
 * OWN ledger, never a peer's nor another family's. NEVER a familyId-only query
 * (that would leak peers). `createdAt` (Timestamp / pending serverTimestamp) is
 * Timestamp->ms converted. CLEARS transactions on a uid OR familyId CHANGE
 * (cross-display leak guard). A null uid OR null familyId issues no query.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  getDocsFromServer,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { Transaction } from '../../lib/types';
import { ALLOWANCE_LOAD_ERROR, type TransactionWithId } from './allowanceService';

/**
 * Firestore returns `createdAt` as a `Timestamp` at read time, but
 * `Transaction.createdAt` is typed `number` (ms). Convert here so a Timestamp
 * object never reaches the UI. A pending serverTimestamp (local write before
 * the server resolves) arrives as `null` — treat it as ~now so it never renders
 * NaN / null / epoch. Mirrors the chores/events/posts conversion.
 */
function toMillis(createdAt: unknown): number {
  if (createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === 'function') {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export interface UseAllowanceHistoryResult {
  transactions: TransactionWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function buildTransactionsQuery(db: Firestore, uid: string, familyId: string) {
  // BOTH equality filters: own family AND own ledger (order-independent). The
  // uid equality filter is the per-member peer-leak guard — a familyId-only
  // query would return every family member's ledger. The orderBy uses the
  // existing [familyId, uid, createdAt DESC] composite index.
  return query(
    collection(db, 'transactions'),
    where('familyId', '==', familyId),
    where('uid', '==', uid),
    orderBy('createdAt', 'desc'),
  );
}

function toTransaction(snap: QueryDocumentSnapshot): TransactionWithId {
  const data = snap.data() as Transaction & { createdAt: unknown };
  return { id: snap.id, ...data, createdAt: toMillis(data.createdAt) };
}

export function useAllowanceHistory(
  uid: string | null,
  familyId: string | null,
): UseAllowanceHistoryResult {
  const [transactions, setTransactions] = useState<TransactionWithId[]>([]);
  // No uid/family yet -> never query; not loading, empty list.
  const [loading, setLoading] = useState<boolean>(uid !== null && familyId !== null);
  const [error, setError] = useState<string | null>(null);
  // Monotonic refresh token: a resolved fetch whose token is stale is ignored,
  // so the LATEST refresh() always wins even if an earlier call resolves last.
  const refreshToken = useRef(0);
  const dbRef = useRef<Firestore | null>(null);
  // Lesson 2026-05-28 #2: sign by id + every field the screen reads (here:
  // sourceLabel, amount, createdAt). An id-only signature would drop a
  // ledger-row mutation on the same id (e.g. an admin amount correction) as
  // a redundant re-fire. The dedupe still short-circuits a true cache
  // re-emission. Reset per effect run so a uid/familyId change does not carry
  // a stale signature.
  const lastSnapshotSig = useRef<string | null>(null);

  useEffect(() => {
    // Always clear stale transactions on a uid OR familyId CHANGE — not only
    // when one goes null — so one member's ledger never lingers while another
    // member's loads (cross-display leak).
    setTransactions([]);
    if (uid === null || familyId === null) {
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    lastSnapshotSig.current = null;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    // Firebase config is imported lazily so this module's top level stays SDK-
    // free (mirrors useMyChores).
    void import('../../firebase/config')
      .then(({ db }) => {
        if (cancelled) return;
        dbRef.current = db;
        unsub = onSnapshot(
          buildTransactionsQuery(db, uid, familyId),
          (snap) => {
            const docs = (snap as { docs: QueryDocumentSnapshot[] }).docs;
            const sig = docs
              .map((d) => {
                const data = d.data() as Transaction & { createdAt: unknown };
                return [d.id, data.sourceLabel, String(data.amount), String(data.createdAt)].join(
                  ':',
                );
              })
              .join(',');
            if (sig === lastSnapshotSig.current) {
              setLoading(false);
              return;
            }
            lastSnapshotSig.current = sig;
            // Claim the next monotonic token so an in-flight refresh whose
            // server fetch pre-dated this snapshot bails out instead of
            // clobbering the newer live state.
            refreshToken.current += 1;
            setTransactions(docs.map(toTransaction));
            // Clear any prior (e.g. transient listener) error: a recovered
            // snapshot must not leave a sticky error banner over good data (F6),
            // mirroring the refresh() success path.
            setError(null);
            setLoading(false);
          },
          () => {
            // Never surface a raw Firebase code / PII.
            setError(ALLOWANCE_LOAD_ERROR);
            setLoading(false);
          },
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError(ALLOWANCE_LOAD_ERROR);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [uid, familyId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (uid === null || familyId === null) return;
    const token = (refreshToken.current += 1);
    try {
      const db = dbRef.current ?? (await import('../../firebase/config')).db;
      dbRef.current = db;
      const snap = await getDocsFromServer(buildTransactionsQuery(db, uid, familyId));
      // Ignore a stale fetch: a newer refresh() has been issued since.
      if (token !== refreshToken.current) return;
      setTransactions((snap as { docs: QueryDocumentSnapshot[] }).docs.map(toTransaction));
      setError(null);
    } catch {
      if (token !== refreshToken.current) return;
      setError(ALLOWANCE_LOAD_ERROR);
    }
  }, [uid, familyId]);

  return { transactions, loading, error, refresh };
}
