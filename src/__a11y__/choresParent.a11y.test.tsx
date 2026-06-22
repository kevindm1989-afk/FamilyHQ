/**
 * A11y gate — ChoresParentScreen (Phase 4 / Task 17).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChoresParentScreen } from '../features/chores/ChoresParentScreen';
import { ToastProvider } from '../hooks/useToast';
import { axeA11y, mkChore, mkMember, mkParent, noop, noopAsync } from './fixtures';

const parent = mkParent({ id: 'uid-parent-a', name: 'Sarah Kim' });
const child = mkMember({ id: 'uid-member-a', name: 'Maya Rivera' });
const childB = mkMember({ id: 'uid-child-b', name: 'Ben Rivera' });

describe('a11y — ChoresParentScreen', () => {
  it('populated family-chore list (mixed statuses) has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <ChoresParentScreen
          familyId="fam-A"
          viewer={{ uid: parent.id, name: parent.name, role: 'parent' }}
          members={[parent, child, childB]}
          feed={{
            chores: [
              mkChore({
                id: 'c1',
                title: 'Take out trash',
                status: 'complete',
                dollarValue: 710,
                assignedTo: child.id,
              }),
              mkChore({
                id: 'c2',
                title: 'Walk dog',
                status: 'pending',
                dollarValue: 800,
                assignedTo: childB.id,
              }),
              mkChore({
                id: 'c3',
                title: 'Mow lawn',
                status: 'approved',
                dollarValue: 930,
                assignedTo: child.id,
              }),
            ],
            loading: false,
            error: null,
            refresh: noopAsync,
          }}
          onApprove={noopAsync}
          onReject={noopAsync}
          onAddChore={noop}
          onEditChore={noop}
          onDeleteChore={noopAsync}
        />
      </ToastProvider>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
