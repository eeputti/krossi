// koutsi-phone.jsx — static (non-interactive) hero mockups for koutsi.krossi.app.
// Two phones — coach and player — mirroring the actual mobile screens of the real
// apps (koutsi-valmentaja-app.jsx / koutsi-pelaaja-app.jsx): top bar with role pill,
// one tab's content, and the real bottom nav bar. No state, no clicks — just a snapshot.

const KC_BRAND = {
  lime: '#CFE414',
  green: '#0E3B2C',
  sand: '#F7F5EF',
  avatar: {
    forest: { light: '#4F8A72', dark: '#0E3B2C', text: '#FFFFFF' },
    mint: { light: '#55997E', dark: '#1F684F', text: '#FFFFFF' },
    olive: { light: '#E1EC6B', dark: '#A5B619', text: '#0E3B2C' },
  },
};

function Avatar({ initial, tone = 'forest', size = 44, ring = false }) {
  const palette = KC_BRAND.avatar[tone] || KC_BRAND.avatar.forest;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `radial-gradient(120% 120% at 30% 20%, ${palette.light}, ${palette.dark})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: palette.text, fontWeight: 700, fontSize: size * 0.4,
      boxShadow: ring ? `0 0 0 2px ${KC_BRAND.lime}` : 'none', letterSpacing: 0.3,
    }}>{initial}</div>
  );
}

const KC_LEVEL_COLORS = {
  aloitt: { bg: 'rgba(138,106,74,0.10)', fg: '#6f5337', border: 'rgba(138,106,74,0.28)' },
  keski: { bg: 'rgba(14,59,44,0.08)', fg: '#0E3B2C', border: 'rgba(14,59,44,0.22)' },
  edist: { bg: 'rgba(14,59,44,0.14)', fg: '#0A2C20', border: 'rgba(14,59,44,0.34)' },
  kilpa: { bg: 'rgba(207,228,20,0.20)', fg: '#536009', border: 'rgba(157,178,0,0.52)' },
};
function LevelChip({ level }) {
  const l = (level || '').toLowerCase();
  const key = Object.keys(KC_LEVEL_COLORS).find((k) => l.includes(k));
  const c = key ? KC_LEVEL_COLORS[key] : { bg: '#f4f2ec', fg: '#6b665c', border: '#d8d4ca' };
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, lineHeight: 1, background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>{level}</span>;
}
function Chip({ children }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 600, lineHeight: 1, background: '#f4f2ec', color: '#6b665c', border: '1px solid var(--line)' }}>{children}</span>;
}

// ── sample data ──────────────────────────────────────────
const COACH_STUDENTS = [
  { id: 0, initial: 'M', tone: 'forest', name: 'Maria K.', age: 24, level: 'Kilpapelaaja', goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli', focus: 'Split step + ensimmäinen askel', newEntry: true },
  { id: 1, initial: 'A', tone: 'mint', name: 'Aleksi R.', age: 21, level: 'Keskitaso', goal: 'Backhandin tasapaino pitkissä vaihdoissa', focus: 'Askelkuvio ennen lyöntiä', newEntry: true },
  { id: 2, initial: 'E', tone: 'olive', name: 'Emma L.', age: 19, level: 'Aloittelija', goal: 'Luonteva ote ja perusasento', focus: 'Mailan ote peilin edessä', newEntry: false },
];

const PLAYER_STUDENT = {
  initial: 'M', tone: 'forest', name: 'Maria K.', level: 'Kilpapelaaja',
  group: { name: 'Kilpapelaajat', day: 'Ke', time: '17:00' },
  goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli',
  theme: { title: 'Kämmenen pelitila', lead: 'Valmistautuminen alkaa heti vastustajan osumasta.' },
  feedback: { text: 'Hyvä nousu syötössä tällä viikolla — jatka samaan malliin.', date: '2 pv sitten' },
  wish: 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.',
};

// ── shared chrome: status bar + notch + bottom home bar ─────
function PhoneFrame({ width, children }) {
  const h = Math.round(width * 2.06);
  return (
    <div style={{ width, height: h, position: 'relative', borderRadius: width * 0.16, background: '#0a0a0a', padding: width * 0.028, boxShadow: '0 0 0 1.5px rgba(0,0,0,0.4)' }}>
      <div className="kp-light" style={{ width: '100%', height: '100%', borderRadius: width * 0.135, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', background: KC_BRAND.sand }}>
        <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: width * 0.085, borderRadius: 99, background: '#000', zIndex: 90 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${width * 0.05}px ${width * 0.08}px 2px`, color: '#fff', background: KC_BRAND.green, flexShrink: 0, zIndex: 85, position: 'relative' }}>
          <span style={{ fontSize: width * 0.048, fontWeight: 700 }}>12.44</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width={width * 0.058} height={width * 0.04} viewBox="0 0 16 11"><path d="M8 2.6c2 0 3.8.8 5.1 2.1l1-1C12.5 2 10.4 1 8 1S3.5 2 1.9 3.7l1 1C4.2 3.4 6 2.6 8 2.6z" fill="#fff" /><path d="M8 5.6c1.2 0 2.3.5 3.1 1.3l1-1C11 4.8 9.6 4.2 8 4.2s-3 .6-4.1 1.7l1 1C5.7 6.1 6.8 5.6 8 5.6z" fill="#fff" /><circle cx="8" cy="9" r="1.4" fill="#fff" /></svg>
            <svg width={width * 0.086} height={width * 0.04} viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="#fff" strokeOpacity="0.7" fill="none" /><rect x="2" y="2" width="16" height="7" rx="1.5" fill="#fff" /><path d="M22 3.5v4c.7-.3 1.2-1 1.2-2s-.5-1.7-1.2-2z" fill="#fff" fillOpacity="0.7" /></svg>
          </div>
        </div>
        {children}
        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.58)', zIndex: 95 }} />
      </div>
    </div>
  );
}

function TopBar({ width, roleLabel, avatar }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: `${width * 0.032}px ${width * 0.06}px ${width * 0.04}px`, background: KC_BRAND.green, borderBottom: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 10px 28px -22px rgba(0,0,0,0.65)', flexShrink: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: width * 0.018, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontWeight: 800, fontSize: width * 0.06, color: 'var(--lime)', letterSpacing: -0.3, whiteSpace: 'nowrap' }}>Krossi</span>
          <span style={{ fontWeight: 700, fontSize: width * 0.034, color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>Koutsi</span>
        </div>
        <span style={{ padding: '2px 7px', borderRadius: 999, background: 'rgba(207,228,20,0.12)', border: '1px solid rgba(207,228,20,0.5)', color: 'var(--lime)', fontSize: width * 0.028, fontWeight: 800, letterSpacing: 0.35, whiteSpace: 'nowrap' }}>{roleLabel}</span>
      </div>
      <div style={{ border: '2px solid var(--lime)', borderRadius: '50%', padding: 1, display: 'flex' }}>{avatar}</div>
    </div>
  );
}

// icon paths shared by both real apps' bottom nav
function NavIcon({ id, on, size, offColor = '#9a958a' }) {
  const c = on ? 'var(--green-deep)' : offColor;
  const sw = 1.7;
  if (id === 'home') return <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><path d="M3 10.5L11 3l8 7.5" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /><path d="M5 9v9.5a1 1 0 001 1h10a1 1 0 001-1V9" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (id === 'students') return <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth={sw} /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth={sw} strokeLinecap="round" /></svg>;
  if (id === 'group' || id === 'groups') return <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><circle cx="7" cy="7.5" r="3" stroke={c} strokeWidth={sw} /><circle cx="15" cy="7.5" r="3" stroke={c} strokeWidth={sw} /><path d="M1.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5M9.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5" stroke={c} strokeWidth={sw} strokeLinecap="round" /></svg>;
  if (id === 'trainings') return <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><rect x="2.5" y="4.5" width="17" height="15" rx="3" stroke={c} strokeWidth={sw} /><path d="M2.5 9h17M7 2.5v4M15 2.5v4" stroke={c} strokeWidth={sw} strokeLinecap="round" /></svg>;
  if (id === 'exercises') return <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2.5" stroke={c} strokeWidth={sw} /><path d="M8 1.5h6a1 1 0 011 1V4H7V2.5a1 1 0 011-1z" stroke={c} strokeWidth={sw} /><path d="M7.5 9.5h7M7.5 13h7M7.5 16.5h4" stroke={c} strokeWidth={sw} strokeLinecap="round" /></svg>;
  if (id === 'progress') return <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><path d="M2.5 19.5h17" stroke={c} strokeWidth={sw} strokeLinecap="round" /><path d="M3.5 15.5l5-5.5 4 3.5 6-7.5" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /><path d="M14.5 6h4v4" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth={sw} /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth={sw} strokeLinecap="round" /></svg>;
}

function BottomNav({ width, tabs, activeId }) {
  return (
    <div style={{ display: 'flex', flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.12)', background: 'var(--green-deep)', padding: `${width * 0.025}px ${width * 0.012}px ${width * 0.055}px`, boxShadow: '0 -12px 28px -20px rgba(0,0,0,0.65)' }}>
      {tabs.map((t) => {
        const on = t.id === activeId;
        return (
          <div key={t.id} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, margin: '0 1px', padding: `${width * 0.022}px 0`, borderRadius: width * 0.045, background: on ? 'var(--lime)' : 'transparent' }}>
            <NavIcon id={t.id} on={on} size={width * 0.065} offColor="rgba(255,255,255,0.72)" />
            <span style={{ fontSize: width * (t.label.length > 8 ? 0.025 : 0.028), fontWeight: on ? 800 : 600, color: on ? 'var(--green-deep)' : 'rgba(255,255,255,0.78)' }}>{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}

const COACH_TABS = [{ id: 'students', label: 'Oppilaat' }, { id: 'groups', label: 'Ryhmät' }, { id: 'trainings', label: 'Treenit' }, { id: 'exercises', label: 'Harjoitteet' }];
const PLAYER_TABS = [{ id: 'home', label: 'Koti' }, { id: 'group', label: 'Ryhmä' }, { id: 'trainings', label: 'Treenit' }, { id: 'exercises', label: 'Harjoitteet' }, { id: 'progress', label: 'Kehitys' }];

function CoachPhone({ width = 220 }) {
  return (
    <PhoneFrame width={width}>
      <TopBar width={width} roleLabel="VALMENTAJA" avatar={<Avatar initial="A" tone="mint" size={width * 0.09} />} />
      <div style={{ flex: 1, overflow: 'hidden', padding: `${width * 0.05}px ${width * 0.06}px` }}>
        <div style={{ fontSize: width * 0.1, fontWeight: 800, color: 'var(--green-deep)', letterSpacing: -0.3, marginBottom: width * 0.045 }}>Oppilaani</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: width * 0.045 }}>
          {COACH_STUDENTS.map((s) => (
            <div key={s.id} className="kp-card" style={{ padding: width * 0.055 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: width * 0.045, marginBottom: width * 0.04 }}>
                <Avatar initial={s.initial} tone={s.tone} size={width * 0.15} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ color: '#111', fontWeight: 700, fontSize: width * 0.058 }}>{s.name}, {s.age}</span>
                    {s.newEntry && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--lime)', boxShadow: '0 0 0 1px rgba(14,59,44,0.18)', flexShrink: 0 }} />}
                  </div>
                  <div style={{ marginTop: 4 }}><LevelChip level={s.level} /></div>
                </div>
              </div>
              <div style={{ fontSize: width * 0.045, color: '#3c382f', lineHeight: 1.4 }}><b style={{ color: 'var(--green-deep)' }}>Tavoite:</b> {s.goal}</div>
              <div style={{ fontSize: width * 0.042, color: '#8a857a', lineHeight: 1.4, marginTop: 3 }}>Seuraavaksi: {s.focus}</div>
            </div>
          ))}
        </div>
      </div>
      <BottomNav width={width} tabs={COACH_TABS} activeId="students" />
    </PhoneFrame>
  );
}

function PlayerPhone({ width = 220 }) {
  const s = PLAYER_STUDENT;
  return (
    <PhoneFrame width={width}>
      <TopBar width={width} roleLabel="PELAAJA" avatar={<Avatar initial={s.initial} tone={s.tone} size={width * 0.09} />} />
      <div style={{ flex: 1, overflow: 'hidden', padding: `${width * 0.055}px ${width * 0.06}px` }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: width * 0.025, marginBottom: width * 0.07, textAlign: 'center' }}>
          <Avatar initial={s.initial} tone={s.tone} size={width * 0.24} ring />
          <div style={{ fontSize: width * 0.075, fontWeight: 800, color: '#111' }}>{s.name}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'center' }}>
            <LevelChip level={s.level} />
            <Chip>Ryhmä: {s.group.name} · {s.group.day} {s.group.time}</Chip>
          </div>
        </div>

        <div className="kp-card" style={{ padding: width * 0.055, marginBottom: width * 0.05, background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)' }}>
          <div style={{ fontSize: width * 0.032, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>Viikon teema</div>
          <div style={{ fontSize: width * 0.052, fontWeight: 800, color: '#111', marginBottom: 3 }}>{s.theme.title}</div>
          <div style={{ fontSize: width * 0.04, color: '#514c42', lineHeight: 1.4 }}>{s.theme.lead}</div>
        </div>

        <div style={{ fontSize: width * 0.034, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: width * 0.03 }}>Viimeisin palaute</div>
        <div className="kp-card" style={{ padding: width * 0.055, marginBottom: width * 0.05, borderColor: 'var(--green-deep)' }}>
          <div style={{ fontSize: width * 0.044, color: '#111', lineHeight: 1.4 }}>{s.feedback.text}</div>
          <div style={{ marginTop: 4, fontSize: width * 0.034, color: '#8a857a', fontWeight: 600 }}>{s.feedback.date}</div>
        </div>

        <div style={{ fontSize: width * 0.034, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: width * 0.03 }}>Toiveeni seuraavalle kerralle</div>
        <div style={{ border: '1px solid var(--line)', borderRadius: width * 0.06, padding: width * 0.05, fontSize: width * 0.042, color: '#111', lineHeight: 1.4, background: '#fff' }}>{s.wish}</div>
      </div>
      <BottomNav width={width} tabs={PLAYER_TABS} activeId="home" />
    </PhoneFrame>
  );
}

Object.assign(window, { CoachPhone, PlayerPhone });
