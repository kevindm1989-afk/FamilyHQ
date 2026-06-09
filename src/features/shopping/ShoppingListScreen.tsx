/**
 * ShoppingListScreen — props-injected shared family shopping list.
 *
 * Layout:
 *   - Header
 *   - Inline "Add item" row at the top (Enter or tap "+" to submit)
 *   - LOADING → Skeleton
 *   - ERROR → role=alert inline
 *   - OPEN list (unchecked items, oldest-first so additions stay
 *     in arrival order on the phone)
 *   - CHECKED list (collapsed below; shows who checked + when),
 *     with a "Clear checked" button when there's anything checked
 *   - Per-row: checkbox + name (+ optional quantity badge) +
 *     addedBy name + Edit + Delete
 *
 * Authority model: ANY active same-family member has full CRUD
 * (firestore.rules is authoritative — see test/rules/shoppingItems.test.ts).
 * UI affordances are not gated by role.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, BottomSheet, Button, EmptyState, Skeleton, TextField } from '../../components';
import type { UserWithId } from '../../lib/types';
import { SHOPPING_NAME_MAX, type ShoppingItemWithId } from './shoppingListService';
import { relativeTime } from '../board/relativeTime';

export interface ShoppingListScreenProps {
  viewer: { uid: string; name: string };
  members: UserWithId[];
  /** Deterministic "now" (ms) for relativeTime. */
  nowMs: number;
  feed: {
    items: ShoppingItemWithId[];
    loading: boolean;
    error: string | null;
  };
  onAdd?: (input: { name: string; quantity?: string }) => Promise<void>;
  onToggleChecked?: (itemId: string, checked: boolean) => Promise<void>;
  onEdit?: (
    itemId: string,
    patch: { name?: string; quantity?: string | null; category?: string | null },
  ) => Promise<void>;
  onDelete?: (itemId: string) => Promise<void>;
  /** Sweep — receives the ids of all currently-checked items. */
  onClearChecked?: (ids: string[]) => Promise<void>;
}

export function ShoppingListScreen(props: ShoppingListScreenProps): ReactElement {
  const { t } = useTranslation();
  const { members, nowMs, feed, onAdd, onToggleChecked, onEdit, onDelete, onClearChecked } = props;
  const [editing, setEditing] = useState<ShoppingItemWithId | null>(null);

  const grouped = useMemo(() => {
    const open: ShoppingItemWithId[] = [];
    const checked: ShoppingItemWithId[] = [];
    for (const item of feed.items) {
      (item.isChecked ? checked : open).push(item);
    }
    open.sort((a, b) => a.createdAt - b.createdAt);
    checked.sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0));
    return { open, checked };
  }, [feed.items]);

  const nameFor = (uid: string): string =>
    members.find((m) => m.id === uid)?.name ?? t('shopping.unknownMember');

  return (
    <section aria-label={t('shopping.title')} className="flex flex-col gap-16 px-16 pt-4 pb-24">
      <h1 className="text-display font-display font-extrabold text-ink">{t('shopping.title')}</h1>

      {onAdd !== undefined && <AddItemRow onAdd={onAdd} />}

      {feed.loading && <Skeleton label={t('shopping.loading')} />}
      {feed.error !== null && !feed.loading && (
        <p role="alert" className="text-meta text-status-danger-text">
          {feed.error}
        </p>
      )}

      {!feed.loading && feed.error === null && (
        <>
          <section aria-labelledby="open-items-heading" className="flex flex-col gap-8">
            <h2 id="open-items-heading" className="text-title font-semibold text-ink">
              {t('shopping.section.open')}
            </h2>
            {grouped.open.length === 0 ? (
              <EmptyState message={t('shopping.section.openEmpty')} />
            ) : (
              <ul className="flex flex-col gap-8" aria-label={t('shopping.section.open')}>
                {grouped.open.map((item) => (
                  <li key={item.id}>
                    <ItemRow
                      item={item}
                      addedByName={nameFor(item.addedBy)}
                      nowMs={nowMs}
                      {...(onToggleChecked !== undefined ? { onToggleChecked } : {})}
                      {...(onEdit !== undefined
                        ? { onEdit: (i: ShoppingItemWithId) => setEditing(i) }
                        : {})}
                      {...(onDelete !== undefined ? { onDelete } : {})}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {grouped.checked.length > 0 && (
            <section aria-labelledby="checked-items-heading" className="flex flex-col gap-8">
              <div className="flex flex-wrap items-center justify-between gap-8">
                <h2 id="checked-items-heading" className="text-title font-semibold text-ink">
                  {t('shopping.section.checked')}
                </h2>
                {onClearChecked !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void onClearChecked(grouped.checked.map((i) => i.id))}
                  >
                    {t('shopping.action.clearChecked')}
                  </Button>
                )}
              </div>
              <ul className="flex flex-col gap-8" aria-label={t('shopping.section.checked')}>
                {grouped.checked.map((item) => (
                  <li key={item.id}>
                    <ItemRow
                      item={item}
                      addedByName={nameFor(item.addedBy)}
                      checkedByName={item.checkedBy !== undefined ? nameFor(item.checkedBy) : null}
                      nowMs={nowMs}
                      {...(onToggleChecked !== undefined ? { onToggleChecked } : {})}
                      {...(onDelete !== undefined ? { onDelete } : {})}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {editing !== null && onEdit !== undefined && (
        <EditItemSheet item={editing} onClose={() => setEditing(null)} onEdit={onEdit} />
      )}
    </section>
  );
}

interface AddItemRowProps {
  onAdd: (input: { name: string; quantity?: string }) => Promise<void>;
}

function AddItemRow(props: AddItemRowProps): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(t('shopping.error.nameRequired'));
      return;
    }
    if (trimmed.length > SHOPPING_NAME_MAX) {
      setError(t('shopping.error.nameTooLong'));
      return;
    }
    setBusy(true);
    try {
      await props.onAdd({ name: trimmed });
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('shopping.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4 rounded-card border border-surface-line bg-surface-card p-12"
      onSubmit={handleSubmit}
    >
      <div className="flex items-end gap-8">
        <div className="flex-1">
          <TextField label={t('shopping.add.label')} value={name} onChange={setName} />
        </div>
        <Button type="submit" loading={busy}>
          {t('shopping.add.submit')}
        </Button>
      </div>
      {error !== null && (
        <p role="alert" className="text-meta text-status-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}

interface ItemRowProps {
  item: ShoppingItemWithId;
  addedByName: string;
  checkedByName?: string | null;
  nowMs: number;
  onToggleChecked?: (itemId: string, checked: boolean) => Promise<void>;
  onEdit?: (item: ShoppingItemWithId) => void;
  onDelete?: (itemId: string) => Promise<void>;
}

function ItemRow(props: ItemRowProps): ReactElement {
  const { t } = useTranslation();
  const { item, addedByName, checkedByName, nowMs, onToggleChecked, onEdit, onDelete } = props;
  return (
    <article className="flex flex-col gap-6 rounded-card border border-surface-line bg-surface-card p-12">
      <div className="flex items-start gap-12">
        {onToggleChecked !== undefined && (
          <input
            type="checkbox"
            className="mt-4 h-20 w-20 cursor-pointer rounded border-surface-line text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            checked={item.isChecked}
            onChange={(e) => void onToggleChecked(item.id, e.target.checked)}
            aria-label={
              item.isChecked
                ? t('shopping.action.uncheckLabel', { name: item.name })
                : t('shopping.action.checkLabel', { name: item.name })
            }
          />
        )}
        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-8">
            <span
              className={`flex-1 text-body font-semibold ${item.isChecked ? 'text-ink-mute line-through' : 'text-ink'}`}
            >
              {item.name}
            </span>
            {item.quantity !== undefined && item.quantity !== '' && (
              <Badge tone="mute" size="sm">
                {item.quantity}
              </Badge>
            )}
            {item.category !== undefined && item.category !== '' && (
              <Badge tone="info" size="sm">
                {item.category}
              </Badge>
            )}
          </div>
          <p className="text-caption text-ink-mute2">
            {item.isChecked && checkedByName !== null && checkedByName !== undefined
              ? t('shopping.checkedBy', {
                  name: checkedByName,
                  when: item.checkedAt !== undefined ? relativeTime(item.checkedAt, nowMs) : '',
                })
              : t('shopping.addedBy', { name: addedByName })}
          </p>
        </div>
      </div>
      {(onEdit !== undefined || onDelete !== undefined) && (
        <div className="flex flex-wrap justify-end gap-8">
          {onEdit !== undefined && !item.isChecked && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(item)}
              aria-label={t('shopping.action.editLabel', { name: item.name })}
            >
              {t('shopping.action.edit')}
            </Button>
          )}
          {onDelete !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDelete(item.id)}
              aria-label={t('shopping.action.deleteLabel', { name: item.name })}
            >
              {t('shopping.action.delete')}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

interface EditSheetProps {
  item: ShoppingItemWithId;
  onClose: () => void;
  onEdit: (
    itemId: string,
    patch: { name?: string; quantity?: string | null; category?: string | null },
  ) => Promise<void>;
}

function EditItemSheet(props: EditSheetProps): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState(props.item.name);
  const [quantity, setQuantity] = useState(props.item.quantity ?? '');
  const [category, setCategory] = useState(props.item.category ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError(t('shopping.error.nameRequired'));
      return;
    }
    if (trimmedName.length > SHOPPING_NAME_MAX) {
      setError(t('shopping.error.nameTooLong'));
      return;
    }
    setBusy(true);
    try {
      const patch: Parameters<typeof props.onEdit>[1] = {};
      if (trimmedName !== props.item.name) patch.name = trimmedName;
      const trimmedQ = quantity.trim();
      const prevQ = props.item.quantity ?? '';
      if (trimmedQ !== prevQ) patch.quantity = trimmedQ === '' ? null : trimmedQ;
      const trimmedC = category.trim();
      const prevC = props.item.category ?? '';
      if (trimmedC !== prevC) patch.category = trimmedC === '' ? null : trimmedC;
      await props.onEdit(props.item.id, patch);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('shopping.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open onClose={props.onClose} title={t('shopping.edit.title')}>
      <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
        <TextField label={t('shopping.add.label')} value={name} onChange={setName} required />
        <TextField
          label={t('shopping.form.quantityLabel')}
          value={quantity}
          onChange={setQuantity}
        />
        <TextField
          label={t('shopping.form.categoryLabel')}
          value={category}
          onChange={setCategory}
        />
        {error !== null && (
          <p role="alert" className="text-meta text-status-danger-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-8">
          <Button variant="ghost" type="button" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={busy}>
            {t('shopping.edit.submit')}
          </Button>
        </div>
      </form>
    </BottomSheet>
  );
}
