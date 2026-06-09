/**
 * BirthdaysRoute — integration contract.
 *
 * Mocks the live feed + service so no Firebase is touched. Pins that the
 * route renders the screen heading, the FAB → create flow calls
 * `createBirthday` with familyId + createdBy bound to the viewer, and the
 * Placeholder fallback when the family isn't loaded yet.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';

const memberUser: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
} = {
  familyId: memberUser.familyId,
  role: memberUser.role,
  currentUser: memberUser,
  members: [memberUser],
  loading: false,
};

vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => familyState,
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

let mockFeed: { birthdays: unknown[]; loading: boolean; error: string | null } = {
  birthdays: [],
  loading: false,
  error: null,
};
vi.mock('./useFamilyBirthdays', () => ({
  useFamilyBirthdays: () => mockFeed,
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

const createBirthdayMock = vi.fn(async (..._args: unknown[]) => 'new-id');
const updateBirthdayMock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteBirthdayMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('./birthdaysService', async () => {
  const actual = await vi.importActual<typeof import('./birthdaysService')>('./birthdaysService');
  return {
    ...actual,
    createBirthday: (a: unknown, b: unknown) => createBirthdayMock(a, b),
    updateBirthday: (a: unknown, b: unknown, c: unknown) => updateBirthdayMock(a, b, c),
    deleteBirthday: (a: unknown, b: unknown) => deleteBirthdayMock(a, b),
  };
});

import BirthdaysRoute from './BirthdaysRoute';

afterEach(() => {
  vi.clearAllMocks();
  mockFeed = { birthdays: [], loading: false, error: null };
});

describe('BirthdaysRoute', () => {
  it('renders the screen heading', () => {
    render(<BirthdaysRoute />);
    expect(screen.getByRole('heading', { level: 1, name: /birthdays/i })).toBeInTheDocument();
  });

  it('falls back to a Placeholder when family is not loaded', () => {
    familyState = { familyId: null, role: null, currentUser: null, members: [], loading: false };
    render(<BirthdaysRoute />);
    expect(screen.getByRole('heading', { level: 1, name: /birthdays/i })).toBeInTheDocument();
    // Restore.
    familyState = {
      familyId: memberUser.familyId,
      role: memberUser.role,
      currentUser: memberUser,
      members: [memberUser],
      loading: false,
    };
  });

  it('calls createBirthday with familyId + createdBy bound to viewer', async () => {
    render(<BirthdaysRoute />);
    fireEvent.click(screen.getByRole('button', { name: /new birthday/i }));
    const sheet = await screen.findByRole('dialog');
    // Name is a required TextField → label is "Name (Required)".
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^name/i }), {
      target: { value: 'Maya' },
    });
    // Pick June (6) and day 15 via the MonthDayInput.
    fireEvent.change(within(sheet).getByRole('combobox', { name: /month/i }), {
      target: { value: '6' },
    });
    fireEvent.change(within(sheet).getByRole('spinbutton', { name: /day/i }), {
      target: { value: '15' },
    });
    fireEvent.submit(within(sheet).getByRole('button', { name: /add birthday/i }).closest('form')!);
    await waitFor(() => {
      expect(createBirthdayMock).toHaveBeenCalledTimes(1);
    });
    const [, payload] = createBirthdayMock.mock.calls[0] as [
      unknown,
      { familyId: string; createdBy: string; name: string; monthDay: string },
    ];
    expect(payload.familyId).toBe(memberUser.familyId);
    expect(payload.createdBy).toBe(memberUser.id);
    expect(payload.name).toBe('Maya');
    expect(payload.monthDay).toBe('06-15');
  });

  it('calls deleteBirthday when the per-row Delete is tapped', async () => {
    mockFeed = {
      birthdays: [
        {
          id: 'b-1',
          familyId: memberUser.familyId,
          createdBy: memberUser.id,
          name: 'Maya',
          monthDay: '06-15',
          type: 'birthday',
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<BirthdaysRoute />);
    fireEvent.click(screen.getByRole('button', { name: /delete maya/i }));
    await waitFor(() => {
      expect(deleteBirthdayMock).toHaveBeenCalledWith({ db: { __db: true } }, 'b-1');
    });
  });
});
