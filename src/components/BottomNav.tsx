import type { ReactElement } from 'react';

export type NavTab = 'dashboard' | 'calendar' | 'board' | 'chores';

export interface BottomNavProps {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
}

interface TabDef {
  id: NavTab;
  label: string;
  icon: (filled: boolean) => ReactElement;
}

const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Home', icon: HomeIcon },
  { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { id: 'board', label: 'Board', icon: BoardIcon },
  { id: 'chores', label: 'Chores', icon: ChoresIcon },
];

/**
 * Primary navigation. The active tab carries aria-current="page" plus a colour
 * + bolder weight + filled icon — never colour alone (WCAG 1.4.1). Each tab is
 * a 44px-tall tap target.
 */
export function BottomNav(props: BottomNavProps): ReactElement {
  const { active, onNavigate } = props;

  return (
    <nav className="flex h-nav items-stretch border-t border-surface-line bg-surface-card">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onNavigate(tab.id)}
            className={`flex min-h-tap flex-1 flex-col items-center justify-center gap-4 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-inset ${isActive ? 'font-bold text-brand' : 'font-semibold text-ink-mute'}`}
          >
            <span className={isActive ? 'text-brand' : 'text-ink-mute2'}>{tab.icon(isActive)}</span>
            <span className="text-caption">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function iconClass(): string {
  return 'block h-24 w-24';
}

function HomeIcon(filled: boolean): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={iconClass()}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9z" strokeLinejoin="round" />
    </svg>
  );
}
function CalendarIcon(filled: boolean): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={iconClass()}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" strokeLinecap="round" />
    </svg>
  );
}
function BoardIcon(filled: boolean): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={iconClass()}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="14" rx="2" />
      <path d="M7 9h10M7 13h6" strokeLinecap="round" />
    </svg>
  );
}
function ChoresIcon(filled: boolean): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className={iconClass()}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M9 11l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}
