/**
 * A11y gate — AllowanceHistoryScreen (Phase 4 / Task 17).
 *
 * Parent viewer sees the member picker; member viewer does not. Both render
 * paths are pinned so the picker (a `radiogroup` / select control depending on
 * design) is exercised when it exists.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AllowanceHistoryScreen } from '../features/allowance/AllowanceHistoryScreen';
import { axeA11y, mkMember, mkParent, mkTxn, noop, noopAsync } from './fixtures';

const parent = mkParent({ id: 'uid-parent-a', name: 'Sarah Kim' });
const child = mkMember({ id: 'uid-member-a', name: 'Maya Rivera', allowanceBalance: 3850 });
const childB = mkMember({ id: 'uid-child-b', name: 'Ben Rivera', allowanceBalance: 1200 });

describe('a11y — AllowanceHistoryScreen', () => {
  it('member view (own ledger) has no axe violations', async () => {
    const { container } = render(
      <AllowanceHistoryScreen
        viewer={{ uid: child.id, name: child.name, role: 'member' }}
        selectedMember={{ uid: child.id, name: child.name, balanceCents: child.allowanceBalance }}
        members={[child]}
        feed={{
          transactions: [
            mkTxn({ id: 'tx1', choreTitle: 'Sweep porch', amount: 425 }),
            mkTxn({ id: 'tx2', choreTitle: 'Dishes', amount: 200 }),
          ],
          loading: false,
          error: null,
          refresh: noopAsync,
        }}
        onSelectMember={noop}
      />,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('parent view (picker visible) has no axe violations', async () => {
    const { container } = render(
      <AllowanceHistoryScreen
        viewer={{ uid: parent.id, name: parent.name, role: 'parent' }}
        selectedMember={{ uid: child.id, name: child.name, balanceCents: child.allowanceBalance }}
        members={[child, childB]}
        feed={{
          transactions: [mkTxn({ id: 'tx1', choreTitle: 'Sweep porch', amount: 425 })],
          loading: false,
          error: null,
          refresh: noopAsync,
        }}
        onSelectMember={noop}
      />,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
