/**
 * Quick-add event bar — the natural-language capture surface (differentiator).
 *
 * A single text field: the user types "Soccer practice next Friday" and a LIVE
 * PREVIEW shows exactly what will be created (title · day · category) before
 * anything is written — a mis-parse can never silently create an event. On
 * submit it calls the SAME `onCreateEvent` path the AddEvent form uses (no new
 * write path, no rules change); the route supplies familyId/createdBy.
 *
 * This also fills a real gap: the AddEvent form only offers Today / Tomorrow, so
 * this is currently the ONLY way to create an event for an arbitrary day.
 *
 * Parsing is pure + injected-clock (parseNaturalEvent(text, now)); `now` is
 * derived from the screen's injected `today`, so this component reads no clock
 * and stays deterministic in tests.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, TextField } from '../../components';
import { useToast } from '../../hooks/useToast';
import type { EventTag } from '../../lib/types';
import { parseNaturalEvent } from './nlEventParser';

export interface QuickAddEventProps {
  today: { year: number; month: number; day: number };
  onCreateEvent: (input: {
    title: string;
    description: string;
    date: string;
    tag: EventTag;
  }) => Promise<void>;
}

function dayDelta(
  ymd: { year: number; month: number; day: number },
  today: { year: number; month: number; day: number },
): number {
  const a = Date.UTC(today.year, today.month, today.day);
  const b = Date.UTC(ymd.year, ymd.month, ymd.day);
  return Math.round((b - a) / 86400000);
}

export function QuickAddEvent(props: QuickAddEventProps): ReactElement {
  const { today, onCreateEvent } = props;
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  // Clock-free: build "now" from the injected `today` (noon avoids any
  // month-rollover ambiguity). Memoized so the parse is stable per keystroke.
  const now = useMemo(
    () => new Date(today.year, today.month, today.day, 12, 0, 0, 0),
    [today.year, today.month, today.day],
  );
  const parsed = useMemo(() => parseNaturalEvent(text, now), [text, now]);

  const preview = useMemo(() => {
    if (parsed === null) return null;
    const delta = dayDelta(parsed.ymd, today);
    const dayLabel =
      delta === 0
        ? t('calendar.quickAdd.today')
        : delta === 1
          ? t('calendar.quickAdd.tomorrow')
          : new Intl.DateTimeFormat(i18n.language, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(Date.UTC(parsed.ymd.year, parsed.ymd.month, parsed.ymd.day, 12)));
    return { dayLabel, tagLabel: t(`calendar.tag.${parsed.tag}`), parsed };
  }, [parsed, today, t, i18n.language]);

  const submit = (): void => {
    if (parsed === null || busy) return;
    setBusy(true);
    void onCreateEvent({ title: parsed.title, description: '', date: parsed.date, tag: parsed.tag })
      .then(() => {
        setText('');
        showToast(t('calendar.quickAdd.added'));
      })
      .catch(() => showToast(t('calendar.toast.generic')))
      .finally(() => setBusy(false));
  };

  const typed = text.trim().length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-8 rounded-card border border-surface-line bg-surface-card p-16"
    >
      <TextField
        label={t('calendar.quickAdd.label')}
        value={text}
        onChange={setText}
        placeholder={t('calendar.quickAdd.placeholder')}
        disabled={busy}
      />

      {/* Polite live region: announces the parsed result (or the hint) so a
          screen-reader user hears what will be created before submitting. */}
      <div role="status" aria-live="polite" className="min-h-tap">
        {preview !== null ? (
          <div className="flex flex-wrap items-center gap-8">
            <span className="text-body font-semibold text-ink">{preview.parsed.title}</span>
            <span aria-hidden="true" className="text-ink-mute">
              ·
            </span>
            <span className="text-meta font-semibold text-ink-2">
              {preview.dayLabel}
              {!preview.parsed.hadDate && (
                <span className="font-normal text-ink-mute">
                  {' '}
                  ({t('calendar.quickAdd.assumedToday')})
                </span>
              )}
            </span>
            <Badge tone={preview.parsed.tag} size="sm">
              {preview.tagLabel}
            </Badge>
          </div>
        ) : typed ? (
          <p className="text-meta text-ink-mute">{t('calendar.quickAdd.hint')}</p>
        ) : (
          <p className="text-meta text-ink-mute">{t('calendar.quickAdd.examples')}</p>
        )}
      </div>

      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={parsed === null || busy}
        loading={busy}
      >
        {t('calendar.quickAdd.add')}
      </Button>
    </form>
  );
}
