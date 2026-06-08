/**
 * Remaining shared primitives — contract (Task 6).
 *
 * Badge, Card, TextField, TopBar, BottomNav, Fab, Toast, BottomSheet,
 * EmptyState, Skeleton. Behavior/role/attributes only (tokens own pixels).
 *
 * FAILS today: each primitive is a declare-only contract stub (render throws).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  type BadgeTone,
  BottomNav,
  BottomSheet,
  Card,
  EmptyState,
  Fab,
  Skeleton,
  TextField,
  Toast,
  TopBar,
} from './index';

describe('Badge — documented tones', () => {
  const TONES: BadgeTone[] = [
    'mute',
    'indigo',
    'amber',
    'ok',
    'info',
    'danger',
    'school',
    'sports',
    'family',
    'work',
  ];
  for (const tone of TONES) {
    it(`renders the ${tone} tone with its text label`, () => {
      render(<Badge tone={tone}>3</Badge>);
      expect(screen.getByText('3')).toBeInTheDocument();
    });
  }

  it('always renders a text/label child (color is never the sole signal)', () => {
    render(<Badge tone="amber">Action needed</Badge>);
    expect(screen.getByText('Action needed')).toBeInTheDocument();
  });
});

describe('Card', () => {
  it('renders its children', () => {
    render(
      <Card>
        <span>Today</span>
      </Card>,
    );
    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('is a real button and fires onClick when interactive', () => {
    const onClick = vi.fn();
    render(
      <Card onClick={onClick}>
        <span>Tap me</span>
      </Card>,
    );
    const card = screen.getByRole('button');
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is NOT a button when non-interactive (no onClick)', () => {
    render(
      <Card>
        <span>Static</span>
      </Card>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('TextField', () => {
  it('associates the label with the input (WCAG 3.3.2)', () => {
    render(<TextField label="Email" value="" onChange={vi.fn()} type="email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'email');
  });

  it('reports the typed value through onChange', () => {
    const onChange = vi.fn();
    render(<TextField label="Family name" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Family name'), {
      target: { value: 'Smiths' },
    });
    expect(onChange).toHaveBeenCalledWith('Smiths');
  });

  it('marks the field invalid and associates the error text when error is set', () => {
    render(
      <TextField
        label="Email"
        value="x"
        onChange={vi.fn()}
        error="Enter a valid email"
      />,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy, 'error text must be programmatically associated').toBeTruthy();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
  });

  it('does not set aria-invalid when there is no error', () => {
    render(<TextField label="Email" value="x" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('announces the error via an assertive live region (role=alert) (a11y finding)', () => {
    // aria-describedby alone does not announce a newly-appearing error; the
    // error element must be role=alert (or in an assertive live region) so AT
    // announces it when validation fails (WCAG 3.3.1 / 4.1.3).
    render(
      <TextField
        label="Email"
        value="x"
        onChange={vi.fn()}
        error="Enter a valid email"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(
      alert,
      'the error text must be exposed as an alert / assertive live region',
    ).toHaveTextContent('Enter a valid email');

    // It must STILL be programmatically associated with the input.
    const input = screen.getByLabelText('Email');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy, 'error must remain associated via aria-describedby').toBeTruthy();
    expect(alert.id).toBe(describedBy);
  });

  it('does not render an alert region when there is no error', () => {
    render(<TextField label="Email" value="x" onChange={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('masks input when type is password', () => {
    render(
      <TextField label="Password" value="" onChange={vi.fn()} type="password" />,
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
});

describe('TopBar', () => {
  it('renders the centered title', () => {
    render(<TopBar title="Add Chore" />);
    expect(screen.getByText('Add Chore')).toBeInTheDocument();
  });

  it('shows a labeled Back button only when onBack is provided', () => {
    const onBack = vi.fn();
    render(<TopBar title="Add Chore" onBack={onBack} />);
    const back = screen.getByRole('button', { name: /back/i });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('omits the Back button on a top-level screen (no onBack)', () => {
    render(<TopBar title="Dashboard" />);
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
  });
});

describe('BottomNav', () => {
  const TABS = ['dashboard', 'calendar', 'board', 'chores', 'tasks'] as const;

  it('renders all five tabs', () => {
    render(<BottomNav active="dashboard" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /calendar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /board/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /chores/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tasks/i })).toBeInTheDocument();
  });

  it('marks the active tab with aria-current=page (not color alone)', () => {
    render(<BottomNav active="board" onNavigate={vi.fn()} />);
    const board = screen.getByRole('button', { name: /board/i });
    expect(board).toHaveAttribute('aria-current', 'page');
  });

  it('fires onNavigate with the tapped tab id', () => {
    const onNavigate = vi.fn();
    render(<BottomNav active="dashboard" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /calendar/i }));
    expect(onNavigate).toHaveBeenCalledWith('calendar');
  });

  for (const tab of TABS) {
    it(`tab ${tab} meets the 44px tap target`, () => {
      render(<BottomNav active="dashboard" onNavigate={vi.fn()} />);
      const re = new RegExp(tab === 'dashboard' ? 'home' : tab, 'i');
      expect(screen.getByRole('button', { name: re }).className).toMatch(/min-h-tap/);
    });
  }

  it('fires onNavigate with "tasks" when the 5th tab is tapped', () => {
    const onNavigate = vi.fn();
    render(<BottomNav active="dashboard" onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: /tasks/i }));
    expect(onNavigate).toHaveBeenCalledWith('tasks');
  });

  it('renders FRENCH labels when the i18n language is fr', async () => {
    const { default: i18n } = await import('../i18n');
    const original = i18n.language;
    await i18n.changeLanguage('fr');
    try {
      render(<BottomNav active="dashboard" onNavigate={vi.fn()} />);
      expect(screen.getByRole('button', { name: /accueil/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /calendrier/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /babillard/i })).toBeInTheDocument();
      // "Tâches" for chores (matches the chores screen heading) and
      // "Listes" for tasks (covers To-Do + Routines without colliding).
      expect(screen.getByRole('button', { name: /tâches/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /listes/i })).toBeInTheDocument();
    } finally {
      // Restore so other tests in the same worker see EN again.
      await i18n.changeLanguage(original);
    }
  });
});

describe('Fab', () => {
  it('exposes the required accessible label', () => {
    render(<Fab label="Add event" onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Add event' })).toBeInTheDocument();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Fab label="Add" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('Toast', () => {
  it('renders the message in a polite live region so it is announced', () => {
    render(<Toast message="Marked complete — waiting for approval" />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Marked complete — waiting for approval');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });
});

describe('BottomSheet', () => {
  it('renders nothing visible when closed', () => {
    render(
      <BottomSheet open={false} title="New post" onClose={vi.fn()}>
        <span>Body</span>
      </BottomSheet>,
    );
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('renders as a modal dialog with its title when open', () => {
    render(
      <BottomSheet open title="New post" onClose={vi.fn()}>
        <span>Body</span>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('New post')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('calls onClose when the close control is activated', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open title="New post" onClose={onClose}>
        <span>Body</span>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('EmptyState', () => {
  it('renders its friendly message', () => {
    render(<EmptyState message="Nothing scheduled — enjoy the day." />);
    expect(
      screen.getByText('Nothing scheduled — enjoy the day.'),
    ).toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('exposes a busy/loading affordance for assistive tech', () => {
    render(<Skeleton label="Loading chores" />);
    const region = screen.getByText('Loading chores');
    expect(region).toBeInTheDocument();
  });
});
