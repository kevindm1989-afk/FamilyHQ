/**
 * A11y gate — BoardScreen (Phase 4 / Task 17).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BoardScreen } from '../features/board/BoardScreen';
import { ToastProvider } from '../hooks/useToast';
import { axeA11y, mkMember, mkParent, mkPost, noopAsync } from './fixtures';

const parent = mkParent({ id: 'uid-parent-a', name: 'Sarah Kim' });
const child = mkMember({ id: 'uid-member-a', name: 'Maya Rivera' });

describe('a11y — BoardScreen', () => {
  it('populated feed (parent viewer) has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <BoardScreen
          familyId="fam-A"
          viewer={{ uid: parent.id, name: parent.name, role: 'parent' }}
          members={[parent, child]}
          feed={{
            posts: [
              mkPost({ id: 'p1', content: 'Family movie night tonight!' }),
              mkPost({
                id: 'p2',
                content: 'Reminder: dentist Friday',
                authorId: child.id,
                authorName: child.name,
              }),
            ],
            loading: false,
            error: null,
            refresh: noopAsync,
          }}
          onDeletePost={noopAsync}
          onCreatePost={noopAsync}
        />
      </ToastProvider>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });

  it('empty feed has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <BoardScreen
          familyId="fam-A"
          viewer={{ uid: parent.id, name: parent.name, role: 'parent' }}
          members={[parent, child]}
          feed={{ posts: [], loading: false, error: null, refresh: noopAsync }}
          onDeletePost={noopAsync}
          onCreatePost={noopAsync}
        />
      </ToastProvider>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
