/**
 * Theme persistence — writes the signed-in user's chosen theme to their own
 * `users/{uid}` doc. `theme` is a self-writable field (firestore.rules
 * selfUpdateAllowed permits name + theme); every authority field stays
 * immutable, so this single-field update is safe.
 *
 * Errors map to a generic, user-safe message (no raw Firebase code).
 */
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import type { Theme } from '../../lib/types';

export class ThemeActionError extends Error {
  constructor(message = 'We could not update your theme. Please try again.') {
    super(message);
    this.name = 'ThemeActionError';
  }
}

export async function setUserTheme(
  deps: { db: Firestore },
  uid: string,
  theme: Theme,
): Promise<void> {
  try {
    await updateDoc(doc(deps.db, 'users', uid), { theme });
  } catch {
    throw new ThemeActionError();
  }
}
