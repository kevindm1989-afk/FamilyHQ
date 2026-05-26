# Family HQ — Style Guide

Companion to `design-tokens.json`. The tokens are the source of truth for
values; this guide covers direction, per-state component behavior, layout
patterns, density, dark mode, and the accessibility audit that JSON can't hold
cleanly.

**Authority:** `design/handoff/README.md` is the finalized, high-fidelity
reference (ADR-0007). The light palette, type scale, spacing, radii, and
shadows here are EXACT from that handoff and LOCKED. The **dark palette is
PROPOSED and pending human sign-off** — it is not in the handoff and is derived
here to satisfy the locked dark-mode preference.

---

## 1. Direction

**Warm Family Dashboard.** A friendly, trustworthy mobile home base for a whole
household. Indigo brand mark and amber accent over soft slate-white surfaces;
generously rounded cards (16px) and pill controls (999px); the platform's native
system font with tight, confident headings. Content-forward, calm, never
clinical or corporate.

**References**
- **Apple iOS system UI (Reminders / Settings)** — native system-font type ramp, soft grouped-card surfaces, 999-radius pill controls.
- **Things 3** — calm single-accent restraint; generous 12px gap between cards so a glance reads fast.
- **Apple Family Sharing** — person-color avatar identity; warm household (not enterprise) tone.

**Anti-patterns (forbidden)**
1. Gradients / glassmorphism on primary surfaces — cards are flat white with one soft shadow.
2. Multiple competing accent hues — indigo is the only action color, amber the only accent; category/status colors are signal-only.
3. Icon-only controls without a label, or tap targets under 44px (children are users).

**Mood:** warm, trustworthy, calm, friendly, clear.

---

## 2. Color rules

- **Indigo** = brand + primary action + active nav/state. **Amber** = accent (parent crown, warnings, secondary CTA).
- **Category colors** (school/sports/family/work) and **status colors** (ok/warn/info/danger) carry meaning and must ALWAYS pair with an icon or text label — never color alone (color-blind safe, WCAG 1.4.1).
- **`mute2` (#94A3B8 light / #64748B dark) is not a body-text color** — its contrast on card is ~2.7:1. Use it only for inactive icons, disabled glyphs, and decorative fine-print, never for readable body copy.
- **Avatar palette is reference data**, not theme tokens. Production derives a per-user color from the live `users` collection (indigo for members, amber for parents per `preferences.md`); the four named hues are the demo family only.

### Amber / success button text — flagged contrast item
White text on `amber` (#F59E0B) is ~2.1:1 and **fails AA**. White on `ok`
green (#10B981) is ~1.9:1 and also fails. The handoff says "amber bg, white
text" / "green bg, white text," but that does not meet AODA. **Resolution
(designer decision, confirmed by accessibility-specialist):** amber and success
buttons use **dark ink text** (`text.ink` #0F172A) instead of white. ink-on-amber
is ~8.0:1 and ink-on-green is ~8.9:1 — both AAA. This is the one place we depart
from the handoff's literal text, and it is required for compliance. The button
shape, fill, and size are unchanged. (See contrast audit row.)

---

## 3. Typography rules

- Native system font only; no web font loaded (handoff mandate). `display`
  family maps to SF Pro Display where available, `sans` to SF Pro Text.
- The scale is **hand-tuned, not a modular ratio** — use the named styles
  (`display`, `title`, `topbar`, `body`, `meta`, `label`, `badge`, `caption`,
  `captionUppercase`) verbatim; do not interpolate intermediate sizes.
- Headings tight (1.1–1.2 leading); body comfortable (1.45–1.5).
- Headings must make sense read alone (skim test) — "Today", "My chores",
  "Switch account".

---

## 4. Component specs — every state, both modes

States below assume **light** values; **dark** uses the `color.dark.*`
equivalent of the same semantic token (e.g. `brand.indigo` → `#A5B4FC`). Where
dark differs structurally it is called out.

### Button
| State | Visual |
|---|---|
| default | variant fill + label per tokens; radius `control` (14); weight semibold |
| hover (pointer only) | primary/amber/success darken to their `active` token by ~6%; soft/ghost gain `surface.line2` tint. Hover conveys nothing not also shown — pointer is not the primary input. |
| focus-visible | `focus.ring` (3px indigo @45% alpha, 2px offset) OUTSIDE the shape so radius:999 never clips it. Dark: `focus.ringDark`. Distinct from hover. |
| active/pressed | primary→`indigoDark`; amber→`amberDark`; `cardPress` 120ms tint/scale. |
| disabled | opacity 0.5, `cursor:not-allowed`, **`aria-disabled="true"` and still focusable** so screen-reader users can discover it (WCAG 1.4.11 — keep ≥3:1 shape vs bg). Do not use plain `disabled` that removes it from tab order without an explanation. |
| loading | label swaps to spinner (brand.indigo on light fills, onIndigo on indigo fill), `aria-busy="true"`, button stays same size, not a focus trap. |
| error | buttons don't hold error state; the form's field/toast does. |
| `sm` (36) | hit area padded to 44px even though visual is 36px. |

Variants: `primary` (indigo/white), `amber` (amber / **ink** text — see §2),
`soft` (indigoLight/indigo), `ghost` (transparent, 1px line border, indigo
text), `success` (ok green / **ink** text), `danger` (dangerLight bg /
dangerText).

### Input / TextField
| State | Visual |
|---|---|
| default | 52px row, `surface.card` bg, 1px `surface.line`, radius 14, optional left icon in `mute2`; input text `body`. Label `label` style ABOVE the field (WCAG 3.3.2). |
| focus-visible | `focus.ring` on the ROW; border shifts to `brand.indigo`. |
| filled | unchanged from default. |
| error | border `status.danger`; helper text `status.dangerText` BELOW with a small alert icon (text, not color alone); `aria-invalid="true"`, `aria-describedby` → the error text id. |
| disabled | opacity 0.5, input not editable, label still readable. |
| required | required fields marked with text ("Required") or an asterisk WITH a legend — never color alone. |

Checkbox/radio/switch (Add Chore/Event use segmented controls and avatar
multi-select instead): provide a ≥24px control inside a ≥44px hit area; checked
state shows a check glyph + fill, not color alone; `role` per native semantics.

### Card
- default: `surface.card`, radius 16, padding 16, `shadow.card`. **Dark:**
  `shadow._dark.card` + 1px `surface.line` border (soft shadows vanish on dark,
  so the border carries elevation).
- interactive (onClick): adds `cardPress` 120ms; becomes a real `<button>`/link
  with `focus.ring`; whole card is one tap target.
- elevated (login tile / FAB): `shadow.brandElevatedRest`, pressed →
  `brandElevatedActive`.

### Navigation
- **TopBar** — 56px, `surface.bg`, no border. 80px back slot (left), absolutely
  centered `topbar` title, 80px right slot (AvatarChip). Back button = 36px ghost
  with chev icon, hit area 44px, `aria-label="Back"`.
- **BottomNav** — 64px, `surface.card`, 1px top `surface.line`. 4 tabs
  (Home/Calendar/Board/Chores), 22px icon over `caption` label, 3px gap. Active =
  `brand.indigo` + bolder + filled icon; inactive = `mute2`. Active is NOT color
  alone — weight + filled icon carry it too. Each tab ≥44px tall, `aria-current="page"`.
- **Mobile menu** — n/a; the bottom nav IS the primary nav (mobile-only product).

### Modal / Dialog (Add Chore / Add Event)
- Full-screen over the shell; TopBar with Back (closes), title, scrollable 16px
  body, sticky bottom primary `lg` button on a `surface.card` bar with 1px top
  `surface.line`. BottomNav hidden. `role="dialog"`, focus moves to first field,
  Esc/Back closes, focus returns to the trigger. Teens cannot reach Add Chore
  (route guard).

### Bottom sheet (Account Switcher / Compose)
- `surface.card`, top radius 24, `sheetPadding`, `shadow.sheet`, over
  `surface.scrim` (45% light / 60% dark). 40×4 `line2` drag handle. Enter:
  `sheetEnter` (220ms slide-up + fade); **reduced-motion: opacity-only crossfade
  ≤100ms, no translateY.** Focus trapped while open; scrim tap or Esc closes;
  focus returns to trigger. `role="dialog" aria-modal="true"`.

### Toast / Alert / Banner
- Toast: centered pill, `text.ink` bg (light), `onDark` text, `label` style,
  10×16 padding, radius 999, `shadow.toast`, 1.8s auto-dismiss. `role="status"`
  `aria-live="polite"` so it is announced. **Dark:** use a raised slate
  (`#1F2A3D`) bg with `text.ink` (light) text — pure-black-on-bg would vanish.
  Bottom 88px above nav / 24px above modal.
- Every user action (success AND error) routes through the toast
  (`preferences.md`). Errors are user-safe phrasing only — never raw
  Firebase/PII (`constraints.md`).

### Table / List
- No data tables in this product. Lists are card/row stacks:
  - Row: ≥56px (comfortable) / ≥44px (compact), 1px `surface.line2` divider
    between rows, `bodyBold` title + `meta` subtitle, trailing avatar/action.
  - Event row: 4px category-color bar (left) + `badge` time stack + title/sub +
    trailing avatar. The bar is decorative; the category is also stated in text.

### Form layout
- Label ABOVE field (`label` style). Helper text below in `meta`/`mute`. Error
  text below in `status.dangerText` with icon. Required indicated by text/legend.
  Fields stacked 12px gap. Sticky submit at bottom for modal forms.

### Empty / Loading / Error / Skeleton
- **Empty:** friendly `meta`/`mute` text, never illustration-only ("Nothing
  scheduled — enjoy the day."). Required on every list section.
- **Loading:** centered indeterminate spinner (`brand.indigo`) or text;
  `aria-busy` on region. Handoff explicitly uses **no skeleton loaders** (local
  state is fast) — so skeleton is intentionally out of scope; if a network
  surface ever needs one, use a `surface.line2` shimmer block matching the card
  radius.
- **Error:** user-safe `body` text + a retry (`soft`/`ghost`) button; toast for
  transient errors; error text programmatically associated.

---

## 5. Layout patterns

This mobile-only product uses four repeated page-level layouts.

1. **App shell** (Dashboard / Calendar / Board / Chores)
   - TopBar 56 (no back) → scrollable content (4px top / 16px sides / 24px
     bottom, 12–16px card gap) → BottomNav 64 → optional FAB (16 right / 84
     bottom). Max width 480 (framed above 768). Header static; nav fixed.

2. **Centered form** (Login, all four modes)
   - Full-bleed `surface.bg`, 24px sides, vertically centered column: 80×80
     elevated tile → `display` title → `meta` subtitle → 32px gap → form →
     footer 40px from bottom. No nav, no top bar.

3. **Modal form** (Add Chore / Add Event)
   - TopBar with Back → scrollable 16px body (12px field gap) → sticky bottom
     submit bar. Nav hidden.

4. **Bottom sheet** (Account Switcher / Compose)
   - Scrim + sheet rising from bottom (24 top radius). Compose ~80% height with
     drag handle; switcher sized to content.

**Mobile collapse rule:** none needed — single column at every supported width
(320–480). Above 768 the same layout sits inside a decorative iPhone frame; no
reflow to a desktop grid.

---

## 6. Density

- **Comfortable** is the default everywhere.
- **Compact** is offered for list-dense surfaces (Calendar agenda, Chores
  lists, Account Switcher rows): tightens row min-height to 44, row gap to 8,
  list padding-Y to 8. It **never** drops a tap target below 44px — it tightens
  vertical rhythm, not hit areas. Body type size is unchanged in compact.

---

## 7. Dark mode (PROPOSED — needs human sign-off)

The handoff ships no dark palette; this is derived to satisfy the locked
preference and flagged per ADR-0007. Mapping logic:

- **Surfaces invert to a slate-dark stack:** `bg #0B1220` (deepest), `card
  #111A2C` (raised), `line #26344B`, `line2 #1A2536`. Cards stay one step
  lighter than bg, as in light mode.
- **Text inverts:** `ink #F1F5F9`, `ink2 #CBD5E1`, `mute #94A3B8`, `mute2
  #64748B` (still icon/disabled-only).
- **Brand stays recognizable but legible:** indigo lightens to `#A5B4FC` for
  text/icons on dark; `onIndigo` becomes dark ink so labels on the light-indigo
  fill stay readable. Amber lightens to `#FBBF24`.
- **Status/category bgs** become deep tinted slates with light tinted text,
  preserving the same hue families so a "school" event still reads blue, etc.
- **Elevation** shifts from shadow to border: dark shadows are near-invisible,
  so cards/sheets gain a 1px `surface.line` border and a stronger-but-darker
  shadow (`shadow._dark`).
- **Focus ring** lightens to `#A5B4FC` for visibility on dark.

All dark pairs verified AA+ in the audit below.

---

## 8. Motion

| Token | Value | Reduced-motion |
|---|---|---|
| sheet enter | fade + slide-up 220ms `cubic-bezier(.2,.8,.2,1)` | opacity-only ≤100ms, no translateY |
| scrim | opacity 160ms ease-out | opacity 100ms |
| toast | opacity in/out ~200ms (1.8s visible) | unchanged (already opacity-only); 1.8s timer kept |
| card press | 120ms ease scale/tint | drop scale; keep instant tint or nothing |

No spring/bounce is used. `prefers-reduced-motion: reduce` swaps all
transform-based motion for opacity-only crossfades and removes scale; the toast
auto-dismiss **timer** is a notification duration, not motion, and is unchanged.

---

## 9. Contrast audit (authoritative)

Light + dark, every pair used. Body ≥4.5:1 (AA), large/UI ≥3:1, AAA where noted.

### Light
| Pair | Ratio | Verdict |
|---|---|---|
| ink #0F172A on bg #F9FAFB | 17.4:1 | AAA |
| ink on card #FFFFFF | 18.4:1 | AAA |
| ink2 #334155 on card | 9.6:1 | AAA |
| mute #64748B on card | 5.0:1 | AA (AAA large) |
| mute2 #94A3B8 on card | 2.7:1 | FAIL body — inactive icon/disabled only |
| indigo #3730A3 on card | 9.3:1 | AAA |
| onIndigo #FFFFFF on indigo | 9.3:1 | AAA |
| **ink on amber #F59E0B** (amber/success btn text) | **~8.0:1** | AAA — replaces white text (see §2) |
| amberDark #B45309 on amberLight #FEF3C7 | 5.9:1 | AA |
| dangerText #B91C1C on dangerLight #FEE2E2 | 6.0:1 | AA |
| okText #047857 on okLight #D1FAE5 | 4.8:1 | AA |
| school text #1D4ED8 on bg #DBEAFE | 5.6:1 | AA |
| sports text #047857 on bg #D1FAE5 | 4.6:1 | AA |
| family text #3730A3 on bg #EEF2FF | 8.9:1 | AAA |
| work text #374151 on bg #E5E7EB | 6.9:1 | AA |
| focus ring indigo vs card | ≥3:1 | AA (1.4.11) |

### Dark (PROPOSED)
| Pair | Ratio | Verdict |
|---|---|---|
| ink #F1F5F9 on bg #0B1220 | 16.1:1 | AAA |
| ink on card #111A2C | 14.7:1 | AAA |
| ink2 #CBD5E1 on card | 10.0:1 | AAA |
| mute #94A3B8 on card | 5.3:1 | AA (AAA large) |
| mute2 #64748B on card | 2.9:1 | FAIL body — inactive/disabled only |
| indigo #A5B4FC on card | 7.8:1 | AAA |
| onIndigo (dark ink) on indigo #A5B4FC | 7.8:1 | AAA |
| amber #FBBF24 on card | 9.5:1 | AAA |
| dangerText #FCA5A5 on dangerLight #3A1416 | 6.5:1 | AA |
| okText #6EE7B7 on okLight #0E2A22 | 8.2:1 | AAA |
| school text #93C5FD on bg #16263F | 6.4:1 | AA |
| family text #C7D2FE on bg #1E1B4B | 7.1:1 | AAA |
| focus ring #A5B4FC vs card | ≥3:1 | AA |

**Color-blind check:** no information is color-only. Categories pair a text
label; status badges pair an icon; nav-active pairs weight + filled icon;
selected segmented/option pairs a fill + check glyph; error pairs text + icon.

---

## 10. Sample screen — built from tokens only (Dashboard, parent)

Proof the system is complete; every value below is a token.

- **Shell:** App shell layout. `surface.bg` background. TopBar (`layout.topBarHeight`
  56) — empty back slot, no title here, right slot = AvatarChip (`components.avatarChip`).
- **Scroll body:** padding-top `spacing.4`, sides `spacing.16`, bottom `spacing.24`;
  card stack gap `spacing.12`.
- **Greeting block:** "Good morning" in `typography.styles.meta` / `text.mute`;
  "Sarah 👋" in `typography.styles.display` / `text.ink`; date in `meta` / `mute`.
- **Today card:** `components.card` (`surface.card`, radius `card` 16, padding
  `spacing.16`, `shadow.card`). Title row: "Today" `typography.styles.title` /
  `text.ink` + count badge (`components.badge`, tone `indigo` = `brand.indigoLight`
  bg / `brand.indigo` text). Event rows: 4px `category.{cat}.dot` bar (`spacing`
  height 40), time stack `badge` style / `text.mute`, title `bodyBold` / `ink`,
  who `badge` / `mute`, trailing 32px avatar. Empty: `components.emptyState` text.
- **Chores preview (parent):** card; header "Chores" `title` + pending count
  badge tone `amber`; two rows each with emoji + title `bodyBold` + Approve
  (`button` variant `success` size `sm` — **ink text on green**) + Reject
  (`button` variant `danger` size `sm`). Buttons' visual 36 / hit area 44.
- **FAB:** `components.fab` (56, `brand.indigo`, `shadow.brandElevatedRest`, 16
  right / 84 bottom), `aria-label="Add"`.
- **BottomNav:** `components.bottomNav`; Home active (`brand.indigo` + filled +
  bolder), others `text.mute2`.
- **Dark mode:** swap each token to its `color.dark.*` equivalent; cards gain a
  1px `surface.line` border; FAB shadow → `shadow._dark.brandElevatedRest`.

Nothing here required an invented value — system is complete.

---

## 11. AODA artifacts (launch blockers, surfaced not built)

- **Accessibility statement** page — required for a public-facing Ontario
  service; not a design token but must exist before launch.
- **Accessibility feedback mechanism** — a way for users to report barriers;
  required by AODA.

Both are flagged to the orchestrator as launch-gate items, not part of this
token deliverable.
