/** setUserTheme — persists users/{uid}.theme; maps failures. */
import { describe, expect, it, vi } from 'vitest';

const updateDocMock = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ __path: `${col}/${id}` }),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
}));

import { setUserTheme, ThemeActionError } from './themeService';
import type { Firestore } from 'firebase/firestore';

const db = {} as Firestore;

describe('setUserTheme', () => {
  it('writes exactly {theme} to the caller users doc', async () => {
    updateDocMock.mockResolvedValueOnce(undefined);
    await setUserTheme({ db }, 'uid-1', 'dark');
    expect(updateDocMock).toHaveBeenCalledWith({ __path: 'users/uid-1' }, { theme: 'dark' });
  });
  it('maps a write failure to a user-safe ThemeActionError', async () => {
    updateDocMock.mockRejectedValueOnce(new Error('rules denied'));
    await expect(setUserTheme({ db }, 'uid-1', 'light')).rejects.toBeInstanceOf(ThemeActionError);
  });
});
