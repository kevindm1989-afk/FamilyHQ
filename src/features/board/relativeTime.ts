/**
 * Relative timestamp formatting for board post headers (Phase 3, Task 9;
 * handoff #04 "20m ago").
 *
 * Deterministic by construction: the "now" reference is passed in (never reads
 * the real clock). Mapping (pinned by relativeTime.test.ts):
 *   <60s  -> "just now"
 *   <60m  -> "{n}m ago"
 *   <24h  -> "{n}h ago"
 *   <7d   -> "{n}d ago"
 *   else  -> a short calendar date.
 * Clock skew where `createdAt` is slightly ahead of `now` is treated as
 * "just now" (the elapsed time is clamped at zero — never negative).
 */
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  month: 'short',
  day: 'numeric',
});

export function relativeTime(createdAtMs: number, nowMs: number): string {
  // Clamp at zero so a createdAt slightly in the future never goes negative.
  const elapsed = Math.max(0, nowMs - createdAtMs);

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d ago`;

  return DATE_FORMAT.format(new Date(createdAtMs));
}
