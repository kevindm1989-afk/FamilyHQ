import type { Config } from 'tailwindcss';
import tokens from './design-tokens.json';

// ---------------------------------------------------------------------------
// Tailwind theme built FROM design-tokens.json (ADR-0007).
//
// RULES enforced here:
//   - theme.extend consumes ONLY values read from `tokens`. No literal hex,
//     px, or rem appears below — every value traces back to the locked token
//     file. (scripts/token-audit.sh additionally guards src/ against stray
//     literals.)
//   - LIGHT MODE ONLY for v1. The `color.dark` token set is intentionally
//     present in design-tokens.json but is NOT wired here — no `darkMode`
//     strategy, no `dark:` variant generation, no doubled theme.
//     // dark mode deferred to post-v1 (see ADR-0007 / tokens color.dark).
//     When dark ships, add `darkMode: ['class', '[data-theme="dark"]']` and
//     map a second CSS-variable layer to `tokens.color.dark`.
//
// ACCESSIBILITY OVERRIDE (approved, see design-tokens components.button):
//   amber and success ("approve") buttons MUST use dark `ink` text, NOT white.
//   White-on-amber (2.1:1) and white-on-green fail WCAG AA. The token below
//   `colors.onAccent` exposes ink for that purpose; the Button primitive
//   (Phase 2, owned by implementer) must consume `text-ink` on amber/success,
//   never `text-white`. Do NOT build the Button here.
// ---------------------------------------------------------------------------

const light = tokens.color.light;
const type = tokens.typography;
const space = tokens.spacing;
const radius = tokens.radius;
const shadow = tokens.shadow;
const components = tokens.components;
const layout = tokens.layout;
const motion = tokens.motion;
const focus = tokens.focus;

// Component dimensions, traced straight to tokens so primitives never need a
// magic-number literal. Keys are semantic (avatar-*, control-*, nav, topbar,
// fab) and map to design-tokens.json components.*/layout.*.
const avatar = components.avatar.sizes;
const sizeScale: Record<string, string> = {
  'avatar-chip': avatar.chip,
  'avatar-default': avatar.default,
  'avatar-switcher': avatar.switcher,
  'avatar-author': avatar.author,
  'btn-sm': components.button.sizes.sm.height,
  'btn-md': components.button.sizes.md.height,
  'btn-lg': components.button.sizes.lg.height,
  field: components.textField.rowHeight,
  badge: components.badge.height,
  'badge-sm': components.badge.heightSm,
  topbar: layout.topBarHeight,
  nav: layout.bottomNavHeight,
  fab: layout.fab.size,
  backslot: layout.backSlotWidth,
};

// spacing keys in the token file are the raw px-step labels (plus _-prefixed
// meta keys we skip). Build a clean numeric-key scale for Tailwind, then add
// the named semantic spacings the layout chrome needs (e.g. the toast viewport
// sits a fixed distance above the bottom nav — spacing._semantic).
const spacingScale = {
  ...(Object.fromEntries(Object.entries(space).filter(([k]) => /^\d+$/.test(k))) as Record<
    string,
    string
  >),
  'toast-from-nav': space._semantic.toastFromBottomNav,
  'fab-from-bottom': space._semantic.fabFromBottom,
  'footer-from-bottom': space._semantic.footerFromBottom,
};

// typography sizes: map each named style to [size, { lineHeight, letterSpacing, fontWeight }]
const fontSize = Object.fromEntries(
  Object.entries(type.styles).map(([name, s]) => [
    name,
    [
      s.rem,
      {
        lineHeight: String(s.leading),
        letterSpacing: s.tracking,
        fontWeight: String(s.weight),
      },
    ],
  ]),
) as Config['theme'] extends { fontSize?: infer T } ? NonNullable<T> : never;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // dark mode deferred to post-v1 (see ADR-0007 / tokens color.dark). Light-only.
  theme: {
    extend: {
      colors: {
        // Brand
        brand: {
          DEFAULT: light.brand.indigo,
          dark: light.brand.indigoDark,
          light: light.brand.indigoLight,
          on: light.brand.onIndigo,
        },
        // Accent (amber). NOTE: on-accent text is INK, not white (a11y override).
        accent: {
          DEFAULT: light.accent.amber,
          light: light.accent.amberLight,
          dark: light.accent.amberDark,
        },
        // Approved a11y override: ink text used on amber + success fills.
        onAccent: light.text.ink,
        // Surfaces
        surface: {
          bg: light.surface.bg,
          card: light.surface.card,
          line: light.surface.line,
          line2: light.surface.line2,
          scrim: light.surface.scrim,
        },
        // Text / ink
        ink: {
          DEFAULT: light.text.ink,
          2: light.text.ink2,
          mute: light.text.mute,
          mute2: light.text.mute2,
          'on-dark': light.text.onDark,
        },
        // Event categories (signal only, paired with a label/icon — never decorative)
        category: {
          'school-dot': light.category.school.dot,
          'school-bg': light.category.school.bg,
          'school-text': light.category.school.text,
          'sports-dot': light.category.sports.dot,
          'sports-bg': light.category.sports.bg,
          'sports-text': light.category.sports.text,
          'family-dot': light.category.family.dot,
          'family-bg': light.category.family.bg,
          'family-text': light.category.family.text,
          'work-dot': light.category.work.dot,
          'work-bg': light.category.work.bg,
          'work-text': light.category.work.text,
        },
        // Status
        status: {
          ok: light.status.ok,
          'ok-light': light.status.okLight,
          'ok-text': light.status.okText,
          warn: light.status.warn,
          'warn-light': light.status.warnLight,
          'warn-text': light.status.warnText,
          info: light.status.info,
          'info-light': light.status.infoLight,
          'info-text': light.status.infoText,
          danger: light.status.danger,
          'danger-light': light.status.dangerLight,
          'danger-text': light.status.dangerText,
        },
      },
      fontFamily: {
        sans: type.family.sans.split(',').map((s) => s.trim()),
        display: type.family.display.split(',').map((s) => s.trim()),
        mono: type.family.mono.split(',').map((s) => s.trim()),
      },
      fontSize,
      fontWeight: {
        medium: String(type.weight.medium),
        semibold: String(type.weight.semibold),
        bold: String(type.weight.bold),
        extrabold: String(type.weight.extrabold),
      },
      spacing: spacingScale,
      borderRadius: {
        sm: radius.sm,
        md: radius.md,
        control: radius.control,
        card: radius.card,
        sheet: radius.sheet,
        full: radius.full,
      },
      boxShadow: {
        card: shadow.card,
        'brand-rest': shadow.brandElevatedRest,
        'brand-active': shadow.brandElevatedActive,
        sheet: shadow.sheet,
        toast: shadow.toast,
      },
      zIndex: Object.fromEntries(
        Object.entries(tokens.zIndex).map(([k, v]) => [k, String(v)]),
      ) as Record<string, string>,
      width: sizeScale,
      height: sizeScale,
      minHeight: {
        tap: tokens.touchTarget.min, // 44px — WCAG 2.5.5 minimum tap target
      },
      minWidth: {
        tap: tokens.touchTarget.min,
      },
      maxWidth: {
        app: layout.maxWidth,
        frame: layout.frameAbove,
      },
      ringWidth: {
        // focus.ringWidth token (3px) — the obvious focus-visible ring required
        // by AODA / WCAG 2.4.7 & 1.4.11 (>=3:1). See design-tokens.json focus.
        focus: focus.ringWidth,
      },
      ringColor: {
        // focus.ringColor token (== brand indigo). The focus-visible ring uses
        // `ring-brand` for colour across all primitives. The token's reference
        // shadow form uses 45% alpha; we render solid indigo, which exceeds the
        // token's alpha for contrast and still satisfies the >=3:1 floor — a
        // deliberate, documented simplification of the ring token.
        brand: focus.ringColor,
      },
      ringOffsetWidth: {
        focus: focus.ringOffset, // focus.ringOffset token (2px)
      },
      transitionTimingFunction: {
        out: motion.easing.out,
        sheet: motion.easing.sheet,
      },
      transitionDuration: {
        cardPress: motion.duration.cardPress,
        scrim: motion.duration.scrim,
        toast: motion.duration.toast,
        sheet: motion.duration.sheet,
      },
    },
  },
  plugins: [],
} satisfies Config;
