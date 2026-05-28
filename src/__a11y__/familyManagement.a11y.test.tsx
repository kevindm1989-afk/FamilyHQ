/**
 * A11y gate — FamilyManagementScreen (Phase 4 / Task 17).
 *
 * Parent-only screen that lists active AND inactive members (the latter so
 * the parent can reactivate them) — both rows render.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FamilyManagementScreen } from '../features/family/FamilyManagementScreen';
import { ToastProvider } from '../hooks/useToast';
import { axeA11y, mkMember, mkParent, noop, noopAsync } from './fixtures';

const parent = mkParent({ id: 'uid-parent-a', name: 'Sarah Kim' });
const activeMember = mkMember({ id: 'uid-member-a', name: 'Maya Rivera', isActive: true });
const inactiveMember = mkMember({
  id: 'uid-member-c',
  name: 'Old Account',
  isActive: false,
});

describe('a11y — FamilyManagementScreen', () => {
  it('populated list (active + inactive members) has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <FamilyManagementScreen
          viewer={parent}
          members={[parent, activeMember, inactiveMember]}
          loading={false}
          error={null}
          onRename={noopAsync}
          onSetActive={noopAsync}
          onRefresh={noop}
        />
      </ToastProvider>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
