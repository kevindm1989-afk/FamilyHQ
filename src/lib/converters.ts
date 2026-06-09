/**
 * Typed Firestore converters (system-design §2.6, withConverter).
 *
 * One typed read/write boundary per collection. `fromFirestore` asserts the
 * stored shape against types.ts; `toFirestore` strips any id field so the doc
 * body never carries its own key. `familyId` immutability is enforced
 * server-side in firestore.rules — these converters only shape the payload.
 */
import type {
  DocumentData,
  FirestoreDataConverter,
  QueryDocumentSnapshot,
  SnapshotOptions,
} from 'firebase/firestore';
import type {
  Birthday,
  ChecklistInstance,
  ChecklistTemplate,
  Chore,
  Family,
  FamilyEvent,
  Invite,
  Post,
  SavingsGoal,
  ShoppingItem,
  Todo,
  Transaction,
  User,
  UserPrivate,
  WishlistItem,
} from './types';

function makeConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(model: T): DocumentData {
      // Defensive: never persist a client-side `id` field into the doc body.
      const { id: _id, ...data } = model as T & { id?: unknown };
      void _id;
      return data;
    },
    fromFirestore(snapshot: QueryDocumentSnapshot, options?: SnapshotOptions): T {
      return snapshot.data(options) as T;
    },
  };
}

export const familyConverter: FirestoreDataConverter<Family> = makeConverter<Family>();

export const userConverter: FirestoreDataConverter<User> = makeConverter<User>();

export const eventConverter: FirestoreDataConverter<FamilyEvent> = makeConverter<FamilyEvent>();

export const postConverter: FirestoreDataConverter<Post> = makeConverter<Post>();

export const choreConverter: FirestoreDataConverter<Chore> = makeConverter<Chore>();

export const transactionConverter: FirestoreDataConverter<Transaction> =
  makeConverter<Transaction>();

export const inviteConverter: FirestoreDataConverter<Invite> = makeConverter<Invite>();

export const savingsGoalConverter: FirestoreDataConverter<SavingsGoal> =
  makeConverter<SavingsGoal>();

export const todoConverter: FirestoreDataConverter<Todo> = makeConverter<Todo>();

export const checklistTemplateConverter: FirestoreDataConverter<ChecklistTemplate> =
  makeConverter<ChecklistTemplate>();

export const checklistInstanceConverter: FirestoreDataConverter<ChecklistInstance> =
  makeConverter<ChecklistInstance>();

export const birthdayConverter: FirestoreDataConverter<Birthday> = makeConverter<Birthday>();

export const shoppingItemConverter: FirestoreDataConverter<ShoppingItem> =
  makeConverter<ShoppingItem>();

export const wishlistItemConverter: FirestoreDataConverter<WishlistItem> =
  makeConverter<WishlistItem>();

/**
 * Converter for `userPrivate/{uid}` (privacy finding 2). Shapes the adult email
 * [PI] doc that was moved off the family-readable users doc. Same typed
 * read/write boundary as every other collection; `familyId` immutability is
 * enforced server-side in firestore.rules.
 */
export const userPrivateConverter: FirestoreDataConverter<UserPrivate> =
  makeConverter<UserPrivate>();
