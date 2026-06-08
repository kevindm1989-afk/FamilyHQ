/**
 * A11y gate — DashboardScreen (Phase 4 / Task 17).
 *
 * Renders the dashboard in a populated MEMBER state + populated PARENT state
 * and asserts axe-core finds no violations. Pinning both roles because the
 * dashboard's layout diverges by role (member sees balance + own chores;
 * parent sees the approval queue) — the screens are effectively two pages.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardScreen, type SectionFeed } from '../features/dashboard/DashboardScreen';
import {
  A11Y_NOW,
  axeA11y,
  mkChore,
  mkEvent,
  mkMember,
  mkParent,
  mkPost,
  mkTxn,
  noop,
} from './fixtures';

function settled<T>(items: T[]): SectionFeed<T> {
  return { items, loading: false, error: null };
}

const member = mkMember({ id: 'uid-member-a', name: 'Maya Rivera', allowanceBalance: 3850 });
const otherChild = mkMember({ id: 'uid-child-b', name: 'Ben Rivera', allowanceBalance: 1200 });
const parent = mkParent({ id: 'uid-parent-a', name: 'Sarah Kim' });

describe('a11y — DashboardScreen', () => {
  it('member view (populated) has no axe violations', async () => {
    const { container } = render(
      <DashboardScreen
        role="member"
        userName={member.name}
        balanceCents={member.allowanceBalance}
        members={[member, otherChild]}
        nowMs={A11Y_NOW}
        onNavigate={noop}
        onRefresh={noop}
        earnings={settled([
          mkTxn({ id: 'tx1', choreTitle: 'Sweep porch', amount: 425 }),
          mkTxn({ id: 'tx2', choreTitle: 'Dishes', amount: 200 }),
        ])}
        myChores={settled([
          mkChore({ id: 'c1', title: 'Take out trash', status: 'pending', dollarValue: 710 }),
          mkChore({ id: 'c2', title: 'Walk dog', status: 'complete', dollarValue: 800 }),
        ])}
        todos={settled([])}
        approvals={settled([])}
        events={settled([
          mkEvent({ id: 'e1', title: 'Soccer practice', tag: 'sports' }),
          mkEvent({ id: 'e2', title: 'School play', tag: 'school' }),
        ])}
        posts={settled([
          mkPost({ id: 'p1', content: 'Family movie night tonight!' }),
          mkPost({ id: 'p2', content: 'Reminder: dentist Friday' }),
        ])}
      />,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('parent view (populated approval queue) has no axe violations', async () => {
    const { container } = render(
      <DashboardScreen
        role="parent"
        userName={parent.name}
        balanceCents={0}
        members={[member, otherChild]}
        nowMs={A11Y_NOW}
        onNavigate={noop}
        onRefresh={noop}
        earnings={settled([])}
        myChores={settled([])}
        todos={settled([])}
        approvals={settled([
          mkChore({
            id: 'c-approval-1',
            title: 'Mow lawn',
            status: 'complete',
            dollarValue: 930,
            assignedTo: member.id,
          }),
        ])}
        events={settled([mkEvent({ id: 'e1', title: 'Soccer practice', tag: 'sports' })])}
        posts={settled([mkPost({ id: 'p1', content: 'Family movie night tonight!' })])}
      />,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
