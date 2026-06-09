/**
 * BirthdaysScreen — props-injected screen contract.
 *
 * Pins the state machine, group-by-month rendering, and that the create
 * sheet validates an empty name BEFORE calling onCreate.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BirthdaysScreen } from './BirthdaysScreen';
import type { BirthdayWithId } from './birthdaysService';

function mk(over: Partial<BirthdayWithId> & { id: string; monthDay: string }): BirthdayWithId {
  return {
    familyId: 'fam-A',
    createdBy: 'uid-a',
    name: `T-${over.id}`,
    type: 'birthday',
    createdAt: 1000,
    ...over,
  };
}

function renderScreen(
  over: Partial<Parameters<typeof BirthdaysScreen>[0]> = {},
): ReturnType<typeof render> {
  const feed = over.feed ?? { birthdays: [], loading: false, error: null };
  return render(<BirthdaysScreen feed={feed} {...over} />);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('BirthdaysScreen — state machine', () => {
  it('renders the Skeleton when loading', () => {
    renderScreen({ feed: { birthdays: [], loading: true, error: null } });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an inline error (NEVER a toast) when the feed errored', () => {
    renderScreen({
      feed: { birthdays: [], loading: false, error: 'We could not load birthdays. Please try again.' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load birthdays/i);
  });

  it('renders the empty-state copy when zero birthdays', () => {
    renderScreen({ feed: { birthdays: [], loading: false, error: null } });
    expect(screen.getByText(/no birthdays yet/i)).toBeInTheDocument();
  });
});

describe('BirthdaysScreen — list rendering', () => {
  it('groups birthdays by month with January first and ordered within', () => {
    renderScreen({
      feed: {
        birthdays: [
          mk({ id: 'mar', monthDay: '03-15', name: 'Mar Person' }),
          mk({ id: 'jan-late', monthDay: '01-20', name: 'Late Jan' }),
          mk({ id: 'jan-early', monthDay: '01-05', name: 'Early Jan' }),
        ],
        loading: false,
        error: null,
      },
    });
    const january = screen.getByRole('region', { name: /^january$/i });
    const march = screen.getByRole('region', { name: /^march$/i });
    // January contains both January rows; March contains the March row.
    const janRows = within(january).getAllByRole('listitem');
    expect(janRows.map((li) => li.textContent ?? '')).toEqual(
      expect.arrayContaining([expect.stringMatching(/early jan/i), expect.stringMatching(/late jan/i)]),
    );
    // Within-month order: 01-05 before 01-20.
    const janText = january.textContent ?? '';
    expect(janText.indexOf('Early Jan')).toBeLessThan(janText.indexOf('Late Jan'));
    expect(within(march).getByText(/mar person/i)).toBeInTheDocument();
    // Heading order: January precedes March on the page.
    const sections = screen.getAllByRole('region');
    const jIdx = sections.indexOf(january);
    const mIdx = sections.indexOf(march);
    expect(jIdx).toBeLessThan(mIdx);
  });

  it('renders an Anniversary badge on type=anniversary rows', () => {
    renderScreen({
      feed: {
        birthdays: [mk({ id: 'a1', monthDay: '06-15', name: 'Mom + Dad', type: 'anniversary' })],
        loading: false,
        error: null,
      },
    });
    expect(screen.getByText(/^anniversary$/i)).toBeInTheDocument();
  });
});

describe('BirthdaysScreen — create sheet', () => {
  it('shows the FAB only when onCreate is provided', () => {
    const { rerender } = renderScreen({});
    expect(screen.queryByRole('button', { name: /new birthday/i })).not.toBeInTheDocument();
    rerender(
      <BirthdaysScreen
        feed={{ birthdays: [], loading: false, error: null }}
        onCreate={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByRole('button', { name: /new birthday/i })).toBeInTheDocument();
  });

  it('opens the sheet on FAB tap and rejects an empty name', async () => {
    const onCreate = vi.fn(async () => undefined);
    renderScreen({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /new birthday/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.submit(within(sheet).getByRole('button', { name: /add birthday/i }).closest('form')!);
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/please enter a name/i);
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('BirthdaysScreen — delete', () => {
  it('fires onDelete with the row id when the per-row Delete is tapped', async () => {
    const onDelete = vi.fn(async () => undefined);
    renderScreen({
      feed: {
        birthdays: [mk({ id: 'b-1', monthDay: '06-15', name: 'Maya' })],
        loading: false,
        error: null,
      },
      onDelete,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete maya/i }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('b-1');
    });
  });
});

describe('BirthdaysScreen — edit sheet', () => {
  it('opens with the row pre-filled and submits only the changed name', async () => {
    const onEdit = vi.fn(async () => undefined);
    renderScreen({
      feed: {
        birthdays: [
          mk({
            id: 'b-1',
            monthDay: '06-15',
            name: 'Maya',
            birthYear: 2014,
            note: 'loves pokemon',
          }),
        ],
        loading: false,
        error: null,
      },
      onEdit,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit maya/i }));
    const sheet = await screen.findByRole('dialog');
    const nameInput = within(sheet).getByLabelText(/name/i) as HTMLInputElement;
    expect(nameInput.value).toBe('Maya');
    fireEvent.change(nameInput, { target: { value: 'Maya R.' } });
    fireEvent.submit(within(sheet).getByRole('button', { name: /save changes/i }).closest('form')!);
    await waitFor(() => {
      expect(onEdit).toHaveBeenCalledTimes(1);
    });
    const call = onEdit.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(call[0]).toBe('b-1');
    expect(call[1]).toMatchObject({ name: 'Maya R.', monthDay: '06-15' });
  });
});
