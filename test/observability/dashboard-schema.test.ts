/**
 * dashboard-schema — PR E observability shape gate (E-T6).
 *
 * Threat-model §A.10 PR E quote (verbatim):
 *   - E-T6. Dashboard config asserts the four required series: invocations
 *           per kind, success ratio, token cleanups, kill-switch invocations.
 *
 * The Cloud Monitoring dashboard JSON ships in the repo so that:
 *   (a) the four operational series an on-call needs are guaranteed to be
 *       present (this test pins each one),
 *   (b) the dashboard can be re-applied via `gcloud monitoring dashboards
 *       create --config-from-file=infra/monitoring/dashboard.json` from a
 *       clean GCP state, and
 *   (c) every change to the dashboard goes through code review.
 *
 * Expected file location:
 *   `/home/user/FamilyHQ/infra/monitoring/dashboard.json`
 *
 * The test parses the JSON, then for each of the four required series it
 * walks every widget in either `gridLayout.widgets[]` or
 * `mosaicLayout.tiles[].widget` (GCP supports both layouts; the assertion
 * is layout-agnostic so the implementer can pick either). A widget
 * matches a series when:
 *   - its `displayName` matches the series-specific regex (case-
 *     insensitive), AND
 *   - some descendant string in the widget mentions the expected metric
 *     filter / log filter / function-name filter.
 *
 * Sanity:
 *   - JSON parses.
 *   - Top-level shape carries a string `displayName` AND at least one of
 *     `gridLayout` / `mosaicLayout` / `columnLayout` / `rowLayout`.
 *   - All widget labels are ASCII / language-neutral (the dashboard is
 *     operator-facing and we do not localize it).
 *
 * MUST FAIL today: `infra/monitoring/dashboard.json` does not exist. The
 * implementer creates it (and the `infra/monitoring/` parent dir) during
 * PR E.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DASHBOARD_PATH = resolve(__dirname, '../../infra/monitoring/dashboard.json');

// ---------------------------------------------------------------------------
// Loader. Returns the parsed JSON or throws a clear error if missing /
// invalid — never returns a partial / null shape silently.
// ---------------------------------------------------------------------------
interface DashboardJson {
  displayName?: unknown;
  gridLayout?: { widgets?: unknown };
  mosaicLayout?: { tiles?: unknown };
  columnLayout?: unknown;
  rowLayout?: unknown;
  labels?: unknown;
}

function loadDashboard(): DashboardJson {
  if (!existsSync(DASHBOARD_PATH)) {
    throw new Error(
      `dashboard.json is missing at ${DASHBOARD_PATH} — implementer must create the Cloud Monitoring dashboard config (PR E / E-T6).`,
    );
  }
  const raw = readFileSync(DASHBOARD_PATH, 'utf8');
  try {
    return JSON.parse(raw) as DashboardJson;
  } catch (err) {
    throw new Error(
      `dashboard.json at ${DASHBOARD_PATH} is not valid JSON: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Widget enumeration — supports both gridLayout and mosaicLayout shapes.
// ---------------------------------------------------------------------------
interface WidgetLike {
  displayName?: unknown;
  // Visible at any nesting depth — we serialize the whole widget back to a
  // string for the metric / filter substring checks, which is the most
  // tolerant approach across GCP's many widget sub-types (xyChart,
  // scorecard, alertChart, logsPanel, etc.).
  [key: string]: unknown;
}

function collectWidgets(dash: DashboardJson): WidgetLike[] {
  const widgets: WidgetLike[] = [];

  // gridLayout.widgets[]
  if (dash.gridLayout && typeof dash.gridLayout === 'object') {
    const w = (dash.gridLayout as { widgets?: unknown }).widgets;
    if (Array.isArray(w)) {
      for (const item of w) {
        if (item && typeof item === 'object') widgets.push(item as WidgetLike);
      }
    }
  }
  // mosaicLayout.tiles[].widget
  if (dash.mosaicLayout && typeof dash.mosaicLayout === 'object') {
    const tiles = (dash.mosaicLayout as { tiles?: unknown }).tiles;
    if (Array.isArray(tiles)) {
      for (const tile of tiles) {
        if (tile && typeof tile === 'object') {
          const widget = (tile as { widget?: unknown }).widget;
          if (widget && typeof widget === 'object') {
            widgets.push(widget as WidgetLike);
          }
        }
      }
    }
  }
  // columnLayout.columns[].widgets[] (rare but supported by GCP)
  const tryNested = (root: unknown, listKey: string, innerKey: string): void => {
    if (!root || typeof root !== 'object') return;
    const list = (root as Record<string, unknown>)[listKey];
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const inner = (item as Record<string, unknown>)[innerKey];
      if (Array.isArray(inner)) {
        for (const w of inner) {
          if (w && typeof w === 'object') widgets.push(w as WidgetLike);
        }
      }
    }
  };
  tryNested(dash.columnLayout, 'columns', 'widgets');
  tryNested(dash.rowLayout, 'rows', 'widgets');

  return widgets;
}

/** Returns the widget's displayName as a string, or '' if absent / non-string. */
function nameOf(w: WidgetLike): string {
  return typeof w.displayName === 'string' ? w.displayName : '';
}

/**
 * Stringify a widget for substring checks. JSON serialization makes every
 * nested filter string / metric type / log filter inspectable from one
 * place without needing to traverse GCP's deep widget union by hand.
 */
function asText(w: WidgetLike): string {
  try {
    return JSON.stringify(w);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Sanity assertions on the dashboard shape.
// ---------------------------------------------------------------------------
describe('E-T6: dashboard.json — sanity & top-level shape', () => {
  it('exists at infra/monitoring/dashboard.json', () => {
    expect(existsSync(DASHBOARD_PATH)).toBe(true);
  });

  it('parses as JSON', () => {
    expect(() => loadDashboard()).not.toThrow();
  });

  it('carries a non-empty string displayName', () => {
    const dash = loadDashboard();
    expect(typeof dash.displayName).toBe('string');
    expect((dash.displayName as string).trim().length).toBeGreaterThan(0);
  });

  it('declares at least one supported layout (gridLayout / mosaicLayout / columnLayout / rowLayout)', () => {
    const dash = loadDashboard();
    const hasLayout =
      dash.gridLayout !== undefined ||
      dash.mosaicLayout !== undefined ||
      dash.columnLayout !== undefined ||
      dash.rowLayout !== undefined;
    expect(hasLayout, 'dashboard must declare at least one layout container').toBe(true);
  });

  it('contains at least four widgets (the four required E-T6 series)', () => {
    const dash = loadDashboard();
    const widgets = collectWidgets(dash);
    expect(
      widgets.length,
      `expected >= 4 widgets for the four E-T6 series, got ${widgets.length}`,
    ).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// E-T6 — each of the four required series.
// ---------------------------------------------------------------------------
describe('E-T6 series 1: invocations per callable kind', () => {
  it('exposes a widget whose name mentions invocations + kind and whose query is a Cloud-Functions execution-count metric grouped by function/service name', () => {
    const dash = loadDashboard();
    const widgets = collectWidgets(dash);

    const candidates = widgets.filter((w) =>
      /invocations.*kind|kind.*invocations/i.test(nameOf(w)),
    );
    expect(
      candidates.length,
      'expected at least one widget whose displayName matches /invocations.*kind/i — none found',
    ).toBeGreaterThan(0);

    const matchesMetric = candidates.some((w) => {
      const text = asText(w);
      // The notify-* callables ship as Cloud Functions v2 (Cloud Run-backed).
      // The correct metric is `run.googleapis.com/request_count` with
      // `resource.type="cloud_run_revision"` and `resource.label.service_name`
      // — see second-opinion-reviewer's PR E Concern 1.
      const usesGen2Metric = text.includes('run.googleapis.com/request_count');
      const usesGen2ResourceType = text.includes('cloud_run_revision');
      const groupsByServiceName = /service_name/.test(text);
      return usesGen2Metric && usesGen2ResourceType && groupsByServiceName;
    });
    expect(
      matchesMetric,
      'the invocations-per-kind widget must use the gen-2 metric run.googleapis.com/request_count + resource.type cloud_run_revision + group by service_name (notify-* callables are Cloud Functions v2)',
    ).toBe(true);
  });
});

describe('E-T6 series 2: success ratio', () => {
  it('exposes a widget whose name mentions success and whose query is a ratio (numerator + denominator)', () => {
    const dash = loadDashboard();
    const widgets = collectWidgets(dash);

    const candidates = widgets.filter((w) => /success/i.test(nameOf(w)));
    expect(
      candidates.length,
      'expected at least one widget whose displayName matches /success/i — none found',
    ).toBeGreaterThan(0);

    const matchesRatio = candidates.some((w) => {
      const text = asText(w);
      // GCP success-ratio widgets must reference both halves of the
      // ratio — `numerator` + `denominator` is the canonical shape on
      // both `timeSeriesQuery.timeSeriesFilterRatio` and
      // `timeSeriesQueryLanguage` queries.
      const hasNumerator = /numerator/i.test(text);
      const hasDenominator = /denominator/i.test(text);
      // OR — `success_count / total_count` style via TSQL.
      const hasTsqlRatio = /div|ratio|fraction/i.test(text);
      return (hasNumerator && hasDenominator) || hasTsqlRatio;
    });
    expect(
      matchesRatio,
      'the success-ratio widget must express its query as a ratio (numerator + denominator) — neither half found',
    ).toBe(true);
  });
});

describe('E-T6 series 3: stale-token cleanups', () => {
  it('exposes a widget whose name mentions cleanup / stale-token / token-cleanup and queries the cleanedTokenCount surface', () => {
    const dash = loadDashboard();
    const widgets = collectWidgets(dash);

    const candidates = widgets.filter((w) =>
      /cleanup|stale.?token|token.?cleanup|cleaned.?token/i.test(nameOf(w)),
    );
    expect(
      candidates.length,
      'expected at least one widget whose displayName matches /cleanup|stale.token|token.cleanup/i — none found',
    ).toBeGreaterThan(0);

    const matchesCleanup = candidates.some((w) => {
      const text = asText(w);
      // Either:
      //  - a log-based metric whose name encodes the cleanup count, or
      //  - a logs-based count whose filter references jsonPayload.cleanedTokenCount.
      const customMetric =
        /notify_callable_cleaned_token_count/.test(text) || /cleaned_token_count/.test(text);
      const logFilter = /cleanedTokenCount/.test(text);
      return customMetric || logFilter;
    });
    expect(
      matchesCleanup,
      'the cleanup widget must reference either a `notify_callable_cleaned_token_count` log-based metric OR a logs filter on `cleanedTokenCount`',
    ).toBe(true);
  });
});

describe('E-T6 series 4: kill-switch invocations', () => {
  it('exposes a widget whose name mentions kill-switch and whose query filters on the billingKillSwitch function', () => {
    const dash = loadDashboard();
    const widgets = collectWidgets(dash);

    const candidates = widgets.filter((w) =>
      /kill.?switch|billing.*killswitch|kill_switch|killswitch/i.test(nameOf(w)),
    );
    expect(
      candidates.length,
      'expected at least one widget whose displayName matches /kill.switch|billing.*killswitch|kill_switch/i — none found',
    ).toBeGreaterThan(0);

    const matchesKillSwitch = candidates.some((w) => {
      const text = asText(w);
      // Filter must pin the function — gen-2 Cloud Run service names are
      // lowercase by convention (camelCase camelCase → lowercase), so we
      // accept either the camelCase function-name form (gen-1) OR the
      // lowercase service-name form (gen-2). Both must be the same
      // identifier modulo case.
      return /billingKillSwitch|billingkillswitch/i.test(text);
    });
    expect(
      matchesKillSwitch,
      'the kill-switch widget must filter on the billingKillSwitch / billingkillswitch identifier',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hygiene — no PII in dashboard text, no localized strings (dashboard is
// operator-facing English-only).
// ---------------------------------------------------------------------------
describe('hygiene: dashboard contains no PII / localized strings', () => {
  it('contains no forbidden PI substrings in any widget displayName (privacy: dashboard text is operator-visible)', () => {
    const dash = loadDashboard();
    const widgets = collectWidgets(dash);
    // The forbidden-text set is the same family as the notification-body
    // gate (`title`, `name`, `email`, etc.) — a dashboard title that
    // reads "wishlistTitle" suggests the underlying log-field allow-list
    // has been widened to include PII-leaking keys.
    const FORBIDDEN = ['choreTitle', 'wishlistTitle', 'postContent', 'todoTitle', 'email'];
    const offenders: Array<{ widget: string; substring: string }> = [];
    for (const w of widgets) {
      const name = nameOf(w);
      for (const sub of FORBIDDEN) {
        if (name.toLowerCase().includes(sub.toLowerCase())) {
          offenders.push({ widget: name, substring: sub });
        }
      }
    }
    expect(
      offenders,
      `dashboard widget displayName contains forbidden PI substring(s): ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });

  it('all widget displayNames are pure ASCII (operator-facing, not localized)', () => {
    const dash = loadDashboard();
    const widgets = collectWidgets(dash);
    const nonAscii = widgets
      .map((w) => nameOf(w))
      .filter((s) => s.length > 0 && /[^\x20-\x7F\t\n\r]/.test(s));
    expect(
      nonAscii,
      `dashboard widget displayName(s) contain non-ASCII characters (operator dashboard must stay English): ${JSON.stringify(nonAscii)}`,
    ).toEqual([]);
  });
});
