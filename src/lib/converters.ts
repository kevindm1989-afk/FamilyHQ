/**
 * CONTRACT — typed Firestore converters (system-design §2.6, withConverter).
 *
 * Signatures only — the implementer writes the toFirestore/fromFirestore
 * bodies. The tests import these symbols to pin the converter surface so each
 * collection has a single typed read/write boundary. Returning
 * `FirestoreDataConverter<T>` keeps the shape compile-checked against types.ts.
 *
 * NOTE: This is a contract stub. The implementer MUST implement the bodies; the
 * `throw` here makes any accidental use before implementation fail loudly
 * rather than silently returning undefined.
 */
import type { FirestoreDataConverter } from 'firebase/firestore';
import type {
  Chore,
  Family,
  FamilyEvent,
  Invite,
  Post,
  Transaction,
  User,
} from './types';

const unimplemented = (name: string): never => {
  throw new Error(
    `converter ${name} is a contract stub — implement in Task 4/5 (src/lib/converters.ts)`,
  );
};

export const familyConverter: FirestoreDataConverter<Family> = {
  toFirestore: () => unimplemented('familyConverter.toFirestore'),
  fromFirestore: () => unimplemented('familyConverter.fromFirestore'),
};

export const userConverter: FirestoreDataConverter<User> = {
  toFirestore: () => unimplemented('userConverter.toFirestore'),
  fromFirestore: () => unimplemented('userConverter.fromFirestore'),
};

export const eventConverter: FirestoreDataConverter<FamilyEvent> = {
  toFirestore: () => unimplemented('eventConverter.toFirestore'),
  fromFirestore: () => unimplemented('eventConverter.fromFirestore'),
};

export const postConverter: FirestoreDataConverter<Post> = {
  toFirestore: () => unimplemented('postConverter.toFirestore'),
  fromFirestore: () => unimplemented('postConverter.fromFirestore'),
};

export const choreConverter: FirestoreDataConverter<Chore> = {
  toFirestore: () => unimplemented('choreConverter.toFirestore'),
  fromFirestore: () => unimplemented('choreConverter.fromFirestore'),
};

export const transactionConverter: FirestoreDataConverter<Transaction> = {
  toFirestore: () => unimplemented('transactionConverter.toFirestore'),
  fromFirestore: () => unimplemented('transactionConverter.fromFirestore'),
};

export const inviteConverter: FirestoreDataConverter<Invite> = {
  toFirestore: () => unimplemented('inviteConverter.toFirestore'),
  fromFirestore: () => unimplemented('inviteConverter.fromFirestore'),
};
