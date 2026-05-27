/**
 * CONTRACT STUB — relative timestamp formatting for board post headers
 * (Phase 3, Task 9; handoff #04 "20m ago").
 *
 * Signature only, no logic. The implementer writes the body to satisfy
 * relativeTime.test.ts. Deterministic by construction: the "now" reference is
 * passed in (never reads the real clock), so tests freeze time explicitly.
 *
 * Required mapping (pinned by the test): <60s -> "just now"; <60m -> "{n}m ago";
 * <24h -> "{n}h ago"; <7d -> "{n}d ago"; otherwise a short calendar date. Never
 * negative ("just now" for tiny clock skew where createdAt is slightly ahead).
 */
export declare function relativeTime(createdAtMs: number, nowMs: number): string;
