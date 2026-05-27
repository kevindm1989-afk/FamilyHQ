// Family HQ — App shell, routing, state

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "currentUserId": "sarah",
  "startScreen": "dashboard"
}/*EDITMODE-END*/;

const initialData = {
  todayDay: 26, // Tue May 26, 2026
  events: [
    { day: 26, title: 'Math tutoring', time: '3:30 PM', end: '4:30 PM', category: 'school', who: 'ben', location: 'Library' },
    { day: 26, title: 'Soccer practice', time: '5:30 PM', end: '7:00 PM', category: 'sports', who: 'maya', location: 'Eastside field' },
    { day: 26, title: 'Family dinner', time: '7:30 PM', category: 'family', who: 'family' },
    { day: 27, title: 'Dentist — Ben', time: '10:00 AM', category: 'school', who: 'ben' },
    { day: 27, title: 'Standup', time: '9:30 AM', category: 'work', who: 'sarah' },
    { day: 28, title: 'Track meet', time: '4:00 PM', category: 'sports', who: 'maya' },
    { day: 29, title: 'Movie night', time: '8:00 PM', category: 'family', who: 'family' },
    { day: 30, title: 'Grandma visits', time: '12:00 PM', category: 'family', who: 'family' },
    { day: 31, title: 'Maya — birthday!', time: 'All day', category: 'family', who: 'maya' },
    { day: 22, title: 'Recital', time: '6:00 PM', category: 'school', who: 'ben' },
    { day: 20, title: 'Quarterly review', time: '2:00 PM', category: 'work', who: 'david' },
    { day: 15, title: 'Game night', time: '7:30 PM', category: 'family', who: 'family' },
  ],
  posts: [
    { id: 1, author: 'sarah', time: '20m ago', unread: true,
      text: 'Heads up everyone — grandma is visiting this Saturday for lunch. Maya, can you tidy up the guest room before she arrives?',
      tag: { label: 'Family update', tone: 'family' } },
    { id: 2, author: 'david', time: '2h ago', unread: true,
      text: 'Working late tonight, will grab takeout on the way home. What is everyone in the mood for? Reply with votes 🍕🌮🍔',
    },
    { id: 3, author: 'maya', time: 'Yesterday',
      text: 'Field trip permission slip is on the counter — needs a signature by tomorrow morning please!',
      tag: { label: 'Action needed', tone: 'amber' } },
    { id: 4, author: 'ben', time: 'Yesterday',
      text: 'Made the basketball team!! 🏀 Practice starts Monday after school.' },
    { id: 5, author: 'sarah', time: '2 days ago',
      text: 'Reminder: phones off the table at dinner this week. Let\'s actually talk to each other 😊' },
  ],
  chores: [
    { id: 'c1', title: 'Take out trash',     emoji: '🗑️', assignee: 'maya', due: 'Today',     points: 10, dollars: 3.00, status: 'pending' },
    { id: 'c2', title: 'Walk the dog',       emoji: '🐕', assignee: 'ben',  due: 'Today',     points: 5,  dollars: 2.00, status: 'pending' },
    { id: 'c3', title: 'Vacuum living room', emoji: '🧹', assignee: 'maya', due: 'Tomorrow',  points: 15, dollars: 5.00, status: 'pending_approval' },
    { id: 'c4', title: 'Empty dishwasher',   emoji: '🍽️', assignee: 'ben',  due: 'Today',     points: 5,  dollars: 2.00, status: 'pending_approval' },
    { id: 'c5', title: 'Mow the lawn',       emoji: '🌱', assignee: 'maya', due: 'This Sat',  points: 25, dollars: 10.00, status: 'pending' },
    { id: 'c6', title: 'Make your bed',      emoji: '🛏️', assignee: 'ben',  due: 'Yesterday', points: 5,  dollars: 1.00, status: 'approved' },
    { id: 'c7', title: 'Fold laundry',       emoji: '👕', assignee: 'maya', due: 'Mon',       points: 10, dollars: 4.00, status: 'approved' },
    { id: 'c8', title: 'Water the plants',   emoji: '🪴', assignee: 'ben',  due: 'Sun',       points: 5,  dollars: 2.00, status: 'approved' },
  ],
};

const SCREEN_TITLES = {
  dashboard: 'Family HQ',
  calendar:  'Calendar',
  board:     'Bulletin Board',
  chores:    'Chores',
  add_chore: 'Add Chore',
  add_event: 'Add Event',
  compose:   'New Post',
};

function App() {
  const [tweaks, setTweakRaw] = useTweaks(TWEAK_DEFAULTS);
  const setTweak = (k, v) => setTweakRaw(typeof k === 'object' ? k : { [k]: v });
  const [loggedIn, setLoggedIn] = React.useState(false);
  const [screen, setScreen] = React.useState(tweaks.startScreen || 'dashboard');
  const [data, setData] = React.useState(initialData);
  const [toast, setToast] = React.useState(null);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = React.useState(false);

  const currentUser = PEOPLE[tweaks.currentUserId] || PEOPLE.sarah;

  React.useEffect(() => {
    // when user swaps, ensure we don't get stuck on an inaccessible screen
    if (screen === 'add_chore' && currentUser.role !== 'parent') setScreen('chores');
  }, [tweaks.currentUserId]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  // actions
  const markChoreComplete = (id) => {
    setData(d => ({ ...d, chores: d.chores.map(c => c.id === id ? { ...c, status: 'pending_approval' } : c) }));
    showToast('Marked complete — waiting for approval');
  };
  const approveChore = (id) => {
    setData(d => ({ ...d, chores: d.chores.map(c => c.id === id ? { ...c, status: 'approved' } : c) }));
    showToast('Approved ✓');
  };
  const rejectChore = (id) => {
    setData(d => ({ ...d, chores: d.chores.map(c => c.id === id ? { ...c, status: 'pending' } : c) }));
    showToast('Sent back to teen');
  };
  const markPostRead = (id) => {
    setData(d => ({ ...d, posts: d.posts.map(p => p.id === id ? { ...p, unread: false } : p) }));
  };
  const addPost = (text) => {
    setData(d => ({ ...d, posts: [{ id: Date.now(), author: currentUser.id, time: 'Just now', unread: false, text }, ...d.posts] }));
    setScreen('board');
    showToast('Posted to the board');
  };
  const addChore = (input) => {
    const id = 'c' + Date.now();
    setData(d => ({ ...d, chores: [{ ...input, id, status: 'pending', emoji: '✨' }, ...d.chores] }));
    setScreen('chores');
    showToast('Chore added');
  };
  const addEvent = (input) => {
    setData(d => ({ ...d, events: [{ ...input, day: d.todayDay }, ...d.events] }));
    setScreen('calendar');
    showToast('Event added');
  };

  if (!loggedIn) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }} data-screen-label="01 Login">
        <LoginScreen onSignIn={() => setLoggedIn(true)} />
      </div>
    );
  }

  // Render top bar + main + nav
  const renderScreen = () => {
    if (screen === 'dashboard') return <DashboardScreen user={currentUser} data={data} onNav={setScreen} />;
    if (screen === 'calendar')  return <CalendarScreen user={currentUser} data={data} onAddEvent={() => setScreen('add_event')} />;
    if (screen === 'board')     return <BoardScreen data={data} onCompose={() => setScreen('compose')} onMarkRead={markPostRead} />;
    if (screen === 'chores')    return currentUser.role === 'parent'
      ? <ChoresParentScreen data={data} onApprove={approveChore} onReject={rejectChore} onAddChore={() => setScreen('add_chore')} />
      : <ChoresTeenScreen user={currentUser} data={data} onMarkComplete={markChoreComplete} />;
    if (screen === 'add_chore') return <AddChoreScreen onSave={addChore} onCancel={() => setScreen('chores')} />;
    if (screen === 'add_event') return <AddEventScreen onSave={addEvent} onCancel={() => setScreen('calendar')} />;
    if (screen === 'compose')   return <ComposeSheet user={currentUser} onPost={addPost} onClose={() => setScreen('board')} />;
    return null;
  };

  const isModal = ['add_chore', 'add_event', 'compose'].includes(screen);
  const tabFor = (s) => ['add_chore'].includes(s) ? 'chores' : ['add_event'].includes(s) ? 'calendar' : ['compose'].includes(s) ? 'board' : s;

  const screenLabel = {
    dashboard: '02 Dashboard', calendar: '03 Calendar', board: '04 Bulletin Board',
    chores: currentUser.role === 'parent' ? '05 Chores (Parent)' : '05 Chores (Teen)',
    add_chore: '06 Add Chore', add_event: '07 Add Event', compose: '08 Compose Post',
  }[screen];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: HB.bg, position: 'relative' }} data-screen-label={screenLabel}>
      <TopBar
        title={SCREEN_TITLES[screen]}
        currentUser={currentUser}
        onAvatarClick={() => setAccountSwitcherOpen(true)}
        onBack={isModal ? () => setScreen(tabFor(screen)) : null}
      />
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}>
        {renderScreen()}
      </div>
      {!isModal && <BottomNav current={tabFor(screen)} onChange={setScreen} />}

      {toast && (
        <div style={{
          position: 'absolute', bottom: isModal ? 24 : 88, left: '50%', transform: 'translateX(-50%)',
          background: HB.ink, color: '#fff', padding: '10px 16px', borderRadius: 999,
          fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
          boxShadow: '0 8px 24px rgba(15,23,42,0.25)',
          zIndex: 20,
        }}>{toast}</div>
      )}

      {accountSwitcherOpen && (
        <AccountSwitcher
          currentUserId={tweaks.currentUserId}
          onPick={(id) => {
            setTweak('currentUserId', id);
            setAccountSwitcherOpen(false);
            // bounce back to a screen the new user can access
            if (screen === 'add_chore' || screen === 'add_event') setScreen('dashboard');
            showToast(`Switched to ${PEOPLE[id].name}`);
          }}
          onSignOut={() => { setAccountSwitcherOpen(false); setLoggedIn(false); }}
          onClose={() => setAccountSwitcherOpen(false)}
        />
      )}

      {/* TWEAKS panel */}
      <TweaksPanel title="Tweaks">
        <TweakSection title="Who's signed in?">
          <TweakSelect
            label="Account"
            value={tweaks.currentUserId}
            onChange={(v) => setTweak('currentUserId', v)}
            options={[
              { value: 'sarah', label: 'Sarah (parent)' },
              { value: 'david', label: 'David (parent)' },
              { value: 'maya',  label: 'Maya (teen)' },
              { value: 'ben',   label: 'Ben (teen)' },
            ]}
          />
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 6, letterSpacing: '-0.01em', lineHeight: 1.4 }}>
            Parents see the family-wide Chore Tracker with Approve / Reject. Teens see only their own chores + allowance balance.
          </div>
        </TweakSection>
        <TweakSection title="Quick jump">
          <TweakButton onClick={() => { setLoggedIn(false); }}>Show login screen</TweakButton>
          <TweakButton onClick={() => setScreen('dashboard')}>Dashboard</TweakButton>
          <TweakButton onClick={() => setScreen('calendar')}>Calendar</TweakButton>
          <TweakButton onClick={() => setScreen('board')}>Bulletin Board</TweakButton>
          <TweakButton onClick={() => setScreen('chores')}>Chore Tracker</TweakButton>
          {currentUser.role === 'parent' && <TweakButton onClick={() => setScreen('add_chore')}>Add Chore form</TweakButton>}
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

window.App = App;
