/**
 * A11y gate — CalendarScreen (Phase 4 / Task 17).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CalendarScreen } from '../features/calendar/CalendarScreen';
import { ToastProvider } from '../hooks/useToast';
import { axeA11y, mkEvent, mkMember, mkParent, noopAsync } from './fixtures';

const parent = mkParent({ id: 'uid-parent-a', name: 'Sarah Kim' });
const child = mkMember({ id: 'uid-member-a', name: 'Maya Rivera' });

describe('a11y — CalendarScreen', () => {
  it('populated month grid has no axe violations', async () => {
    const { container } = render(
      <ToastProvider>
        <CalendarScreen
          familyId="fam-A"
          viewer={{ uid: parent.id, name: parent.name, role: 'parent' }}
          members={[parent, child]}
          today={{ year: 2026, month: 6, day: 15 }}
          feed={{
            events: [
              mkEvent({ id: 'e1', title: 'Soccer practice', tag: 'sports' }),
              mkEvent({ id: 'e2', title: 'School play', tag: 'school', date: '2026-06-22T18:00:00.000Z' }),
            ],
            loading: false,
            error: null,
            refresh: noopAsync,
          }}
          onDeleteEvent={noopAsync}
          onCreateEvent={noopAsync}
        />
      </ToastProvider>,
    );
    expect(await axeA11y(container)).toHaveNoViolations();
  });
});
