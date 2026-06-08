/**
 * RoutinesPanel — props-injected screen contract.
 *
 * Pins:
 *  - state machine (loading / error / empty),
 *  - "My runs today" only shows the viewer's own running instances,
 *  - template Edit/Delete only render for the creator OR a parent
 *    viewer (mirrors Q-A rules),
 *  - Start button calls onStartInstance with the template id,
 *  - per-item checkbox toggles the dot-path patch via onToggleItem,
 *  - completed-instance "all done" badge appears when checked==total,
 *  - Create sheet rejects an empty title before calling onCreateTemplate.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';
import { RoutinesPanel } from './RoutinesPanel';
import type {
  ChecklistInstanceWithId,
  ChecklistTemplateWithId,
} from './checklistsService';

const SARAH: UserWithId = {
  id: 'uid-parent-a',
  name: 'Sarah',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const MAYA: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};
const OWEN: UserWithId = {
  id: 'uid-member-b',
  name: 'Owen',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

function mkTemplate(
  over: Partial<ChecklistTemplateWithId> & { id: string },
): ChecklistTemplateWithId {
  const now = Date.now();
  return {
    familyId: 'fam-A',
    createdBy: MAYA.id,
    title: 'Morning routine',
    isSharedWithFamily: true,
    items: [
      { id: 'i1', text: 'Brush teeth' },
      { id: 'i2', text: 'Make bed' },
    ],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function mkInstance(
  over: Partial<ChecklistInstanceWithId> & { id: string },
): ChecklistInstanceWithId {
  return {
    familyId: 'fam-A',
    templateId: 't1',
    userId: MAYA.id,
    date: '2026-06-05',
    isCompleted: false,
    itemsProgress: {},
    createdAt: 1000,
    ...over,
  };
}

function renderPanel(
  overrides: Partial<Parameters<typeof RoutinesPanel>[0]> = {},
): ReturnType<typeof render> {
  const viewer: { uid: string; name: string; role: Role } = overrides.viewer ?? {
    uid: MAYA.id,
    name: MAYA.name,
    role: MAYA.role,
  };
  const members = overrides.members ?? [SARAH, MAYA, OWEN];
  const templatesFeed = overrides.templatesFeed ?? {
    templates: [],
    loading: false,
    error: null,
  };
  const instancesFeed = overrides.instancesFeed ?? {
    instances: [],
    loading: false,
    error: null,
  };
  return render(
    <RoutinesPanel
      viewer={viewer}
      members={members}
      templatesFeed={templatesFeed}
      instancesFeed={instancesFeed}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('RoutinesPanel — state machine', () => {
  it('renders Skeleton when either feed is loading', () => {
    renderPanel({
      templatesFeed: { templates: [], loading: true, error: null },
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an inline error when either feed errored', () => {
    renderPanel({
      templatesFeed: {
        templates: [],
        loading: false,
        error: 'We could not load routines. Please try again.',
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load routines/i);
  });

  it('renders empty states for both sections when neither has content', () => {
    renderPanel({});
    expect(screen.getByText(/no active runs/i)).toBeInTheDocument();
    expect(screen.getByText(/no routines yet/i)).toBeInTheDocument();
  });
});

describe('RoutinesPanel — "My runs today" section', () => {
  it("shows only the viewer's own running instances (filters by userId)", () => {
    renderPanel({
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', title: 'Morning' })],
        loading: false,
        error: null,
      },
      instancesFeed: {
        instances: [
          mkInstance({ id: 'mine', templateId: 't1', userId: MAYA.id }),
          mkInstance({ id: 'theirs', templateId: 't1', userId: OWEN.id }),
        ],
        loading: false,
        error: null,
      },
    });
    const myRuns = screen.getByRole('region', { name: /my runs today/i });
    const items = within(myRuns).getAllByText(/morning/i);
    // Only my instance — exactly one Morning card under My runs today.
    expect(items).toHaveLength(1);
  });

  it('fires onToggleItem with the dot-path-style (instanceId, itemId, checked) tuple', () => {
    const onToggleItem = vi.fn(async () => undefined);
    renderPanel({
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', title: 'Morning' })],
        loading: false,
        error: null,
      },
      instancesFeed: {
        instances: [mkInstance({ id: 'inst-1', templateId: 't1' })],
        loading: false,
        error: null,
      },
      onToggleItem,
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /check off brush teeth/i }));
    expect(onToggleItem).toHaveBeenCalledWith('inst-1', 'i1', true);
  });

  it('shows the "All done" badge when every item is checked', () => {
    renderPanel({
      templatesFeed: {
        templates: [mkTemplate({ id: 't1' })],
        loading: false,
        error: null,
      },
      instancesFeed: {
        instances: [
          mkInstance({
            id: 'inst-1',
            templateId: 't1',
            itemsProgress: { i1: true, i2: true },
          }),
        ],
        loading: false,
        error: null,
      },
    });
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
  });

  it('fires onCompleteInstance(true) when the Done button is tapped', () => {
    const onCompleteInstance = vi.fn(async () => undefined);
    renderPanel({
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', title: 'Morning' })],
        loading: false,
        error: null,
      },
      instancesFeed: {
        instances: [mkInstance({ id: 'inst-1', templateId: 't1' })],
        loading: false,
        error: null,
      },
      onCompleteInstance,
    });
    fireEvent.click(screen.getByRole('button', { name: /mark morning run done/i }));
    expect(onCompleteInstance).toHaveBeenCalledWith('inst-1', true);
  });
});

describe('RoutinesPanel — templates section + role gating', () => {
  it('renders Start on a shared template and fires onStartInstance(templateId)', () => {
    const onStartInstance = vi.fn(async () => undefined);
    renderPanel({
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', title: 'Morning' })],
        loading: false,
        error: null,
      },
      onStartInstance,
    });
    fireEvent.click(screen.getByRole('button', { name: /start a run of morning/i }));
    expect(onStartInstance).toHaveBeenCalledWith('t1');
  });

  it('renders Edit + Delete to the CREATOR (Q-A: creator can edit own)', () => {
    renderPanel({
      viewer: { uid: MAYA.id, name: MAYA.name, role: MAYA.role },
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', title: 'Morning', createdBy: MAYA.id })],
        loading: false,
        error: null,
      },
      onEditTemplate: vi.fn(async () => undefined),
      onDeleteTemplate: vi.fn(async () => undefined),
    });
    expect(screen.getByRole('button', { name: /edit morning/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete morning/i })).toBeInTheDocument();
  });

  it('renders Edit + Delete to a same-family PARENT (Q-A: parents can edit any)', () => {
    renderPanel({
      viewer: { uid: SARAH.id, name: SARAH.name, role: SARAH.role },
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', title: 'Morning', createdBy: MAYA.id })],
        loading: false,
        error: null,
      },
      onEditTemplate: vi.fn(async () => undefined),
      onDeleteTemplate: vi.fn(async () => undefined),
    });
    expect(screen.getByRole('button', { name: /edit morning/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete morning/i })).toBeInTheDocument();
  });

  it('does NOT render Edit / Delete to a non-creator non-parent (Q-A: sibling-prank prevention)', () => {
    renderPanel({
      viewer: { uid: OWEN.id, name: OWEN.name, role: OWEN.role },
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', title: 'Morning', createdBy: MAYA.id })],
        loading: false,
        error: null,
      },
      onStartInstance: vi.fn(async () => undefined),
      onEditTemplate: vi.fn(async () => undefined),
      onDeleteTemplate: vi.fn(async () => undefined),
    });
    expect(screen.queryByRole('button', { name: /edit morning/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete morning/i })).not.toBeInTheDocument();
    // Start is still available — anyone in the family can start a run.
    expect(screen.getByRole('button', { name: /start a run of morning/i })).toBeInTheDocument();
  });

  it('badges a draft (isSharedWithFamily=false) template as Draft', () => {
    renderPanel({
      templatesFeed: {
        templates: [mkTemplate({ id: 't1', isSharedWithFamily: false })],
        loading: false,
        error: null,
      },
    });
    expect(screen.getByText(/^draft$/i)).toBeInTheDocument();
  });
});

describe('RoutinesPanel — create sheet', () => {
  it('shows the "+ New routine" FAB only when onCreateTemplate is provided', () => {
    const { rerender } = renderPanel({});
    expect(screen.queryByRole('button', { name: /new routine/i })).not.toBeInTheDocument();
    rerender(
      <RoutinesPanel
        viewer={{ uid: MAYA.id, name: MAYA.name, role: MAYA.role }}
        members={[SARAH, MAYA]}
        templatesFeed={{ templates: [], loading: false, error: null }}
        instancesFeed={{ instances: [], loading: false, error: null }}
        onCreateTemplate={vi.fn(async () => undefined)}
      />,
    );
    expect(screen.getByRole('button', { name: /new routine/i })).toBeInTheDocument();
  });

  it('opens the sheet and rejects an empty title before calling onCreateTemplate', async () => {
    const onCreateTemplate = vi.fn(async () => undefined);
    renderPanel({ onCreateTemplate });
    fireEvent.click(screen.getByRole('button', { name: /new routine/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.submit(
      within(sheet).getByRole('button', { name: /create routine/i }).closest('form')!,
    );
    expect(within(sheet).getByRole('alert')).toHaveTextContent(/please give the routine a title/i);
    expect(onCreateTemplate).not.toHaveBeenCalled();
  });

  it('submits with title + items + isSharedWithFamily', async () => {
    const onCreateTemplate = vi.fn(async () => undefined);
    renderPanel({ onCreateTemplate });
    fireEvent.click(screen.getByRole('button', { name: /new routine/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByLabelText(/what's this routine for/i), {
      target: { value: 'Morning routine' },
    });
    fireEvent.change(within(sheet).getByRole('textbox', { name: /^item 1$/i }), {
      target: { value: 'Brush teeth' },
    });
    fireEvent.submit(
      within(sheet).getByRole('button', { name: /create routine/i }).closest('form')!,
    );
    await waitFor(() => {
      expect(onCreateTemplate).toHaveBeenCalledTimes(1);
    });
    const call = onCreateTemplate.mock.calls[0];
    if (call === undefined) throw new Error('onCreateTemplate was not called');
    const arg = (call as unknown[])[0] as {
      title: string;
      isSharedWithFamily: boolean;
      items: { text: string }[];
    };
    expect(arg.title).toBe('Morning routine');
    expect(arg.isSharedWithFamily).toBe(true);
    expect(arg.items.map((i) => i.text)).toEqual(['Brush teeth']);
  });
});
