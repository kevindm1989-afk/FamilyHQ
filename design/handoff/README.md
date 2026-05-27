# Handoff: Family HQ

A mobile PWA that gives a family a shared dashboard, calendar, bulletin board, and chore tracker — with separate experiences for parents and teens.

## About the Design Files

The files in this bundle are **design references created in HTML** — a React-in-the-browser prototype showing the intended look and behavior. They are **not production code to copy directly**.

Your job is to **recreate these designs in the target codebase's existing environment** (React Native, SwiftUI, Flutter, a fresh React/Vite app, whatever the project is), using its established patterns, component library, and styling system. If no environment exists yet, choose what's most appropriate (this is a mobile-first product — React Native or SwiftUI/Kotlin native are the natural fits).

Open `Family HQ.html` in a browser to see the working prototype. Resize the window to mobile width (≤480px) for the full-bleed mobile view; on desktop it shows inside an iPhone frame.

## Fidelity

**High-fidelity.** All colors, typography, spacing, radii, shadows, and interactions are finalized. Recreate pixel-perfectly using your codebase's libraries — colors and dimensions are exact.

## Tech Notes from the Prototype

- The prototype is React 18 split across `app.jsx` (state + routing), `components.jsx` (primitives), `screens.jsx` (screens), `mount.jsx` (responsive bootstrap). All state is local React state — no backend.
- The base unit is a **390×844 viewport** (iPhone 14). Treat layouts as fixed-width mobile.
- The font stack is `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif` — use the platform's native system font.

---

## Design Tokens

### Colors

```
// Brand
indigo        #3730A3   // primary actions, active states, brand mark
indigoDark    #312E81   // pressed state for indigo buttons
indigoLight   #EEF2FF   // soft indigo bg (selected rows, soft buttons, family badge bg)
amber         #F59E0B   // accent — parent crown, warnings, secondary CTA
amberLight    #FEF3C7   // amber pill bg
amberDark     #B45309   // amber pill text

// Surfaces
bg            #F9FAFB   // app background (soft white)
card          #FFFFFF   // card surface
line          #E5E7EB   // borders and dividers
line2         #F1F5F9   // tinted dividers, avatar-chip bg

// Text
ink           #0F172A   // primary text
ink2          #334155   // secondary text / labels
mute          #64748B   // tertiary text / metadata
mute2         #94A3B8   // disabled / icon inactive

// Event categories (for calendar dots/badges)
school        #3B82F6   // bg #DBEAFE / text #1D4ED8
sports        #10B981   // bg #D1FAE5 / text #047857
family        #3730A3   // bg #EEF2FF / text #3730A3
work          #6B7280   // bg #E5E7EB / text #374151

// Status
ok            #10B981   // success — completed chores
okLight       #D1FAE5
warn          #F59E0B
warnLight     #FEF3C7
info          #3B82F6
infoLight     #DBEAFE
danger        #EF4444   // sign-out, reject chore
```

**Per-person avatar colors** (used for avatar circle background):
- Sarah (parent): `#7C3AED` violet
- David (parent): `#0EA5E9` sky
- Maya (teen): `#EC4899` pink
- Ben (teen): `#22C55E` green

### Typography

| Token              | Size | Weight | Letter-spacing | Used on                          |
| ------------------ | ---- | ------ | -------------- | -------------------------------- |
| display            | 32   | 800    | -0.03em        | Greeting, brand mark, screen H1  |
| title              | 22   | 700    | -0.02em        | Section titles inside cards      |
| topbar             | 17   | 700    | -0.02em        | Top bar title                    |
| body-lg            | 16   | 500    | -0.01em        | Long-form post content           |
| body               | 15   | 500    | -0.01em        | Inputs, button labels (md)       |
| body-bold          | 15   | 700    | -0.01em        | Card item titles                 |
| meta               | 14   | 500    | -0.01em        | Subtitles, mute text             |
| label              | 13   | 600    | -0.01em        | Form labels, "Forgot password?"  |
| badge              | 12   | 600    | -0.01em        | Pill badges                      |
| caption            | 11   | 600    | -0.01em        | Bottom-nav labels, footnotes     |
| caption-uppercase  | 11   | 700    | +0.08em        | Section dividers in sheets       |

Line-height defaults: tight (1.1–1.2) for headings, comfortable (1.4–1.5) for body.

### Spacing & Radii

- Base spacing scale: **4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 32 / 44**
- Horizontal screen padding: **16px** (most content), **24px** (login)
- Card padding: **16px**
- Card gap (between cards in a stack): **12px**
- Radius: **8** (small), **12** (medium), **14** (inputs, buttons, soft cards), **16** (cards), **24** (bottom sheets, large rounded surfaces), **999** (pills/avatars)

### Shadows

- Card: `0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)`
- Elevated brand element (login icon, FAB): `0 8px 24px rgba(55,48,163,0.18 → 0.4), 0 2px 6px rgba(55,48,163,0.08 → 0.2)`
- Bottom sheet rising: `0 -8px 32px rgba(15,23,42,0.18)`
- Toast: `0 8px 24px rgba(15,23,42,0.25)`

---

## Family Model

Four people make up the demo family:

| ID    | Name  | Role   | Notes                                 |
| ----- | ----- | ------ | ------------------------------------- |
| sarah | Sarah | parent | Default signed-in user                |
| david | David | parent |                                       |
| maya  | Maya  | teen   | Allowance balance: $38.50             |
| ben   | Ben   | teen   | Allowance balance: $24.00             |

**Parents wear a tiny amber crown badge** on the top-right of their avatar (always visible). Teens have no badge.

The **current user's role drives several screens** — most notably the Chores screen, which is completely different for parents (approval queue) vs teens (personal task list + earnings).

---

## Shared Components

### Avatar (`components.jsx`)
Circle, person's color as bg, white initials. Sizes: 28 (chip), 32 (default), 40 (account switcher), 56 (post author). Parents get an amber crown badge top-right (size scales). Optional ring prop draws a 2px indigo outline with white inner ring.

### AvatarChip
Pill button: 36px tall, bg `#F1F5F9` (line2), radius 999, 4px left / 10px right padding. Avatar 28px on the left, person's first name on the right. Tappable — opens the **Account Switcher** sheet. Used in top-right of every screen post-login.

### Card
White surface, radius 16, padding 16 (configurable), shadow as above. Optional `onClick` makes it tappable.

### Button
- **primary**: indigo bg, white text — main CTAs
- **amber**: amber bg, white text — chore approvals, allowance actions
- **soft**: indigo-light bg, indigo text — secondary actions
- **ghost**: transparent w/ line border, indigo text — tertiary
- **success**: green bg, white — approve actions
- **danger**: `#FEE2E2` bg, danger red text — reject, destructive

Sizes: `sm` (36px tall, 14px padding-x, 13px text), `md` (48 / 18 / 15), `lg` (52 / 22 / 16). Radius 14, font-weight 600, optional icon to the left.

### Badge
Pill, 24px tall (or 20 if `size="sm"`), 10px h-padding, font 12/600. Tones: mute, indigo, amber, ok, info, danger, school, sports, family, work. Use sparingly — one badge per row.

### TopBar
- Height: **56px**, full bg-color, no border
- Layout: 80px back-button slot (left), absolutely centered title (17/700/-0.02em), 80px right slot (right)
- Right slot holds the AvatarChip; optional extra trailing actions go before it
- Back button is a 36px square ghost button with the left-chevron icon, only present on modal/detail screens

### BottomNav
- Height: **64px**, white bg, 1px top border `#E5E7EB`
- 4 equal tabs in a CSS grid: Home / Calendar / Board / Chores
- Each tab: icon (22px) above an 11/600 label, 3px gap; active = indigo, inactive = mute2 (#94A3B8); min hit target 44px tall

### FAB
- 56×56 circle (or pill if labeled) bottom-right, 16px from right edge, 84px from bottom (sits above the nav)
- Indigo bg, white plus icon, prominent shadow

### TextField
- Labeled input: 13/600 label, then a 52px-tall row
- Row: white bg, 14px radius, 1px line border, 14px h-padding, optional icon on the left in mute2
- Input itself: 15/500/-0.01em, transparent, no outline

### Toast
- Pill at bottom of viewport (above nav: bottom 88px; above modal: bottom 24px), centered
- Dark `ink` bg, white 13/600 text, 10×16 padding, radius 999
- 1.8-second auto-dismiss, comes from imperative `showToast(msg)`

### Icons
Custom 22×22 single-stroke SVGs (2px stroke, round caps/joins) — `home`, `calendar`, `board`, `chore`, `plus`, `crown`, `check`, `x`, `chev`, `back`, `bell`, `coin`, `star`, `clock`, `edit`, `send`, `mail`, `lock`, plus a custom 28×28 `house` brand mark (indigo fill, amber outline accent). Use your codebase's icon set if it has one — lucide-react / sf-symbols / material-symbols all have direct equivalents.

---

## Screens

### 01. Login (`LoginScreen`)

**Layout:** Full-bleed bg `#F9FAFB`, 24px h-padding, centered content column.

**Visual stack (top to bottom, centered):**
1. 80×80 white tile, radius 24, prominent indigo shadow, containing the 28×28 brand house icon. 20px below it.
2. "Family HQ" — 32/800/-0.03em in indigo. 8px below.
3. Subtitle — 14/500 in mute.
4. 32px gap, then form.

**Modes** — the screen is a state machine, four modes:

#### `signin`
- Email field (icon: mail). Default `sarah@familyhq.app`.
- Password field (icon: lock). Default `••••••••`.
- "Forgot password?" — right-aligned, 13/600 indigo text-button, 6px padding, sits flush right under the password field with -4px top margin.
- "Sign in" — primary lg button, full-width, 20px above.
- "New family? **Create an account**" — 13 mute footer text, the link in indigo 600.

#### `forgot`
- Header changes to "Reset password" / "We'll email you a link to reset it".
- Single email field (autofocus).
- "Send reset link" primary lg full button.
- "← Back to sign in" indigo text-button below.

#### `forgot_sent` (success)
- Header tile changes to an 80×80 `okLight` (`#D1FAE5`) tile containing the check icon at `ok` color, size 36.
- Title: "Check your inbox" 28/800.
- Subtitle: "We sent a reset link to" then user's email on the next line in `ink` bold.
- Primary "Back to sign in" button.
- "Didn't get it? **Try a different email**" footer link.

#### `signup`
- Header: "Create your family" / "Get everyone on the same page".
- Four fields stacked: Family name, Your name, Email (icon: mail), Password (icon: lock, placeholder "At least 8 characters").
- Primary "Create account" button.
- 11/600 mute2 fine-print: "By creating an account you agree to our Terms and Privacy Policy." centered.
- "← Already have an account? Sign in" link below.

**Footer (all modes):** 40px from bottom, "Made for the whole family · v1.0" in 11/600 mute2 with +0.02em letter-spacing.

### 02. Dashboard (`DashboardScreen`)

The signed-in user's home — a personalized roll-up.

**Padding:** 4px top / 16px sides / 24px bottom. Stack with **16px gap** between cards.

**1. Greeting block**
- "Good morning" / "Good afternoon" / "Good evening" (time-based) — 15/500 mute.
- "{Name} 👋" — 32/800/-0.03em ink, the wave emoji inline-rotated 14deg.
- Today's date — 14/500 mute, "Tuesday, May 26" format.

**2. "Today" card**
- Card with title row: "Today" (22/700 ink) + small chip on the right with the event count.
- Below: vertical list of today's events. Each row:
  - Left: 4px-wide colored bar (category color), 40px tall.
  - Time stack: time and end-time in 12/600 mute.
  - Title 15/700 ink + location/who 12/500 mute on the next line.
  - Right: avatar of the assignee (or family group icon).
- Empty state: "Nothing scheduled — enjoy the day."

**3. "Bulletin board" preview card**
- Header row: "Board" title + unread count pill (indigo tone) + "See all" indigo 13/600 text-button right-aligned.
- Top 2 unread posts inline (author avatar 32, author name + time, 2-line excerpt with `-webkit-line-clamp: 2`).

**4. "Chores" preview card**
- Parents see: pending-approval count + first 2 chores awaiting approval, with Approve/Reject inline.
- Teens see: their own next chore due today/tomorrow + running allowance balance ("$38.50 earned this month") in amber-light bg with coin icon.

### 03. Calendar (`CalendarScreen`)

A month grid + agenda hybrid.

**Layout:**
- Month header row: month/year (22/700) + chevron prev/next 36px buttons. 16px padding.
- Day-of-week strip: 7 columns, 12/600 mute2, uppercased single-letter (S M T W T F S).
- Month grid: 6×7 cells, each ~52px tall. Today's cell has a 36×36 indigo filled circle behind the number, white text. Days with events show 2–3 colored dots (category colors) bottom of cell, 4px each, 3px gap.
- Below grid: agenda list of the **selected day's events**. Same row format as Dashboard's Today card.
- FAB bottom-right opens "Add Event".

### 04. Bulletin Board (`BoardScreen`)

A family group chat / shared feed.

**Layout:**
- 16px padding, 12px gap between posts.
- Each post is a Card:
  - Header row: 56px avatar, name (15/700) + "20m ago" 12/500 mute, optional tone badge top-right.
  - 12px gap, body text (16/500 ink, line-height 1.5).
  - 12px gap, footer row: small action chips (heart, comment) in mute, optional "Action needed" amber badge.
  - Unread posts have a 4px indigo left-border accent stripe.
- FAB bottom-right opens compose sheet.

**Post categories** (badge tone in header):
- `family` (Family update) — indigo tone
- `amber` (Action needed) — amber tone

### 05a. Chores — Teen view (`ChoresTeenScreen`)

For when current user is a teen. Personal, motivational.

**Stack:**
1. **Earnings card** — amber-light bg, big "$38.50" balance (32/800 amberDark), "earned this month" caption, small history line.
2. **My chores** section header (22/700) with count chip.
3. **Pending list**: each chore is a Card with emoji on the left (24px), title (15/700) + due date (12/500 mute) middle, big "Mark done" primary-sm button right. Tap → toast "Marked complete — waiting for approval" and chore moves to a faded "Waiting for approval" section.
4. **Recently approved** section: subtler — checkmark in ok-green circle on the left, strike-through title, "$3.00 earned" pill on right.

### 05b. Chores — Parent view (`ChoresParentScreen`)

For when current user is a parent. Family-wide.

**Stack:**
1. **Approvals queue card** (only if any pending) — amber-light bg, "{N} chores awaiting your approval" heading.
   - Each row: emoji + title + assignee avatar + Approve (success-sm) + Reject (danger-sm) buttons.
2. **All chores** segmented control: filter by All / Maya / Ben.
3. List of chores grouped by status: Pending → Pending approval → Approved this week. Approved rows are dimmed.
4. FAB → Add Chore.

### 06. Add Chore (`AddChoreScreen`) — modal

**TopBar** with back button + title "Add Chore". Body scrollable, 16px h-padding, 12px gap.

Fields:
- Title (TextField, autofocus, placeholder "What needs doing?")
- Emoji picker — horizontal scroll of 24px emoji chips, current one highlighted with indigo-light bg
- Assign to — segmented control: Maya / Ben / Either (with avatars)
- Due — chip row: Today / Tomorrow / This week / Pick date
- Reward row — two side-by-side number inputs: points (with star icon) and dollars (with coin icon)
- Sticky bottom: "Add chore" primary lg full button, 16px padding, white bg, 1px top line border

### 07. Add Event (`AddEventScreen`) — modal

Same modal pattern as Add Chore. Fields:
- Title (autofocus)
- Date (chip row: Today / Tomorrow / Pick date)
- Start time / End time row (two 50/50 TextFields)
- Category — segmented control with color dot per option: School / Sports / Family / Work
- Who's it for — multi-select avatar row (tap to ring-select); "Family" option = filled indigo pill
- Location (optional TextField)
- Sticky bottom: "Add event" primary lg full button

### 08. Compose Post (`ComposeSheet`) — modal

Bottom-sheet style, ~80% of screen height, slides up.
- Drag handle (40×4 line2 pill) at top.
- Header: "New post" 17/700 + close button.
- Author row: current user's 32 avatar + name.
- Multi-line textarea: no border, 16/500 ink, placeholder "Share something with the family…", auto-grows.
- Tag chips row (optional): None / Family update / Action needed.
- Sticky bottom: "Post" primary lg full button (right-aligned indigo, with send icon).

### 09. Account Switcher (`AccountSwitcher`) — bottom sheet

Slides up from the bottom over a 45%-opacity scrim. Triggered by tapping the AvatarChip in the TopBar.

- Sheet: white bg, top corners radius 24, padding 12/16/24, the -8px-y shadow above
- Drag handle: 40×4 line2 pill, 4/auto/14 margin
- "SWITCH ACCOUNT" caption (11/700 mute, uppercase, +0.08em letter-spacing)
- One row per person: 40px avatar (with crown if parent) + name (15/700) + role + (teens only) "$balance" in 12/500 mute. Currently-active row has an indigo-light bg and a 24px filled indigo checkmark circle on the right.
- 1px divider, then a full-width 48px "Sign out" button — transparent bg, danger-red text, 14/600

**Interactions:**
- Tap a person → switches the current user, closes the sheet, shows toast "Switched to {Name}"
- Tap the scrim → close
- Tap "Sign out" → return to LoginScreen

---

## Interactions & Navigation

### Top-level routing
The app is a single mobile shell. Routing is a simple `screen` state:
`dashboard | calendar | board | chores | add_chore | add_event | compose | account_switcher (modal)`

`add_chore`, `add_event`, `compose` are **modal screens** — they hide the BottomNav and show a Back button in the TopBar. All others show the nav and the AvatarChip.

When a teen is signed in, `add_chore` is not accessible.

### Toast
A non-blocking 1.8-second confirmation pill at the bottom of the screen. Fired on: chore marked complete, chore approved, chore rejected, post created, event/chore added, account switched.

### Animations
- Bottom sheets: fade + slide-up, 220ms `cubic-bezier(.2,.8,.2,1)`. Scrim fades 160ms ease-out.
- Toast: simple opacity fade in/out, ~200ms.
- Card press: subtle 120ms ease scale or background tint — implementation-dependent.
- No skeleton loaders or complex transitions — the design assumes responsive local state.

### Form validation
The prototype doesn't enforce validation, but for production:
- Email: standard format check on Sign in / Reset / Sign up.
- Password: ≥8 chars on Sign up.
- Add chore / event: title required, assignee required.
- Compose post: non-empty text required.

Disabled-button state: opacity 0.5, `cursor: not-allowed`.

### Responsive
This is a mobile-only product. The HTML prototype shows it inside an iPhone frame on desktop ≥768px wide; native implementations don't need this. Min target width: 320px. Max: 480px (then in a frame on tablets+).

---

## State Model

```ts
type Person = {
  id: 'sarah'|'david'|'maya'|'ben';
  name: string;
  initials: string;
  color: string;        // hex
  role: 'parent' | 'teen';
  balance?: number;     // teens only
};

type Event = {
  day: number;          // day of month (demo only; production: ISO date)
  title: string;
  time: string;         // e.g. '3:30 PM'
  end?: string;
  category: 'school' | 'sports' | 'family' | 'work';
  who: 'sarah'|'david'|'maya'|'ben'|'family';
  location?: string;
};

type Post = {
  id: number;
  author: Person['id'];
  time: string;         // human relative time
  unread: boolean;
  text: string;
  tag?: { label: string; tone: 'family' | 'amber' };
};

type Chore = {
  id: string;
  title: string;
  emoji: string;
  assignee: 'maya' | 'ben';
  due: string;          // human label (Today / Tomorrow / 'This Sat' / weekday)
  points: number;
  dollars: number;
  status: 'pending' | 'pending_approval' | 'approved';
};

type AppState = {
  loggedIn: boolean;
  currentUserId: Person['id'];
  screen: ScreenId;
  data: { events: Event[]; posts: Post[]; chores: Chore[]; todayDay: number };
  toast: string | null;
  accountSwitcherOpen: boolean;
};
```

### Actions
- `signIn()` — flip loggedIn → true
- `signOut()` — flip loggedIn → false, close switcher
- `switchUser(id)` — set currentUserId, bounce off any screen the new role can't access (e.g. teen on add_chore → dashboard), toast
- `markChoreComplete(id)` — status: pending → pending_approval, toast
- `approveChore(id)` — status: pending_approval → approved, toast
- `rejectChore(id)` — status: pending_approval → pending, toast (sent back)
- `markPostRead(id)` — unread → false (silent)
- `addPost({text})` — prepend, return to board, toast
- `addChore({...})` — prepend, return to chores, toast
- `addEvent({...})` — prepend, return to calendar, toast

The prototype keeps all state in memory; in production this is a backend + websockets / push for real-time across family members' devices.

---

## Assets

The brand mark (the indigo house with amber outline accent) is inline SVG in `components.jsx` as `Icon.house`. No external image assets are used — every icon and avatar is rendered inline. The prototype has no logo image to extract.

If a real logo / app icon is needed later, design it from the same vocabulary: rounded indigo house with an amber accent.

---

## Files

```
design_handoff_family_hq/
├── README.md                    ← you are here
├── Family HQ.html               ← self-contained working prototype (open in browser)
└── design_source/               ← uncompiled source
    ├── Family HQ source.html    ← page shell, fonts, mount point
    ├── app.jsx                  ← App component, routing, state, actions
    ├── components.jsx           ← HB tokens, PEOPLE, Icons, primitives
    ├── screens.jsx              ← All screens (LoginScreen, DashboardScreen, …)
    ├── mount.jsx                ← Responsive iPhone-frame bootstrap
    ├── ios-frame.jsx            ← iPhone bezel wrapper (desktop only)
    └── tweaks-panel.jsx         ← Design-time tweak panel (NOT part of the product)
```

Implementation order suggestion:
1. Build the **token layer** (colors, type scale, spacing).
2. Build the **primitives** (Avatar, AvatarChip, Card, Button, Badge, TextField, TopBar, BottomNav, FAB, Toast).
3. Build **Login** (all four modes) and **Dashboard** to get the shell working.
4. Add **Account Switcher** + bottom-sheet pattern.
5. Build **Bulletin Board** and **Compose**.
6. Build **Chores Parent** + **Chores Teen** + **Add Chore** (most logic).
7. Build **Calendar** + **Add Event** last (most layout work).
