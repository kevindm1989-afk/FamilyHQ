import { describe, it, expect } from 'vitest';
import {
  aggregateUsage,
  aggregateErrors,
  renderMarkdown,
  ACTIVATION_FUNNEL,
  type UsageDoc,
  type ErrorDoc,
} from '../src/insights/aggregate.js';

describe('aggregateUsage', () => {
  const docs: UsageDoc[] = [
    { event: 'family_created', day: '2026-07-01' },
    { event: 'family_created', day: '2026-07-02' },
    { event: 'child_created', day: '2026-07-02' },
    { event: 'chore_created', day: '2026-07-02' },
    { event: 'chore_created', day: '2026-07-03' },
    { event: 'chore_approved', day: '2026-07-03' },
    { event: 'not_an_event', day: '2026-07-03' }, // legacy/stray — ignored
  ];

  it('totals every allow-listed event (including zero-count ones) and ignores stray events', () => {
    const s = aggregateUsage(docs);
    const map = Object.fromEntries(s.totalsByEvent.map((t) => [t.event, t.count]));
    expect(map.family_created).toBe(2);
    expect(map.child_created).toBe(1);
    expect(map.chore_created).toBe(2);
    expect(map.chore_approved).toBe(1);
    // zero-count events still appear
    expect(map.wishlist_redeemed).toBe(0);
    expect(map.calendar_event_created).toBe(0);
    // stray event excluded from the total
    expect(s.total).toBe(6);
    expect(s.totalsByEvent.some((t) => t.event === 'not_an_event')).toBe(false);
  });

  it('buckets by day, sorted ascending, and counts distinct active days', () => {
    const s = aggregateUsage(docs);
    expect(s.byDay.map((d) => d.day)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
    expect(s.byDay.find((d) => d.day === '2026-07-02')?.total).toBe(3);
    expect(s.activeDays).toBe(3);
  });

  it('builds the activation funnel with pctOfPrev ratios (first step null)', () => {
    const s = aggregateUsage(docs);
    expect(s.activationFunnel.map((f) => f.step)).toEqual([...ACTIVATION_FUNNEL]);
    const [family, child, chore, approved, redeemed] = s.activationFunnel;
    expect(family?.count).toBe(2);
    expect(family?.pctOfPrev).toBeNull();
    expect(child?.count).toBe(1);
    expect(child?.pctOfPrev).toBe(0.5); // 1/2
    expect(chore?.count).toBe(2);
    expect(chore?.pctOfPrev).toBe(2); // 2/1 — can exceed 1 (independent counts)
    expect(approved?.count).toBe(1);
    expect(redeemed?.count).toBe(0);
    expect(redeemed?.pctOfPrev).toBe(0); // 0/1
  });

  it('a zero previous step yields pctOfPrev 0, never NaN/Infinity', () => {
    const s = aggregateUsage([{ event: 'child_created', day: '2026-07-01' }]);
    // family_created is 0, child_created is 1 → 1/0 must be reported as 0, not Infinity
    const child = s.activationFunnel.find((f) => f.step === 'child_created');
    expect(child?.pctOfPrev).toBe(0);
    expect(Number.isFinite(child?.pctOfPrev ?? 0)).toBe(true);
  });

  it('empty input is safe', () => {
    const s = aggregateUsage([]);
    expect(s.total).toBe(0);
    expect(s.activeDays).toBe(0);
    expect(s.byDay).toEqual([]);
    expect(s.totalsByEvent).toHaveLength(7);
  });
});

describe('aggregateErrors', () => {
  const errs: ErrorDoc[] = [
    { name: 'TypeError', message: 'x', stackHead: 'at f', route: '/chores', day: '2026-07-02' },
    { name: 'TypeError', message: 'x', stackHead: 'at f', route: '/chores', day: '2026-07-02' },
    { name: 'TypeError', message: 'y', stackHead: 'at g', route: '/board', day: '2026-07-03' },
    { name: 'RangeError', message: 'z', stackHead: 'at h', route: '/chores', day: '2026-07-03' },
  ];

  it('groups by name+route, sorted by count desc', () => {
    const s = aggregateErrors(errs);
    expect(s.total).toBe(4);
    expect(s.topByNameRoute[0]).toEqual({ name: 'TypeError', route: '/chores', count: 2 });
    // ties broken deterministically by key asc
    const rest = s.topByNameRoute.slice(1).map((g) => `${g.name} ${g.route}`);
    expect(rest).toEqual(['RangeError /chores', 'TypeError /board']);
  });

  it('respects topN', () => {
    expect(aggregateErrors(errs, 1)).toMatchObject({ total: 4 });
    expect(aggregateErrors(errs, 1).topByNameRoute).toHaveLength(1);
  });

  it('buckets errors by day ascending', () => {
    const s = aggregateErrors(errs);
    expect(s.byDay).toEqual([
      { day: '2026-07-02', total: 2 },
      { day: '2026-07-03', total: 2 },
    ]);
  });
});

describe('renderMarkdown', () => {
  it('produces a report with the window, funnel, and a clean-errors note when empty', () => {
    const usage = aggregateUsage([{ event: 'family_created', day: '2026-07-01' }]);
    const errors = aggregateErrors([]);
    const md = renderMarkdown(usage, errors, { since: '2026-07-01', until: '2026-07-07' });
    expect(md).toContain('# FamilyHQ insights — 2026-07-01 → 2026-07-07');
    expect(md).toContain('## Activation funnel');
    expect(md).toContain('family_created');
    expect(md).toContain('None in this window');
  });

  it('renders an error table when errors exist', () => {
    const errors = aggregateErrors([
      { name: 'TypeError', message: 'x', stackHead: 'at f', route: '/chores', day: '2026-07-02' },
    ]);
    const md = renderMarkdown(aggregateUsage([]), errors, { since: 'a', until: 'b' });
    expect(md).toContain('| TypeError |');
    expect(md).toContain('/chores');
  });
});
