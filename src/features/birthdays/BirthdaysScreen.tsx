/**
 * BirthdaysScreen — props-injected list with add / edit / delete.
 *
 * Layout:
 *   - LOADING → Skeleton
 *   - ERROR → inline role=alert (single channel; never a toast)
 *   - EMPTY → friendly empty state
 *   - LIST → birthdays grouped by month (Jan-Dec), each row "Name — 06-15"
 *     with a "turning N" badge when birthYear is set
 *
 * Authority model: ANY active same-family member can CRUD (firestore.rules
 * is authoritative — see test/rules/birthdays.test.ts). UI affordances are
 * not gated by role.
 */
import { useId, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, BottomSheet, Button, EmptyState, Fab, Skeleton, TextField } from '../../components';
import {
  BIRTHDAY_NAME_MAX,
  isValidMonthDay,
  monthDayFromParts,
  type BirthdayWithId,
} from './birthdaysService';
import type { BirthdayType } from '../../lib/types';

export interface BirthdaysScreenProps {
  feed: {
    birthdays: BirthdayWithId[];
    loading: boolean;
    error: string | null;
  };
  onCreate?: (input: {
    name: string;
    monthDay: string;
    type: BirthdayType;
    birthYear?: number;
    note?: string;
  }) => Promise<void>;
  onEdit?: (
    birthdayId: string,
    patch: {
      name?: string;
      monthDay?: string;
      type?: BirthdayType;
      birthYear?: number | null;
      note?: string | null;
    },
  ) => Promise<void>;
  onDelete?: (birthdayId: string) => Promise<void>;
}

export function BirthdaysScreen(props: BirthdaysScreenProps): ReactElement {
  const { t } = useTranslation();
  const { feed, onCreate, onEdit, onDelete } = props;
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<BirthdayWithId | null>(null);

  const byMonth = useMemo(() => groupByMonth(feed.birthdays), [feed.birthdays]);

  return (
    <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
      <h1 className="text-display font-display font-extrabold text-ink">{t('birthdays.title')}</h1>

      {feed.loading && <Skeleton label={t('birthdays.loading')} />}
      {feed.error !== null && !feed.loading && (
        <p role="alert" className="text-meta text-status-danger-text">
          {feed.error}
        </p>
      )}

      {!feed.loading && feed.error === null && feed.birthdays.length === 0 && (
        <EmptyState message={t('birthdays.empty')} />
      )}

      {!feed.loading && feed.error === null && feed.birthdays.length > 0 && (
        <ul className="flex flex-col gap-16" aria-label={t('birthdays.listLabel')}>
          {byMonth.map(({ monthNum, monthLabel, items }) => (
            <li key={monthNum}>
              <MonthSection
                monthLabel={monthLabel}
                items={items}
                {...(onEdit !== undefined ? { onEdit: (b: BirthdayWithId) => setEditing(b) } : {})}
                {...(onDelete !== undefined ? { onDelete } : {})}
              />
            </li>
          ))}
        </ul>
      )}

      {onCreate !== undefined && (
        <Fab label={t('birthdays.action.create')} onClick={() => setCreateOpen(true)} />
      )}

      <CreateBirthdaySheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        {...(onCreate !== undefined ? { onCreate } : {})}
      />
      {editing !== null && onEdit !== undefined && (
        <EditBirthdaySheet birthday={editing} onClose={() => setEditing(null)} onEdit={onEdit} />
      )}
    </section>
  );
}

interface MonthGroup {
  monthNum: number;
  monthLabel: string;
  items: BirthdayWithId[];
}

function groupByMonth(items: BirthdayWithId[]): MonthGroup[] {
  const MONTH_LABELS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const map = new Map<number, BirthdayWithId[]>();
  for (const b of items) {
    const monthMatch = /^(\d{2})-(\d{2})$/.exec(b.monthDay);
    if (monthMatch === null) continue;
    const monthNum = Number.parseInt(monthMatch[1]!, 10);
    if (!map.has(monthNum)) map.set(monthNum, []);
    map.get(monthNum)!.push(b);
  }
  const out: MonthGroup[] = [];
  for (let m = 1; m <= 12; m++) {
    const list = map.get(m);
    if (list === undefined) continue;
    list.sort((a, b) => {
      const dayCmp = a.monthDay.localeCompare(b.monthDay);
      return dayCmp !== 0 ? dayCmp : a.name.localeCompare(b.name);
    });
    out.push({ monthNum: m, monthLabel: MONTH_LABELS[m - 1]!, items: list });
  }
  return out;
}

function MonthSection(props: {
  monthLabel: string;
  items: BirthdayWithId[];
  onEdit?: (b: BirthdayWithId) => void;
  onDelete?: (id: string) => Promise<void>;
}): ReactElement {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-8">
      <h2 id={headingId} className="text-title font-semibold text-ink">
        {props.monthLabel}
      </h2>
      <ul className="flex flex-col gap-8" aria-label={props.monthLabel}>
        {props.items.map((b) => (
          <li key={b.id}>
            <BirthdayRow
              birthday={b}
              {...(props.onEdit !== undefined ? { onEdit: props.onEdit } : {})}
              {...(props.onDelete !== undefined ? { onDelete: props.onDelete } : {})}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function BirthdayRow(props: {
  birthday: BirthdayWithId;
  onEdit?: (b: BirthdayWithId) => void;
  onDelete?: (id: string) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const { birthday, onEdit, onDelete } = props;
  const day = parseDayPart(birthday.monthDay);
  return (
    <article className="flex flex-col gap-8 rounded-card border border-surface-line bg-surface-card p-12">
      <div className="flex flex-wrap items-center gap-8">
        <h3 className="flex-1 text-body font-bold text-ink">{birthday.name}</h3>
        {birthday.type === 'anniversary' && (
          <Badge tone="indigo" size="sm">
            {t('birthdays.badge.anniversary')}
          </Badge>
        )}
        {day !== null && (
          <Badge tone="mute" size="sm">
            {t('birthdays.dayBadge', { day })}
          </Badge>
        )}
      </div>
      {birthday.note !== undefined && birthday.note !== '' && (
        <p className="text-meta text-ink-mute">{birthday.note}</p>
      )}
      <div className="flex flex-wrap justify-end gap-8">
        {onEdit !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(birthday)}
            aria-label={t('birthdays.action.editLabel', { name: birthday.name })}
          >
            {t('birthdays.action.edit')}
          </Button>
        )}
        {onDelete !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void onDelete(birthday.id)}
            aria-label={t('birthdays.action.deleteLabel', { name: birthday.name })}
          >
            {t('birthdays.action.delete')}
          </Button>
        )}
      </div>
    </article>
  );
}

function parseDayPart(monthDay: string): number | null {
  const m = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (m === null) return null;
  return Number.parseInt(m[2]!, 10);
}

interface BirthdayFormProps {
  initialName: string;
  initialMonthDay: string;
  initialType: BirthdayType;
  initialBirthYear: string;
  initialNote: string;
  submitLabel: string;
  onSubmit: (input: {
    name: string;
    monthDay: string;
    type: BirthdayType;
    birthYear?: number;
    note?: string;
  }) => Promise<void>;
  onClose: () => void;
}

function BirthdayForm(props: BirthdayFormProps): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState(props.initialName);
  const [monthDay, setMonthDay] = useState(props.initialMonthDay);
  const [type, setType] = useState<BirthdayType>(props.initialType);
  const [birthYear, setBirthYear] = useState(props.initialBirthYear);
  const [note, setNote] = useState(props.initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeId = useId();

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError(t('birthdays.error.nameRequired'));
      return;
    }
    if (trimmed.length > BIRTHDAY_NAME_MAX) {
      setError(t('birthdays.error.nameTooLong'));
      return;
    }
    if (!isValidMonthDay(monthDay)) {
      setError(t('birthdays.error.monthDayInvalid'));
      return;
    }
    let yearNum: number | undefined;
    if (birthYear.trim() !== '') {
      yearNum = Number.parseInt(birthYear, 10);
      if (!Number.isFinite(yearNum)) {
        setError(t('birthdays.error.birthYearInvalid'));
        return;
      }
    }
    setBusy(true);
    try {
      await props.onSubmit({
        name: trimmed,
        monthDay,
        type,
        ...(yearNum !== undefined ? { birthYear: yearNum } : {}),
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
      });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('birthdays.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
      <TextField label={t('birthdays.form.nameLabel')} value={name} onChange={setName} required />
      <MonthDayInput
        label={t('birthdays.form.monthDayLabel')}
        value={monthDay}
        onChange={setMonthDay}
      />
      <div className="flex flex-col gap-4">
        <label htmlFor={typeId} className="text-label font-semibold text-ink-2">
          {t('birthdays.form.typeLabel')}
        </label>
        <select
          id={typeId}
          value={type}
          onChange={(e) => setType(e.target.value as BirthdayType)}
          className="min-h-tap rounded-control border border-surface-line bg-surface-card px-12 text-body text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          <option value="birthday">{t('birthdays.form.typeBirthday')}</option>
          <option value="anniversary">{t('birthdays.form.typeAnniversary')}</option>
        </select>
      </div>
      <TextField
        label={t('birthdays.form.birthYearLabel')}
        value={birthYear}
        onChange={setBirthYear}
        placeholder="YYYY"
      />
      <TextField label={t('birthdays.form.noteLabel')} value={note} onChange={setNote} />
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
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

function MonthDayInput(props: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const monthId = useId();
  const dayId = useId();
  const parsed = parseMonthDay(props.value);
  const monthValue = parsed?.month ?? '';
  const dayValue = parsed?.day ?? '';

  const set = (m: string, d: string): void => {
    const mNum = Number.parseInt(m, 10);
    const dNum = Number.parseInt(d, 10);
    if (Number.isFinite(mNum) && Number.isFinite(dNum) && mNum >= 1 && mNum <= 12 && dNum >= 1) {
      props.onChange(monthDayFromParts(mNum, dNum));
    } else {
      props.onChange('');
    }
  };

  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-label font-semibold text-ink-2">{props.label}</legend>
      <div className="flex gap-8">
        <div className="flex flex-1 flex-col gap-4">
          <label htmlFor={monthId} className="text-meta text-ink-mute">
            {t('birthdays.form.monthLabel')}
          </label>
          <select
            id={monthId}
            value={monthValue}
            onChange={(e) => set(e.target.value, dayValue !== '' ? dayValue : '1')}
            className="min-h-tap rounded-control border border-surface-line bg-surface-card px-12 text-body text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            <option value="">{t('birthdays.form.monthPlaceholder')}</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={String(m)}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-1/3 flex-col gap-4">
          <label htmlFor={dayId} className="text-meta text-ink-mute">
            {t('birthdays.form.dayLabel')}
          </label>
          <input
            id={dayId}
            type="number"
            min={1}
            max={31}
            value={dayValue}
            onChange={(e) => set(monthValue !== '' ? monthValue : '1', e.target.value)}
            className="min-h-tap rounded-control border border-surface-line bg-surface-card px-12 text-body text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          />
        </div>
      </div>
    </fieldset>
  );
}

function parseMonthDay(s: string): { month: string; day: string } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (m === null) return null;
  return { month: String(Number.parseInt(m[1]!, 10)), day: String(Number.parseInt(m[2]!, 10)) };
}

function monthName(m: number): string {
  return [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][m - 1]!;
}

interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate?: (input: {
    name: string;
    monthDay: string;
    type: BirthdayType;
    birthYear?: number;
    note?: string;
  }) => Promise<void>;
}

function CreateBirthdaySheet(props: CreateSheetProps): ReactElement | null {
  const { t } = useTranslation();
  if (!props.open || props.onCreate === undefined) return null;
  return (
    <BottomSheet open onClose={props.onClose} title={t('birthdays.create.title')}>
      <BirthdayForm
        initialName=""
        initialMonthDay=""
        initialType="birthday"
        initialBirthYear=""
        initialNote=""
        submitLabel={t('birthdays.create.submit')}
        onSubmit={props.onCreate}
        onClose={props.onClose}
      />
    </BottomSheet>
  );
}

interface EditSheetProps {
  birthday: BirthdayWithId;
  onClose: () => void;
  onEdit: (
    id: string,
    patch: {
      name?: string;
      monthDay?: string;
      type?: BirthdayType;
      birthYear?: number | null;
      note?: string | null;
    },
  ) => Promise<void>;
}

function EditBirthdaySheet(props: EditSheetProps): ReactElement {
  const { t } = useTranslation();
  return (
    <BottomSheet open onClose={props.onClose} title={t('birthdays.edit.title')}>
      <BirthdayForm
        initialName={props.birthday.name}
        initialMonthDay={props.birthday.monthDay}
        initialType={props.birthday.type}
        initialBirthYear={
          props.birthday.birthYear !== undefined ? String(props.birthday.birthYear) : ''
        }
        initialNote={props.birthday.note ?? ''}
        submitLabel={t('birthdays.edit.submit')}
        onSubmit={async (input) => {
          await props.onEdit(props.birthday.id, {
            name: input.name,
            monthDay: input.monthDay,
            type: input.type,
            birthYear: input.birthYear ?? null,
            note: input.note ?? null,
          });
        }}
        onClose={props.onClose}
      />
    </BottomSheet>
  );
}
