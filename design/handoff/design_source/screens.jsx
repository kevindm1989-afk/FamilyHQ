// Family HQ — Screens

// ─────────────── LOGIN ───────────────
function LoginScreen({ onSignIn }) {
  const [mode, setMode] = React.useState('signin'); // 'signin' | 'forgot' | 'forgot_sent' | 'signup'
  const [email, setEmail] = React.useState('sarah@familyhq.app');
  const [password, setPassword] = React.useState('••••••••');
  const [familyName, setFamilyName] = React.useState('');
  const [yourName, setYourName] = React.useState('');
  const [signupEmail, setSignupEmail] = React.useState('');
  const [signupPassword, setSignupPassword] = React.useState('');
  const [resetEmail, setResetEmail] = React.useState('sarah@familyhq.app');

  const Header = ({ title, subtitle }) => (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <div style={{
        width: 80, height: 80, borderRadius: 24, background: '#fff',
        margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(55,48,163,0.18), 0 2px 6px rgba(55,48,163,0.08)',
      }}><Icon.house /></div>
      <div style={{ fontSize: 32, fontWeight: 800, color: HB.indigo, letterSpacing: '-0.03em', lineHeight: 1 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 14, color: HB.mute, marginTop: 8, letterSpacing: '-0.01em' }}>{subtitle}</div>}
    </div>
  );

  const BackLink = ({ children = 'Back to sign in' }) => (
    <button onClick={() => setMode('signin')} style={{
      marginTop: 20, background: 'none', border: 'none', color: HB.indigo,
      fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: '8px 0',
      letterSpacing: '-0.01em', fontFamily: 'inherit', alignSelf: 'center',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    }}>← {children}</button>
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: HB.bg, padding: '0 24px' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>

        {mode === 'signin' && (
          <>
            <Header title="Family HQ" subtitle="Welcome back to your family" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <TextField label="Email" value={email} onChange={setEmail} icon={<Icon.mail />} placeholder="you@family.com" type="email" />
              <TextField label="Password" value={password} onChange={setPassword} icon={<Icon.lock />} placeholder="••••••••" type="password" />
              <button onClick={() => setMode('forgot')} style={{
                alignSelf: 'flex-end', background: 'none', border: 'none', color: HB.indigo,
                fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', marginTop: -4,
                letterSpacing: '-0.01em', fontFamily: 'inherit',
              }}>Forgot password?</button>
            </div>
            <Button onClick={onSignIn} variant="primary" size="lg" full style={{ marginTop: 20 }}>Sign in</Button>
            <div style={{ marginTop: 20, textAlign: 'center', fontSize: 13, color: HB.mute, letterSpacing: '-0.01em' }}>
              New family?{' '}
              <button onClick={() => setMode('signup')} style={{
                color: HB.indigo, fontWeight: 600, background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13, letterSpacing: '-0.01em', fontFamily: 'inherit', padding: 0,
              }}>Create an account</button>
            </div>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <Header title="Reset password" subtitle="We'll email you a link to reset it" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <TextField label="Email" value={resetEmail} onChange={setResetEmail} icon={<Icon.mail />} placeholder="you@family.com" type="email" autoFocus />
            </div>
            <Button onClick={() => setMode('forgot_sent')} variant="primary" size="lg" full style={{ marginTop: 20 }}>Send reset link</Button>
            <div style={{ display: 'flex', justifyContent: 'center' }}><BackLink /></div>
          </>
        )}

        {mode === 'forgot_sent' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{
                width: 80, height: 80, borderRadius: 24, background: HB.okLight,
                margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: HB.ok,
              }}><Icon.check style={{ width: 36, height: 36 }} /></div>
              <div style={{ fontSize: 28, fontWeight: 800, color: HB.ink, letterSpacing: '-0.03em', lineHeight: 1.1 }}>Check your inbox</div>
              <div style={{ fontSize: 14, color: HB.mute, marginTop: 10, letterSpacing: '-0.01em', lineHeight: 1.5 }}>
                We sent a reset link to<br /><span style={{ color: HB.ink, fontWeight: 600 }}>{resetEmail}</span>
              </div>
            </div>
            <Button onClick={() => setMode('signin')} variant="primary" size="lg" full>Back to sign in</Button>
            <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: HB.mute, letterSpacing: '-0.01em' }}>
              Didn't get it?{' '}
              <button onClick={() => setMode('forgot')} style={{
                color: HB.indigo, fontWeight: 600, background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13, letterSpacing: '-0.01em', fontFamily: 'inherit', padding: 0,
              }}>Try a different email</button>
            </div>
          </>
        )}

        {mode === 'signup' && (
          <>
            <Header title="Create your family" subtitle="Get everyone on the same page" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <TextField label="Family name" value={familyName} onChange={setFamilyName} placeholder="The Johnsons" autoFocus />
              <TextField label="Your name" value={yourName} onChange={setYourName} placeholder="Sarah" />
              <TextField label="Email" value={signupEmail} onChange={setSignupEmail} icon={<Icon.mail />} placeholder="you@family.com" type="email" />
              <TextField label="Password" value={signupPassword} onChange={setSignupPassword} icon={<Icon.lock />} placeholder="At least 8 characters" type="password" />
            </div>
            <Button onClick={onSignIn} variant="primary" size="lg" full style={{ marginTop: 20 }}>Create account</Button>
            <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11, color: HB.mute2, letterSpacing: '-0.01em', lineHeight: 1.5, padding: '0 8px' }}>
              By creating an account you agree to our Terms and Privacy Policy.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}><BackLink>Already have an account? Sign in</BackLink></div>
          </>
        )}

      </div>
      <div style={{ paddingBottom: 40, textAlign: 'center', fontSize: 11, color: HB.mute2, letterSpacing: '0.02em' }}>
        Made for the whole family · v1.0
      </div>
    </div>
  );
}

// ─────────────── DASHBOARD ───────────────
function DashboardScreen({ user, onNav, data }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayEvents = data.events.filter(e => e.day === data.todayDay);
  const unreadPosts = data.posts.filter(p => p.unread).length;
  const myChores = data.chores.filter(c =>
    (user.role === 'teen' ? c.assignee === user.id : true) && c.status === 'pending'
  );

  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 15, color: HB.mute, fontWeight: 500, letterSpacing: '-0.01em' }}>{greet},</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: HB.ink, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 2 }}>
          {user.name} <span style={{ display: 'inline-block', transform: 'rotate(14deg)' }}>👋</span>
        </div>
        <div style={{ fontSize: 14, color: HB.mute, marginTop: 6, letterSpacing: '-0.01em' }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <Card style={{ background: `linear-gradient(135deg, ${HB.indigo} 0%, #4F46E5 100%)`, color: '#fff', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, opacity: 0.75, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Today at a glance</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
              {todayEvents.length} {todayEvents.length === 1 ? 'event' : 'events'} · {myChores.length} {myChores.length === 1 ? 'chore' : 'chores'}
            </div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 8, letterSpacing: '-0.01em' }}>
              {todayEvents[0] ? `Next: ${todayEvents[0].time} · ${todayEvents[0].title}` : 'Nothing scheduled — enjoy the day'}
            </div>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}><Icon.calendar style={{ color: '#fff' }} /></div>
        </div>
      </Card>

      <SummaryCard onClick={() => onNav('calendar')} tone="info" icon={<Icon.calendar />}
        label="Today's Events" count={todayEvents.length}
        preview={todayEvents.slice(0, 2).map(e => `${e.time} ${e.title}`).join(' · ') || 'Nothing scheduled today'} />
      <SummaryCard onClick={() => onNav('board')} tone="amber" icon={<Icon.board />}
        label="Unread Posts" count={unreadPosts}
        preview={data.posts.find(p => p.unread)?.text?.slice(0, 64) || 'You\'re all caught up'} />
      <SummaryCard onClick={() => onNav('chores')} tone="indigo" icon={<Icon.chore />}
        label={user.role === 'teen' ? 'My Pending Chores' : 'Family Chores'} count={myChores.length}
        preview={myChores[0]?.title ? `Next: ${myChores[0].title} · $${myChores[0].dollars.toFixed(2)}` : 'All done — nice work'} />

      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: HB.ink2, letterSpacing: '-0.01em', margin: '0 2px 10px', textTransform: 'uppercase' }}>The fam</div>
        <Card pad={16}>
          <div style={{ display: 'flex', justifyContent: 'space-around' }}>
            {Object.values(PEOPLE).map(p => (
              <div key={p.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Avatar person={p} size={44} />
                <div style={{ fontSize: 12, fontWeight: 600, color: HB.ink2, letterSpacing: '-0.01em' }}>{p.name}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, count, preview, tone, onClick }) {
  const tones = {
    info:   { bg: HB.infoLight, color: '#1D4ED8' },
    amber:  { bg: HB.amberLight, color: HB.amberDark },
    indigo: { bg: HB.indigoLight, color: HB.indigo },
  }[tone];
  return (
    <Card onClick={onClick} pad={16}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14, background: tones.bg, color: tones.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: HB.ink, letterSpacing: '-0.02em' }}>{label}</div>
            <div style={{ fontSize: 13, color: tones.color, fontWeight: 700 }}>{count}</div>
          </div>
          <div style={{
            fontSize: 13, color: HB.mute, marginTop: 3, letterSpacing: '-0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{preview}</div>
        </div>
        <Icon.chev style={{ color: HB.mute2 }} />
      </div>
    </Card>
  );
}

// ─────────────── CALENDAR ───────────────
function CalendarScreen({ user, data, onAddEvent }) {
  const [selected, setSelected] = React.useState(data.todayDay);
  const year = 2026, month = 4;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = data.todayDay;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDay = {};
  data.events.forEach(e => { (eventsByDay[e.day] = eventsByDay[e.day] || []).push(e); });
  const selEvents = eventsByDay[selected] || [];

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <div style={{ padding: '4px 16px 100px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 4px 16px' }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: HB.ink, letterSpacing: '-0.03em', lineHeight: 1 }}>May</div>
            <div style={{ fontSize: 14, color: HB.mute, marginTop: 2, letterSpacing: '-0.01em' }}>2026</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <NavBtn><Icon.back /></NavBtn>
            <NavBtn><Icon.chev /></NavBtn>
          </div>
        </div>

        <Card pad={14}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 6 }}>
            {['S','M','T','W','T','F','S'].map((d, i) => (
              <div key={i} style={{
                textAlign: 'center', fontSize: 11, fontWeight: 700, color: HB.mute2,
                letterSpacing: '0.05em', padding: '4px 0',
              }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 2 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} style={{ height: 44 }} />;
              const isToday = d === today;
              const isSel = d === selected;
              const evs = eventsByDay[d] || [];
              return (
                <button key={i} onClick={() => setSelected(d)} style={{
                  height: 44, border: 'none', cursor: 'pointer', borderRadius: 12,
                  background: isSel ? HB.indigo : (isToday ? HB.indigoLight : 'transparent'),
                  color: isSel ? '#fff' : (isToday ? HB.indigo : HB.ink),
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3,
                  fontFamily: 'inherit', padding: 0,
                }}>
                  <div style={{ fontSize: 14, fontWeight: isSel || isToday ? 700 : 500, letterSpacing: '-0.01em' }}>{d}</div>
                  <div style={{ display: 'flex', gap: 2, height: 4 }}>
                    {evs.slice(0, 3).map((e, j) => (
                      <div key={j} style={{
                        width: 4, height: 4, borderRadius: 2,
                        background: isSel ? '#fff' : ({ school: HB.school, sports: HB.sports, family: HB.family, work: HB.work }[e.category]),
                      }} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <div style={{ display: 'flex', gap: 14, padding: '14px 6px 12px', flexWrap: 'wrap' }}>
          {[['school','School',HB.school],['sports','Sports',HB.sports],['family','Family',HB.family],['work','Work',HB.work]].map(([k,l,c]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: 4, background: c }} />
              <div style={{ fontSize: 12, color: HB.ink2, fontWeight: 500, letterSpacing: '-0.01em' }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 6px 10px' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: HB.ink, letterSpacing: '-0.02em' }}>
              {new Date(year, month, selected).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </div>
            <div style={{ fontSize: 12, color: HB.mute, fontWeight: 600 }}>{selEvents.length} {selEvents.length === 1 ? 'event' : 'events'}</div>
          </div>
          {selEvents.length === 0 ? (
            <Card pad={24} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: HB.mute, letterSpacing: '-0.01em' }}>No events scheduled</div>
              {user.role === 'parent' && <div style={{ fontSize: 12, color: HB.mute2, marginTop: 4 }}>Tap + to add one</div>}
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selEvents.map((e, i) => <EventRow key={i} event={e} />)}
            </div>
          )}
        </div>
      </div>

      {user.role === 'parent' && <FAB onClick={onAddEvent} icon={<Icon.plus />} />}
    </div>
  );
}

function NavBtn({ children }) {
  return (
    <button style={{
      width: 36, height: 36, borderRadius: 12, background: HB.card,
      border: `1px solid ${HB.line}`, cursor: 'pointer', color: HB.ink2,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</button>
  );
}

function EventRow({ event }) {
  const tone = { school: HB.school, sports: HB.sports, family: HB.family, work: HB.work }[event.category];
  const person = PEOPLE[event.who];
  return (
    <Card pad={14}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: tone, flexShrink: 0, minHeight: 40 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: HB.ink, letterSpacing: '-0.02em' }}>{event.title}</div>
            <Badge size="sm" tone={event.category}>{event.category}</Badge>
          </div>
          <div style={{ fontSize: 13, color: HB.mute, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '-0.01em', flexWrap: 'wrap' }}>
            <Icon.clock /> {event.time}{event.end ? ` – ${event.end}` : ''}
            {event.location && <span style={{ color: HB.mute2 }}>· {event.location}</span>}
          </div>
        </div>
        {person && <Avatar person={person} size={28} showCrown={false} />}
      </div>
    </Card>
  );
}

// ─────────────── BULLETIN BOARD ───────────────
function BoardScreen({ data, onCompose, onMarkRead }) {
  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <div style={{ padding: '4px 16px 100px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.posts.map(post => <PostCard key={post.id} post={post} onTap={() => onMarkRead(post.id)} />)}
      </div>
      <FAB onClick={onCompose} icon={<Icon.edit style={{ width: 18, height: 18 }} />} label="Post" />
    </div>
  );
}

function PostCard({ post, onTap }) {
  const person = PEOPLE[post.author];
  return (
    <Card onClick={onTap} pad={16} style={{
      boxShadow: post.unread
        ? '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06), inset 3px 0 0 ' + HB.amber
        : '0 1px 2px rgba(15,23,42,0.04), 0 4px 16px rgba(15,23,42,0.06)',
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Avatar person={person} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: HB.ink, letterSpacing: '-0.01em' }}>{person.name}</div>
            <span style={{ fontSize: 12, color: HB.mute2 }}>·</span>
            <div style={{ fontSize: 12, color: HB.mute, letterSpacing: '-0.01em' }}>{post.time}</div>
            {post.unread && <div style={{ width: 7, height: 7, borderRadius: 4, background: HB.amber, marginLeft: 'auto' }} />}
          </div>
          <div style={{
            fontSize: 14.5, color: HB.ink2, marginTop: 6, lineHeight: 1.5, letterSpacing: '-0.01em',
            whiteSpace: 'pre-wrap', textWrap: 'pretty',
          }}>{post.text}</div>
          {post.tag && <div style={{ marginTop: 10 }}><Badge tone={post.tag.tone} size="sm">{post.tag.label}</Badge></div>}
        </div>
      </div>
    </Card>
  );
}

// ─────────────── CHORES — TEEN ───────────────
function ChoresTeenScreen({ user, data, onMarkComplete }) {
  const mine = data.chores.filter(c => c.assignee === user.id);
  const pending = mine.filter(c => c.status === 'pending');
  const inReview = mine.filter(c => c.status === 'pending_approval');
  const done = mine.filter(c => c.status === 'approved');
  const ptsThisWeek = done.reduce((a, c) => a + c.points, 0);
  const earned = done.reduce((a, c) => a + c.dollars, 0);

  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card style={{ background: `linear-gradient(135deg, ${HB.indigo}, #4F46E5)`, color: '#fff', padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, opacity: 0.8, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Allowance balance</div>
            <div style={{ fontSize: 36, fontWeight: 800, marginTop: 6, letterSpacing: '-0.03em', lineHeight: 1 }}>${user.balance.toFixed(2)}</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 8, letterSpacing: '-0.01em' }}>
              +${earned.toFixed(2)} this week · {ptsThisWeek} pts
            </div>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}><Icon.coin style={{ width: 22, height: 22 }} /></div>
        </div>
      </Card>

      <ChoreSection title="To do" count={pending.length} emptyMsg="All caught up — go enjoy your day">
        {pending.map(c => <ChoreCard key={c.id} chore={c} onAction={onMarkComplete} actionLabel="Mark complete" actionVariant="primary" />)}
      </ChoreSection>

      <ChoreSection title="Waiting for approval" count={inReview.length} emptyMsg="Nothing pending review">
        {inReview.map(c => <ChoreCard key={c.id} chore={c} />)}
      </ChoreSection>

      <ChoreSection title="Approved this week" count={done.length} emptyMsg="No completed chores yet">
        {done.map(c => <ChoreCard key={c.id} chore={c} />)}
      </ChoreSection>
    </div>
  );
}

function ChoreSection({ title, count, children, emptyMsg }) {
  const empty = React.Children.count(children) === 0;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 6px 10px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: HB.ink2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</div>
        <div style={{ fontSize: 12, color: HB.mute2, fontWeight: 600 }}>{count}</div>
      </div>
      {empty ? (
        <Card pad={16} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: HB.mute, letterSpacing: '-0.01em' }}>{emptyMsg || 'Nothing here yet'}</div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
      )}
    </div>
  );
}

function statusBadge(status) {
  if (status === 'pending') return <Badge tone="amber">Pending</Badge>;
  if (status === 'complete') return <Badge tone="info">Complete</Badge>;
  if (status === 'pending_approval') return <Badge tone="info">In review</Badge>;
  if (status === 'approved') return <Badge tone="ok" icon={<Icon.check style={{ width: 12, height: 12 }} />}>Approved</Badge>;
  return null;
}

function ChoreCard({ chore, onAction, actionLabel, actionVariant, parentActions, showAvatar }) {
  const person = PEOPLE[chore.assignee];
  return (
    <Card pad={14}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12, background: HB.indigoLight, color: HB.indigo, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>{chore.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: HB.ink, letterSpacing: '-0.02em' }}>{chore.title}</div>
            {statusBadge(chore.status)}
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, fontSize: 12, color: HB.mute,
            letterSpacing: '-0.01em', flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon.clock /> Due {chore.due}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: HB.amberDark, fontWeight: 600 }}>
              <Icon.star style={{ color: HB.amber, width: 12, height: 12 }} /> {chore.points} pts
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#047857', fontWeight: 700 }}>
              ${chore.dollars.toFixed(2)}
            </div>
          </div>
        </div>
        {showAvatar && <Avatar person={person} size={32} showCrown={false} />}
      </div>
      {onAction && actionLabel && (
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => onAction(chore.id)} variant={actionVariant} size="sm" full
            icon={actionVariant === 'primary' ? <Icon.check /> : null}>{actionLabel}</Button>
        </div>
      )}
      {parentActions && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <Button onClick={() => parentActions.onApprove(chore.id)} variant="success" size="sm" full icon={<Icon.check />}>Approve</Button>
          <Button onClick={() => parentActions.onReject(chore.id)} variant="danger" size="sm" full icon={<Icon.x />}>Reject</Button>
        </div>
      )}
    </Card>
  );
}

// ─────────────── CHORES — PARENT ───────────────
function ChoresParentScreen({ data, onApprove, onReject, onAddChore }) {
  const [filter, setFilter] = React.useState('all');
  const teens = Object.values(PEOPLE).filter(p => p.role === 'teen');
  const filtered = filter === 'all' ? data.chores : data.chores.filter(c => c.assignee === filter);
  const inReview = filtered.filter(c => c.status === 'pending_approval');
  const pending = filtered.filter(c => c.status === 'pending');
  const done = filtered.filter(c => c.status === 'approved');

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <div style={{ padding: '4px 16px 100px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {teens.map(t => (
            <Card key={t.id} pad={14}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar person={t} size={36} showCrown={false} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: HB.mute, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{t.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: HB.ink, letterSpacing: '-0.02em', lineHeight: 1, marginTop: 4 }}>
                    ${t.balance.toFixed(2)}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 4, padding: 4, background: HB.line2, borderRadius: 12 }}>
          {[{ id: 'all', label: 'All' }, ...teens.map(t => ({ id: t.id, label: t.name }))].map(t => (
            <button key={t.id} onClick={() => setFilter(t.id)} style={{
              flex: 1, height: 36, border: 'none', borderRadius: 9,
              background: filter === t.id ? HB.card : 'transparent',
              color: filter === t.id ? HB.indigo : HB.ink2,
              fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: filter === t.id ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
            }}>{t.label}</button>
          ))}
        </div>

        {inReview.length > 0 && (
          <ChoreSection title="Needs your approval" count={inReview.length}>
            {inReview.map(c => <ChoreCard key={c.id} chore={c} showAvatar parentActions={{ onApprove, onReject }} />)}
          </ChoreSection>
        )}

        <ChoreSection title="In progress" count={pending.length} emptyMsg="No chores in progress">
          {pending.map(c => <ChoreCard key={c.id} chore={c} showAvatar />)}
        </ChoreSection>

        <ChoreSection title="Completed" count={done.length} emptyMsg="No completed chores yet">
          {done.map(c => <ChoreCard key={c.id} chore={c} showAvatar />)}
        </ChoreSection>
      </div>
      <FAB onClick={onAddChore} icon={<Icon.plus />} label="Chore" />
    </div>
  );
}

// ─────────────── ADD CHORE (parent only) ───────────────
function AddChoreScreen({ onSave, onCancel }) {
  const [title, setTitle] = React.useState('');
  const [assignee, setAssignee] = React.useState('maya');
  const [due, setDue] = React.useState('Tomorrow');
  const [points, setPoints] = React.useState(10);
  const [dollars, setDollars] = React.useState(5);
  const teens = Object.values(PEOPLE).filter(p => p.role === 'teen');

  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TextField label="Chore title" value={title} onChange={setTitle} placeholder="e.g. Take out trash" autoFocus />

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: HB.ink2, marginBottom: 8, letterSpacing: '-0.01em' }}>Assign to</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {teens.map(t => {
            const active = assignee === t.id;
            return (
              <button key={t.id} onClick={() => setAssignee(t.id)} style={{
                height: 64, padding: '0 14px', border: active ? `2px solid ${HB.indigo}` : `1px solid ${HB.line}`,
                background: active ? HB.indigoLight : HB.card, borderRadius: 14,
                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontFamily: 'inherit',
                textAlign: 'left',
              }}>
                <Avatar person={t} size={36} showCrown={false} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: HB.ink, letterSpacing: '-0.01em' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: HB.mute, letterSpacing: '-0.01em' }}>Teen</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: HB.ink2, marginBottom: 8, letterSpacing: '-0.01em' }}>Due date</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['Today', 'Tomorrow', 'This Sat', 'Next week', 'Custom…'].map(d => {
            const active = due === d;
            return (
              <button key={d} onClick={() => setDue(d)} style={{
                height: 36, padding: '0 14px', border: active ? `1.5px solid ${HB.indigo}` : `1px solid ${HB.line}`,
                background: active ? HB.indigoLight : HB.card, color: active ? HB.indigo : HB.ink2,
                borderRadius: 999, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{d}</button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <NumberField label="Points" icon={<Icon.star style={{ color: HB.amber }} />} value={points} onChange={setPoints} suffix="pts" />
        <NumberField label="Dollars" icon={<span style={{ color: '#047857', fontWeight: 700, fontSize: 16 }}>$</span>} value={dollars} onChange={setDollars} prefix="$" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <Button onClick={onCancel} variant="ghost" size="lg" full>Cancel</Button>
        <Button onClick={() => onSave({ title, assignee, due, points, dollars })} variant="primary" size="lg" full disabled={!title.trim()}>Save chore</Button>
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, icon, suffix, prefix }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: HB.ink2, marginBottom: 6, letterSpacing: '-0.01em' }}>{label}</div>
      <div style={{
        height: 52, background: HB.card, borderRadius: 14, border: `1px solid ${HB.line}`,
        display: 'flex', alignItems: 'center', padding: '0 8px',
      }}>
        <button onClick={() => onChange(Math.max(0, value - 1))} style={{
          width: 36, height: 36, borderRadius: 10, background: HB.line2, border: 'none',
          color: HB.ink2, fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>−</button>
        <div style={{ flex: 1, textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          {icon && <span style={{ display: 'flex' }}>{icon}</span>}
          <span style={{ fontSize: 17, fontWeight: 700, color: HB.ink, letterSpacing: '-0.02em' }}>
            {prefix}{value}{suffix ? <span style={{ fontSize: 12, color: HB.mute, marginLeft: 3, fontWeight: 500 }}>{suffix}</span> : null}
          </span>
        </div>
        <button onClick={() => onChange(value + 1)} style={{
          width: 36, height: 36, borderRadius: 10, background: HB.indigoLight, border: 'none',
          color: HB.indigo, fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}>+</button>
      </div>
    </div>
  );
}

// ─────────────── COMPOSE POST (sheet) ───────────────
function ComposeSheet({ user, onPost, onClose }) {
  const [text, setText] = React.useState('');
  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card pad={14}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Avatar person={user} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: HB.ink, letterSpacing: '-0.01em' }}>{user.name}</div>
            <div style={{ fontSize: 12, color: HB.mute, letterSpacing: '-0.01em' }}>Posting to the whole family</div>
          </div>
        </div>
        <textarea
          autoFocus value={text} onChange={e => setText(e.target.value)}
          placeholder="What's up?"
          style={{
            width: '100%', minHeight: 140, marginTop: 12, padding: 0,
            border: 'none', outline: 'none', resize: 'none', background: 'transparent',
            fontSize: 16, color: HB.ink, fontFamily: 'inherit', letterSpacing: '-0.01em',
            lineHeight: 1.5,
          }}
        />
      </Card>
      <div style={{ display: 'flex', gap: 10 }}>
        <Button onClick={onClose} variant="ghost" size="lg" full>Cancel</Button>
        <Button onClick={() => onPost(text)} variant="primary" size="lg" full
          disabled={!text.trim()} icon={<Icon.send />}>Post</Button>
      </div>
    </div>
  );
}

// ─────────────── ADD EVENT (sheet) ───────────────
function AddEventScreen({ onSave, onCancel }) {
  const [title, setTitle] = React.useState('');
  const [category, setCategory] = React.useState('family');
  const [time, setTime] = React.useState('5:00 PM');
  const [who, setWho] = React.useState('family');

  return (
    <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <TextField label="Event title" value={title} onChange={setTitle} placeholder="e.g. Family dinner" autoFocus />

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: HB.ink2, marginBottom: 8, letterSpacing: '-0.01em' }}>Category</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['school','School',HB.school],['sports','Sports',HB.sports],['family','Family',HB.family],['work','Work',HB.work]].map(([k,l,c]) => {
            const active = category === k;
            return (
              <button key={k} onClick={() => setCategory(k)} style={{
                height: 36, padding: '0 12px',
                border: active ? `1.5px solid ${c}` : `1px solid ${HB.line}`,
                background: active ? c + '14' : HB.card, color: active ? c : HB.ink2,
                borderRadius: 999, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
                cursor: 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: c }} />
                {l}
              </button>
            );
          })}
        </div>
      </div>

      <TextField label="Time" value={time} onChange={setTime} icon={<Icon.clock style={{ width: 18, height: 18 }} />} />

      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: HB.ink2, marginBottom: 8, letterSpacing: '-0.01em' }}>Who's it for?</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[{id:'family', name:'Everyone'}, ...Object.values(PEOPLE)].map(p => {
            const active = who === p.id;
            return (
              <button key={p.id} onClick={() => setWho(p.id)} style={{
                height: 36, padding: '0 12px',
                border: active ? `1.5px solid ${HB.indigo}` : `1px solid ${HB.line}`,
                background: active ? HB.indigoLight : HB.card, color: active ? HB.indigo : HB.ink2,
                borderRadius: 999, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>{p.name}</button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <Button onClick={onCancel} variant="ghost" size="lg" full>Cancel</Button>
        <Button onClick={() => onSave({ title, category, time, who })} variant="primary" size="lg" full disabled={!title.trim()}>Save event</Button>
      </div>
    </div>
  );
}

// ─────────────── ACCOUNT SWITCHER (bottom sheet) ───────────────
function AccountSwitcher({ currentUserId, onPick, onSignOut, onClose }) {
  const people = Object.values(PEOPLE);
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute', inset: 0, zIndex: 30,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
        animation: 'hb-fade 160ms ease-out',
      }}
    >
      <style>{`
        @keyframes hb-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes hb-slide { from { transform: translateY(24px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: HB.card,
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          padding: '12px 16px 24px',
          animation: 'hb-slide 220ms cubic-bezier(.2,.8,.2,1)',
          boxShadow: '0 -8px 32px rgba(15,23,42,0.18)',
        }}
      >
        <div style={{
          width: 40, height: 4, borderRadius: 2, background: HB.line,
          margin: '4px auto 14px',
        }} />
        <div style={{
          fontSize: 11, fontWeight: 700, color: HB.mute, letterSpacing: '0.08em',
          textTransform: 'uppercase', padding: '0 6px 10px',
        }}>Switch account</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {people.map((p) => {
            const active = p.id === currentUserId;
            return (
              <button
                key={p.id}
                onClick={() => onPick(p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px',
                  border: 'none', background: active ? HB.indigoLight : 'transparent',
                  borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
                  textAlign: 'left', width: '100%',
                }}
              >
                <Avatar person={p} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 15, fontWeight: 700, color: HB.ink, letterSpacing: '-0.01em',
                  }}>{p.name}</div>
                  <div style={{
                    fontSize: 12, color: HB.mute, letterSpacing: '-0.01em',
                    textTransform: 'capitalize',
                  }}>{p.role}{p.role === 'teen' ? ` · $${p.balance.toFixed(2)}` : ''}</div>
                </div>
                {active && (
                  <div style={{
                    width: 24, height: 24, borderRadius: 12, background: HB.indigo,
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon.check style={{ width: 14, height: 14 }} />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ height: 1, background: HB.line, margin: '12px 0' }} />

        <button
          onClick={onSignOut}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', height: 48, border: 'none', background: 'transparent',
            color: HB.danger, fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em',
            borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Sign out</button>
      </div>
    </div>
  );
}

Object.assign(window, {
  LoginScreen, DashboardScreen, CalendarScreen, BoardScreen,
  ChoresTeenScreen, ChoresParentScreen, AddChoreScreen, ComposeSheet, AddEventScreen,
  AccountSwitcher,
});
