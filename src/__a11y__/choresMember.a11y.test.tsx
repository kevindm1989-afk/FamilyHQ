/**
 * A11y gate — ChoresMemberScreen (Phase 4 / Task 17).
 *
 * Member's own chore list, covering the four status partitions (pending,
 * waiting/complete, approved, rejected) so the rejection-reason +
 * "try again" / "mark done" / "approved" surfaces all render at least once.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChoresMemberScreen } from '../features/chores/ChoresMemberScreen';
import { ToastProvider } from '../hooks/useToast';
import { axeA11y, mkChore, mkMember, noop, noopAsync } from './fixtures';

const member = mkMember({ id: 'uid-member-a', name: 'Maya Rivera', allowanceBalance: 3850 });

describe('a11y — ChoresMemberScreen', () => {
  it('populated list across all four statuses has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <ChoresMemberScreen
          familyId="fam-A"
          viewer={{
            uid: member.id,
            name: member.name,
            role: 'member',
            allowanceBalance: member.allowanceBalance,
          }}
          feed={{
            chores: [
              mkChore({ id: 'c1', title: 'Take out trash', status: 'pending', dollarValue: 710 }),
              mkChore({ id: 'c2', title: 'Walk dog', status: 'complete', dollarValue: 800 }),
              mkChore({ id: 'c3', title: 'Make bed', status: 'approved', dollarValue: 200 }),
              mkChore({
                id: 'c4',
                title: 'Dishes',
                status: 'rejected',
                dollarValue: 350,
                rejectionReason: 'A few plates still dirty — try again',
              }),
              mkChore({
                id: 'c5',
                title: 'Vacuum living room',
                status: 'pending',
                dollarValue: 500,
                isRecurring: true,
                recurrenceFrequency: 'weekly',
              }),
            ],
            loading: false,
            error: null,
            refresh: noopAsync,
          }}
          onMarkComplete={noopAsync}
          onViewHistory={noop}
        />
      </ToastProvider>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
