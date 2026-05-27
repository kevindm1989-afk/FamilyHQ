// Family HQ — shared primitives
// Brand: indigo #3730A3 primary, amber #F59E0B accent, soft white #F9FAFB bg

const HB = {
  indigo: '#3730A3',
  indigoDark: '#312E81',
  indigoLight: '#EEF2FF',
  amber: '#F59E0B',
  amberLight: '#FEF3C7',
  amberDark: '#B45309',
  bg: '#F9FAFB',
  card: '#FFFFFF',
  ink: '#0F172A',
  ink2: '#334155',
  mute: '#64748B',
  mute2: '#94A3B8',
  line: '#E5E7EB',
  line2: '#F1F5F9',
  // event category colors
  school: '#3B82F6',
  sports: '#10B981',
  family: '#3730A3',
  work: '#6B7280',
  // status
  ok: '#10B981',
  okLight: '#D1FAE5',
  warn: '#F59E0B',
  warnLight: '#FEF3C7',
  info: '#3B82F6',
  infoLight: '#DBEAFE',
  danger: '#EF4444',
};

// People in the family
const PEOPLE = {
  sarah: { id: 'sarah', name: 'Sarah', initials: 'S', color: '#7C3AED', role: 'parent' },
  david: { id: 'david', name: 'David', initials: 'D', color: '#0EA5E9', role: 'parent' },
  maya:  { id: 'maya',  name: 'Maya',  initials: 'M', color: '#EC4899', role: 'teen', balance: 38.50 },
  ben:   { id: 'ben',   name: 'Ben',   initials: 'B', color: '#22C55E', role: 'teen', balance: 24.00 },
};

// ─────────────────────────────────────────────────────────────
// Icons — single-line strokes, friendly rounded
// ─────────────────────────────────────────────────────────────
const Icon = {
  home: (p={}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 11l9-8 9 8"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/></svg>,
  calendar: (p={}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/></svg>,
  board: (p={}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z"/></svg>,
  chore: (p={}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  plus: (p={}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M5 12h14"/></svg>,
  crown: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M3 18h18l-1.5-9-4.5 3-3-5-3 5-4.5-3L3 18z"/></svg>,
  check: (p={}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M5 12l5 5L20 7"/></svg>,
  x: (p={}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 6l12 12M18 6L6 18"/></svg>,
  chev: (p={}) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 6l6 6-6 6"/></svg>,
  back: (p={}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 6l-6 6 6 6"/></svg>,
  bell: (p={}) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>,
  coin: (p={}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M9 9h4a2 2 0 0 1 0 4h-4 5"/></svg>,
  star: (p={}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/></svg>,
  clock: (p={}) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  edit: (p={}) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 20h4l11-11-4-4L4 16v4z"/></svg>,
  send: (p={}) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  mail: (p={}) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></svg>,
  lock: (p={}) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>,
  house: (p={}) => <svg width="28" height="28" viewBox="0 0 32 32" fill="none" {...p}><path d="M4 14L16 4l12 10v13a2 2 0 0 1-2 2h-6v-8h-8v8H6a2 2 0 0 1-2-2V14z" fill="#3730A3"/><path d="M4 14L16 4l12 10" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>,
};

// ─────────────────────────────────────────────────────────────
// Avatar — circle w/ initials + optional parent crown
// ─────────────────────────────────────────────────────────────
function Avatar({ person, size = 32, showCrown = true, ring = false }) {
  if (!person) return null;
  const fontSize = Math.round(size * 0.42);
  const crownSize = Math.round(size * 0.48);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={{
        width: size, height: size, borderRadius: '50%',
        background: person.color, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize, fontWeight: 700, letterSpacing: '-0.01em',
        boxShadow: ring ? `0 0 0 2px ${HB.card}, 0 0 0 4px ${HB.indigo}` : 'none',
      }}>{person.initials}</div>
      {showCrown && person.role === 'parent' && (
        <div style={{
          position: 'absolute', top: -4, right: -4,
          width: crownSize, height: crownSize, borderRadius: '50%',
          background: HB.amber, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 0 2px ${HB.card}`,
        }}>
          <Icon.crown style={{ width: crownSize * 0.6, height: crownSize * 0.6 }} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Avatar chip — used in top-right of every screen
// ─────────────────────────────────────────────────────────────
function AvatarChip({ person, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '4px 10px 4px 4px', background: HB.line2,
      border: 'none', borderRadius: 999, cursor: 'pointer',
      height: 36,
    }}>
      <Avatar person={person} size={28} />
      <span style={{ fontSize: 13, fontWeight: 600, color: HB.ink, letterSpacing: '-0.01em' }}>{person.name}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Card — soft shadow, 16px radius
// ─────────────────────────────────────────────────────────────
function Card({ children, onClick, style = {}, pad = 16 }) {
  return (
    <div onClick={onClick} style={{
      background: HB.card, borderRadius: 16, padding: pad,
      boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)',
      cursor: onClick ? 'pointer' : 'default',
      transition: 'transform 120ms ease',
      ...style,
    }}>{children}</div>
  );
}

// ─────────────────────────────────────────────────────────────
// Button — primary indigo, secondary ghost, danger
// ─────────────────────────────────────────────────────────────
function Button({ children, onClick, variant = 'primary', size = 'md', icon, full = false, disabled = false, style = {} }) {
  const sizes = {
    sm: { h: 36, fs: 13, px: 14, gap: 6 },
    md: { h: 48, fs: 15, px: 18, gap: 8 },
    lg: { h: 52, fs: 16, px: 22, gap: 8 },
  }[size];
  const variants = {
    primary:   { bg: HB.indigo, color: '#fff', border: 'none' },
    amber:     { bg: HB.amber, color: '#fff', border: 'none' },
    ghost:     { bg: 'transparent', color: HB.indigo, border: `1px solid ${HB.line}` },
    soft:      { bg: HB.indigoLight, color: HB.indigo, border: 'none' },
    success:   { bg: HB.ok, color: '#fff', border: 'none' },
    danger:    { bg: '#FEE2E2', color: HB.danger, border: 'none' },
  }[variant];
  return (
    <button onClick={onClick} disabled={disabled} style={{
      height: sizes.h, padding: `0 ${sizes.px}px`, borderRadius: 14,
      background: variants.bg, color: variants.color, border: variants.border,
      fontSize: sizes.fs, fontWeight: 600, letterSpacing: '-0.01em',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: sizes.gap,
      cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      width: full ? '100%' : 'auto',
      fontFamily: 'inherit',
      ...style,
    }}>
      {icon}{children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Badge — small pill, colored by status
// ─────────────────────────────────────────────────────────────
function Badge({ children, tone = 'mute', size = 'md', icon }) {
  const tones = {
    mute:    { bg: HB.line2, color: HB.ink2 },
    indigo:  { bg: HB.indigoLight, color: HB.indigo },
    amber:   { bg: HB.amberLight, color: HB.amberDark },
    ok:      { bg: HB.okLight, color: '#047857' },
    info:    { bg: HB.infoLight, color: '#1D4ED8' },
    danger:  { bg: '#FEE2E2', color: HB.danger },
    school:  { bg: '#DBEAFE', color: '#1D4ED8' },
    sports:  { bg: '#D1FAE5', color: '#047857' },
    family:  { bg: HB.indigoLight, color: HB.indigo },
    work:    { bg: '#E5E7EB', color: '#374151' },
  }[tone];
  const sizing = size === 'sm'
    ? { fs: 11, px: 8, h: 20, gap: 3 }
    : { fs: 12, px: 10, h: 24, gap: 4 };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: sizing.gap,
      height: sizing.h, padding: `0 ${sizing.px}px`, borderRadius: 999,
      fontSize: sizing.fs, fontWeight: 600, letterSpacing: '-0.01em',
      background: tones.bg, color: tones.color,
      whiteSpace: 'nowrap',
    }}>{icon}{children}</span>
  );
}

// ─────────────────────────────────────────────────────────────
// TopBar — 56px, title centered, back left (optional), avatar right
// ─────────────────────────────────────────────────────────────
function TopBar({ title, currentUser, onAvatarClick, onBack, right }) {
  return (
    <div style={{
      height: 56, flexShrink: 0, background: HB.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px',
      position: 'relative',
    }}>
      <div style={{ width: 80, display: 'flex', alignItems: 'center' }}>
        {onBack && (
          <button onClick={onBack} style={{
            width: 36, height: 36, borderRadius: 12, background: 'transparent',
            border: 'none', cursor: 'pointer', color: HB.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: -8,
          }}><Icon.back /></button>
        )}
      </div>
      <div style={{
        position: 'absolute', left: 0, right: 0, textAlign: 'center',
        fontSize: 17, fontWeight: 700, color: HB.ink, letterSpacing: '-0.02em',
        pointerEvents: 'none',
      }}>{title}</div>
      <div style={{ width: 80, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
        {right}
        {currentUser && <AvatarChip person={currentUser} onClick={onAvatarClick} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// BottomNav — 64px, 4 tabs
// ─────────────────────────────────────────────────────────────
function BottomNav({ current, onChange }) {
  const tabs = [
    { id: 'dashboard', label: 'Home', icon: Icon.home },
    { id: 'calendar',  label: 'Calendar', icon: Icon.calendar },
    { id: 'board',     label: 'Board', icon: Icon.board },
    { id: 'chores',    label: 'Chores', icon: Icon.chore },
  ];
  return (
    <div style={{
      height: 64, flexShrink: 0, background: HB.card,
      borderTop: `1px solid ${HB.line}`,
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
      paddingBottom: 0,
    }}>
      {tabs.map(t => {
        const active = t.id === current;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 3, color: active ? HB.indigo : HB.mute2,
            fontFamily: 'inherit',
            position: 'relative',
            minHeight: 44,
          }}>
            <t.icon />
            <span style={{
              fontSize: 11, fontWeight: 600, letterSpacing: '-0.01em',
            }}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FAB — floating action button, indigo
// ─────────────────────────────────────────────────────────────
function FAB({ onClick, icon, label, bottom = 84 }) {
  return (
    <button onClick={onClick} style={{
      position: 'absolute', right: 16, bottom,
      height: label ? 52 : 56, width: label ? 'auto' : 56, padding: label ? '0 20px 0 16px' : 0,
      borderRadius: label ? 26 : 28,
      background: HB.indigo, color: '#fff', border: 'none', cursor: 'pointer',
      boxShadow: '0 8px 24px rgba(55,48,163,0.4), 0 2px 6px rgba(55,48,163,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
      fontFamily: 'inherit',
      zIndex: 5,
    }}>
      {icon || <Icon.plus />}{label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// TextField — labeled input with rounded card style
// ─────────────────────────────────────────────────────────────
function TextField({ label, value, onChange, placeholder, type = 'text', icon, autoFocus = false }) {
  return (
    <label style={{ display: 'block' }}>
      {label && <div style={{
        fontSize: 13, fontWeight: 600, color: HB.ink2, marginBottom: 6, letterSpacing: '-0.01em',
      }}>{label}</div>}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        height: 52, background: HB.card,
        borderRadius: 14, border: `1px solid ${HB.line}`,
        padding: '0 14px',
      }}>
        {icon && <span style={{ color: HB.mute2, display: 'flex' }}>{icon}</span>}
        <input
          type={type} value={value} onChange={e => onChange?.(e.target.value)}
          placeholder={placeholder} autoFocus={autoFocus}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontSize: 15, color: HB.ink, fontFamily: 'inherit', letterSpacing: '-0.01em',
            minWidth: 0,
          }}
        />
      </div>
    </label>
  );
}

// Export
Object.assign(window, {
  HB, PEOPLE, Icon, Avatar, AvatarChip, Card, Button, Badge, TopBar, BottomNav, FAB, TextField,
});
