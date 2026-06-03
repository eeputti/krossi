// krossi-phone.jsx — interactive Krossi app mockup, faithful to the real app flows.
// Exports KrossiPhone. Tabs + player detail + request modal + filter sheet + conversations.

const KP = {
  Avatar({ initial, hue = 150, size = 44, ring = false }) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue} 55% 62%), hsl(${hue + 24} 60% 38%))`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: size * 0.4,
        boxShadow: ring ? '0 0 0 2px rgba(255,255,255,0.4)' : 'none', letterSpacing: 0.3,
      }}>{initial}</div>
    );
  },
  Chip({ children, variant = 'outline' }) {
    const base = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1 };
    if (variant === 'lime') return <span style={{ ...base, background: 'var(--lime)', color: '#101a08' }}>{children}</span>;
    if (variant === 'active') return (
      <span style={{ ...base, background: 'rgba(120,220,120,0.16)', color: '#9be88a', border: '1px solid rgba(150,230,140,0.4)' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#7ee06a' }} />{children}
      </span>
    );
    return <span style={{ ...base, background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.86)', border: '1px solid rgba(255,255,255,0.22)' }}>{children}</span>;
  },
};

const KP_PLAYERS = [
  { id: 0, initial: 'E', hue: 150, name: 'Eero', age: 34, loc: 'Lahti · Hennala', active: true, level: 'Keskitaso', forms: 'Treenit · Matsit', avail: ['Arkiaamut 9–12', 'Arki-illat 18–21'], style: 'Oikeakätinen · Yhden käden rysty', bio: 'Pelaillaan rennosti, taso ei niin väliä — pääasia että pallo pysyy kentällä.' },
  { id: 1, initial: 'S', hue: 18, name: 'Saana', age: 29, loc: 'Lahti · Keskusta', active: true, level: 'Edistynyt', forms: 'Pallottelu · Matsit', avail: ['Arki-illat 17–20', 'Viikonloput 10–14'], style: 'Vasenkätinen', bio: 'Etsin tasaista vastusta arki-iltoihin. Tykkään kovasta temposta.' },
  { id: 2, initial: 'M', hue: 265, name: 'Mikko', age: 41, loc: 'Lahti · Laune', active: false, level: 'Kilpapelaaja', forms: 'Matsit', avail: ['Arkiaamut 7–9', 'Lauantai 9–12'], style: 'Oikeakätinen · Kahden käden rysty', bio: 'Sarjapelaaja, mutta lähden mielelläni myös rentoon pallotteluun.' },
  { id: 3, initial: 'L', hue: 330, name: 'Lotta', age: 26, loc: 'Lahti · Mukkula', active: true, level: 'Aloittelija', forms: 'Treenit', avail: ['Arki-illat 18–21'], style: 'Oikeakätinen', bio: 'Aloittelin viime vuonna ja haluan oppia lisää. Kärsivällinen pelikaveri plussaa!' },
];

const KP_GAMES = [
  { day: 'Ke 4.6.', time: 'klo 18:00', p: 0, place: 'Tenniskeskus Lahti · Sisä', type: 'Pallottelu', slots: 1 },
  { day: 'To 5.6.', time: 'klo 09:00', p: 1, place: 'Mukkulan kentät · Ulko', type: 'Kaksinpeli', slots: 1 },
  { day: 'La 7.6.', time: 'klo 11:00', p: 2, place: 'Hollolan halli · Sisä', type: 'Nelinpeli', slots: 3 },
];

const KP_REQUESTS = [
  { p: 2, text: 'Olisiko viikonloppuna aikaa matsiin? Mulle käy erityisesti lauantain päivävuoro.' },
  { p: 3, text: 'Lähtisitkö treenaamaan perjantaina iltapäivällä? Vasta-alkajakin kelpaa!' },
];
const KP_CONVOS = [
  { p: 1, last: 'Nähdään huomenna kentällä! 🎾', time: '9.12', unread: true },
  { p: 0, last: 'Joo, kello 18 käy hyvin 👍', time: 'eilen', unread: false },
];
const KP_BUBBLES = [
  { me: false, text: 'Moi! Lähtisitkö huomenna kentälle?' },
  { me: true, text: 'Joo, kello 18 käy hyvin 👍' },
  { me: false, text: 'Varaan kentän Tenniskeskuksesta.' },
  { me: false, text: 'Nähdään huomenna kentällä! 🎾' },
];

// ── shared bits ─────────────────────────────────────────
function KPHeader({ title, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 18px 14px' }}>
      <h3 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: 'var(--lime)', letterSpacing: -0.5 }}>{title}</h3>
      {action}
    </div>
  );
}
function KPFilters({ onFilter }) {
  const items = ['Suosikit', 'Sijainti', 'Pelitaso', 'Pelimuoto'];
  return (
    <div className="kp-scroll-x" style={{ display: 'flex', gap: 8, padding: '0 18px 14px', overflowX: 'auto' }}>
      <button onClick={onFilter} style={{ width: 40, height: 34, borderRadius: 999, border: '1px solid rgba(255,255,255,0.28)', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="15" height="11" viewBox="0 0 15 11"><g stroke="#fff" strokeWidth="1.6" strokeLinecap="round"><path d="M1 2h13M3 5.5h9M5 9h5" /></g></svg>
      </button>
      {items.map((x) => <span key={x} style={{ padding: '8px 15px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.28)', color: '#fff', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{x}</span>)}
    </div>
  );
}

// ── screens ─────────────────────────────────────────────
function KPPlayers({ onOpen, onFilter }) {
  return (
    <div>
      <KPHeader title="Pelaajat" />
      <KPFilters onFilter={onFilter} />
      <div style={{ margin: '0 18px 14px', padding: '13px 16px', borderRadius: 16, border: '1.5px solid var(--lime)', background: 'rgba(207,228,20,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ color: '#fff', fontSize: 14.5, fontWeight: 600 }}>Etsitään peliä tänään?</span>
        <span style={{ background: 'var(--lime)', color: '#101a08', fontSize: 12.5, fontWeight: 700, padding: '6px 12px', borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0 }}>Luo haaste</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
        {KP_PLAYERS.map((p) => (
          <button key={p.id} onClick={() => onOpen(p.id)} className="kp-card kp-press" style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid rgba(255,255,255,0.15)', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 11 }}>
              <KP.Avatar initial={p.initial} hue={p.hue} size={46} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>{p.name}, {p.age}</div>
                <div style={{ color: 'rgba(255,255,255,0.62)', fontSize: 13.5 }}>{p.loc}</div>
              </div>
              <svg width="8" height="14" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="rgba(255,255,255,0.5)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
              {p.active && <KP.Chip variant="active">Tällä viikolla</KP.Chip>}
              <KP.Chip>{p.level}</KP.Chip>
              <KP.Chip>{p.forms}</KP.Chip>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function KPGames({ onFilter }) {
  return (
    <div>
      <KPHeader title="Avoimet" action={<span style={{ background: 'var(--lime)', color: '#101a08', fontSize: 13, fontWeight: 700, padding: '8px 14px', borderRadius: 999 }}>+ Luo haaste</span>} />
      <KPFilters onFilter={onFilter} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 18px' }}>
        {KP_GAMES.map((g, i) => {
          const p = KP_PLAYERS[g.p];
          return (
            <div key={i} className="kp-card">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11 }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>{g.day} · {g.time}</span>
                <KP.Chip>{g.type}</KP.Chip>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <KP.Avatar initial={p.initial} hue={p.hue} size={42} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.62)', fontSize: 13 }}>{g.place}</div>
                </div>
                <div style={{ display: 'flex', gap: 5 }}>
                  {Array.from({ length: g.slots }).map((_, k) => <span key={k} style={{ width: 24, height: 24, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,0.5)' }} />)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KPMessages({ onConvo, onReply }) {
  return (
    <div>
      <KPHeader title="Viestit" />
      <div style={{ padding: '0 18px' }}>
        <div style={{ color: 'var(--lime)', fontSize: 15, fontWeight: 800, margin: '0 2px 10px' }}>Uudet pelipyynnöt</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
          {KP_REQUESTS.map((r, i) => {
            const p = KP_PLAYERS[r.p];
            return (
              <div key={i} className="kp-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
                  <KP.Avatar initial={p.initial} hue={p.hue} size={34} />
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                </div>
                <p style={{ margin: '0 0 12px', color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 1.4 }}>{r.text}</p>
                <div style={{ display: 'flex', gap: 9 }}>
                  <button onClick={() => onReply(r.p)} style={{ flex: 1, background: 'var(--lime)', color: '#101a08', border: 'none', borderRadius: 999, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Vastaa</button>
                  <button style={{ flex: 1, background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 999, padding: '11px 0', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Ohita</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ color: 'var(--lime)', fontSize: 15, fontWeight: 800, margin: '0 2px 10px' }}>Keskustelut</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {KP_CONVOS.map((c, i) => {
            const p = KP_PLAYERS[c.p];
            return (
              <button key={i} onClick={() => onConvo(c.p)} className="kp-press" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                <KP.Avatar initial={p.initial} hue={p.hue} size={44} ring={c.unread} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#fff', fontWeight: 700, fontSize: 15.5 }}>{p.name}</div>
                  <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.last}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{c.time}</span>
                  {c.unread && <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--lime)' }} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KPProfile({ liveOn, setLiveOn }) {
  const cities = ['Lahti', 'Hollola', 'Heinola'];
  return (
    <div>
      <KPHeader title="Profiili" action={<span style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="17" height="17" viewBox="0 0 17 17" fill="none"><circle cx="8.5" cy="8.5" r="2.6" stroke="#fff" strokeWidth="1.5" /><path d="M8.5 1.2v2M8.5 13.8v2M1.2 8.5h2M13.8 8.5h2M3.3 3.3l1.4 1.4M12.3 12.3l1.4 1.4M3.3 13.7l1.4-1.4M12.3 4.7l1.4-1.4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" /></svg></span>} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '0 18px 16px' }}>
        <KP.Avatar initial="A" hue={150} size={86} ring />
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 22 }}>Aleksi</div>
        <div style={{ color: 'rgba(255,255,255,0.66)', fontSize: 14 }}>Aina valmis matsiin!</div>
      </div>
      <div style={{ padding: '0 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button onClick={() => setLiveOn(!liveOn)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '15px 16px', borderRadius: 16, border: `1.5px solid ${liveOn ? 'rgba(126,224,106,0.6)' : 'rgba(255,255,255,0.2)'}`, background: liveOn ? 'rgba(126,224,106,0.12)' : 'rgba(255,255,255,0.05)', width: '100%' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: liveOn ? '#9be88a' : 'rgba(255,255,255,0.7)', fontWeight: 700, fontSize: 15 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: liveOn ? '#7ee06a' : 'rgba(255,255,255,0.4)' }} />Pelaan tällä viikolla</span>
          <span style={{ color: liveOn ? '#9be88a' : 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: 14 }}>{liveOn ? 'Päällä' : 'Pois'}</span>
        </button>
        <div style={{ display: 'flex', gap: 9 }}>
          {cities.map((c, i) => <span key={c} style={{ flex: 1, textAlign: 'center', padding: '11px 0', borderRadius: 14, fontWeight: 700, fontSize: 14, border: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.2)', background: i === 0 ? 'var(--lime)' : 'transparent', color: i === 0 ? '#101a08' : 'rgba(255,255,255,0.8)' }}>{c}</span>)}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[['Pelitaso', 'Keskitaso'], ['Pelimuodot', 'Kaikki käy']].map(([k, v]) => (
            <div key={k} className="kp-card" style={{ flex: 1, padding: '14px 15px' }}>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 5 }}>{k}</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{v}</div>
            </div>
          ))}
        </div>
        <div className="kp-card" style={{ padding: '14px 16px' }}>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>Ajankohdat</div>
          {['Arkiaamut 9–12', 'Arki-illat 18–21', 'Viikonloput 10–14'].map((t) => <div key={t} style={{ color: '#fff', fontSize: 14.5, padding: '4px 0' }}>{t}</div>)}
        </div>
      </div>
    </div>
  );
}

// ── overlays ────────────────────────────────────────────
function KPDetail({ player, onBack, onRequest }) {
  if (!player) return null;
  const Field = ({ label, children }) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: '#fff', fontWeight: 800, fontSize: 14.5, marginBottom: 4 }}>{label}</div>
      <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: 14.5, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
  return (
    <div className="kp-clay kp-overlay" style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '46px 16px 6px' }}>
        <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(0,0,0,0.25)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, padding: '8px 14px', borderRadius: 999, cursor: 'pointer' }}>← Takaisin</button>
        <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="18" height="5" viewBox="0 0 18 5"><g fill="#fff"><circle cx="2.5" cy="2.5" r="2" /><circle cx="9" cy="2.5" r="2" /><circle cx="15.5" cy="2.5" r="2" /></g></svg></span>
      </div>
      <div className="kp-screen" style={{ flex: 1, overflowY: 'auto', padding: '6px 20px 96px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 22 }}>
          <KP.Avatar initial={player.initial} hue={player.hue} size={92} ring />
          <div style={{ color: '#fff', fontWeight: 800, fontSize: 24 }}>{player.name}, {player.age}</div>
          <div style={{ color: 'rgba(255,255,255,0.62)', fontSize: 15 }}>{player.loc}</div>
          {player.active && <div style={{ marginTop: 2 }}><KP.Chip variant="active">Tällä viikolla</KP.Chip></div>}
        </div>
        <Field label="Pelitaso">{player.level}</Field>
        <Field label="Pelimuoto">{player.forms}</Field>
        <Field label="Saatavuus">{player.avail.map((a, i) => <div key={i}>{a}</div>)}</Field>
        <Field label="Tyyli">{player.style}</Field>
        <Field label="Bio">{player.bio}</Field>
      </div>
      <div style={{ position: 'absolute', left: 18, right: 18, bottom: 18 }}>
        <button onClick={onRequest} style={{ width: '100%', background: 'var(--lime)', color: '#101a08', border: 'none', borderRadius: 999, padding: '16px 0', fontWeight: 700, fontSize: 16, cursor: 'pointer', boxShadow: '0 8px 24px -8px rgba(0,0,0,0.4)' }}>Pyydä pelaamaan</button>
      </div>
    </div>
  );
}

function KPRequestModal({ player, onClose, onSend }) {
  const [val, setVal] = React.useState('Lähtisitkö ottamaan matsia huomenna?');
  if (!player) return null;
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div onClick={(e) => e.stopPropagation()} className="kp-sheet" style={{ width: '100%', background: '#F4F2EC', borderRadius: '24px 24px 0 0', padding: '22px 18px calc(18px + env(safe-area-inset-bottom))' }}>
        <h4 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 800, color: '#111' }}>Pyyntö pelaajalle {player.name}</h4>
        <textarea value={val} onChange={(e) => setVal(e.target.value)} rows={3} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 12, background: '#fff' }} />
        <button onClick={onClose} style={{ width: '100%', background: '#e9e6df', color: '#111', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>Peruuta</button>
        <button onClick={onSend} style={{ width: '100%', background: 'var(--green-deep)', color: '#fff', border: 'none', borderRadius: 14, padding: '14px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Lähetä viesti</button>
      </div>
    </div>
  );
}

function KPFilterSheet({ onClose }) {
  const [tab, setTab] = React.useState('Kaupunki');
  const [city, setCity] = React.useState('Lahti');
  const [levels, setLevels] = React.useState(['Keskitaso', 'Edistynyt']);
  const [form, setForm] = React.useState('Pallottelu');
  const toggle = (arr, set, v) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const Pill = ({ on, children, onClick }) => (
    <button onClick={onClick} style={{ padding: '11px 18px', borderRadius: 999, border: on ? 'none' : '1px solid rgba(255,255,255,0.22)', background: on ? 'var(--lime)' : 'rgba(255,255,255,0.05)', color: on ? '#101a08' : 'rgba(255,255,255,0.85)', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>{children}</button>
  );
  const Group = ({ label, children }) => (
    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 20, padding: '16px 14px', marginBottom: 14 }}>
      {label && <div style={{ color: 'var(--lime)', fontSize: 12.5, fontWeight: 800, letterSpacing: 1, marginBottom: 12 }}>{label}</div>}
      {children}
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div onClick={(e) => e.stopPropagation()} className="kp-sheet" style={{ width: '100%', height: '90%', background: '#0E3B2C', borderRadius: '26px 26px 0 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}><span style={{ width: 40, height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.25)' }} /></div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 18px 14px' }}>
          <h4 style={{ margin: 0, fontSize: 21, fontWeight: 800, color: '#fff' }}>Suodata pelaajia</h4>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--lime)', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Sulje</button>
        </div>
        <div className="kp-screen" style={{ flex: 1, overflowY: 'auto', padding: '0 18px 12px' }}>
          <Group>
            <div style={{ display: 'flex', background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 4, marginBottom: 12 }}>
              {['Kaupunki', 'Säde'].map((s) => <button key={s} onClick={() => setTab(s)} style={{ flex: 1, padding: '9px 0', borderRadius: 999, border: 'none', background: tab === s ? 'var(--lime)' : 'transparent', color: tab === s ? '#101a08' : 'rgba(255,255,255,0.6)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>{s}</button>)}
            </div>
            <div className="kp-scroll-x" style={{ display: 'flex', gap: 9, overflowX: 'auto' }}>
              {['Kaikki', 'Lahti', 'Hollola', 'Heinola', 'Nastola'].map((c) => <Pill key={c} on={city === c} onClick={() => setCity(c)}>{c}</Pill>)}
            </div>
          </Group>
          <Group label="PELITASO">
            <div className="kp-scroll-x" style={{ display: 'flex', gap: 9, overflowX: 'auto', flexWrap: 'wrap' }}>
              {['Aloittelija', 'Keskitaso', 'Edistynyt', 'Kilpapelaaja'].map((l) => <Pill key={l} on={levels.includes(l)} onClick={() => toggle(levels, setLevels, l)}>{l}</Pill>)}
            </div>
          </Group>
          <Group label="PELIMUOTO">
            <div className="kp-scroll-x" style={{ display: 'flex', gap: 9, overflowX: 'auto' }}>
              {['Kaikki', 'Pallottelu', 'Treenit', 'Matsit'].map((f) => <Pill key={f} on={form === f} onClick={() => setForm(f)}>{f}</Pill>)}
            </div>
          </Group>
          <Group label="IKÄ">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, color: '#fff', fontWeight: 700, fontSize: 14 }}><span /><span>25–45 v</span></div>
            <div style={{ position: 'relative', height: 22 }}>
              <div style={{ position: 'absolute', top: 9, left: 0, right: 0, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.18)' }} />
              <div style={{ position: 'absolute', top: 9, left: '18%', right: '32%', height: 4, borderRadius: 99, background: 'var(--lime)' }} />
              <span style={{ position: 'absolute', top: 0, left: '18%', width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 2px #101a08', marginLeft: -11 }} />
              <span style={{ position: 'absolute', top: 0, left: '68%', width: 22, height: 22, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 2px #101a08', marginLeft: -11 }} />
            </div>
          </Group>
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '12px 18px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button onClick={onClose} style={{ flex: 1, background: 'rgba(255,255,255,0.06)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '15px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Tyhjennä</button>
          <button onClick={onClose} style={{ flex: 1.4, background: 'var(--lime)', color: '#101a08', border: 'none', borderRadius: 999, padding: '15px 0', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Näytä pelaajat</button>
        </div>
      </div>
    </div>
  );
}

function KPConvo({ player, onBack }) {
  if (!player) return null;
  return (
    <div className="kp-clay kp-overlay" style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', borderRadius: 'inherit', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '46px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: 22, lineHeight: 1 }}>←</button>
        <KP.Avatar initial={player.initial} hue={player.hue} size={38} ring />
        <div><div style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{player.name}</div><div style={{ color: '#7ee06a', fontSize: 12, fontWeight: 600 }}>● Paikalla</div></div>
      </div>
      <div className="kp-screen" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 18 }}>
        {KP_BUBBLES.map((m, i) => (
          <div key={i} style={{ alignSelf: m.me ? 'flex-end' : 'flex-start', maxWidth: '78%', padding: '10px 14px', borderRadius: 18, fontSize: 14.5, lineHeight: 1.35, background: m.me ? 'var(--lime)' : 'rgba(255,255,255,0.14)', color: m.me ? '#101a08' : '#fff', borderBottomRightRadius: m.me ? 5 : 18, borderBottomLeftRadius: m.me ? 18 : 5, fontWeight: m.me ? 600 : 500 }}>{m.text}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 9, padding: '10px 16px calc(14px + env(safe-area-inset-bottom))', alignItems: 'center' }}>
        <div style={{ flex: 1, padding: '11px 16px', borderRadius: 999, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.55)', fontSize: 14 }}>Kirjoita viesti…</div>
        <span style={{ width: 42, height: 42, borderRadius: '50%', background: 'var(--lime)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 22 22"><path d="M20 2L2 9.5l7 2.5 2.5 7L20 2z" fill="none" stroke="#101a08" strokeWidth="1.8" strokeLinejoin="round" /></svg></span>
      </div>
    </div>
  );
}

function KPToast({ show, text }) {
  return (
    <div style={{ position: 'absolute', top: 52, left: '50%', transform: `translateX(-50%) translateY(${show ? 0 : -20}px)`, opacity: show ? 1 : 0, transition: 'all .3s', zIndex: 90, background: 'var(--lime)', color: '#101a08', padding: '10px 18px', borderRadius: 999, fontWeight: 700, fontSize: 13.5, boxShadow: '0 8px 24px -8px rgba(0,0,0,0.5)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{text}</div>
  );
}

// ── tab bar ─────────────────────────────────────────────
const KP_TABS = [{ id: 'players', label: 'Pelaajat' }, { id: 'games', label: 'Avoimet' }, { id: 'messages', label: 'Viestit' }, { id: 'profile', label: 'Profiili' }];
const KP_TAB_ICON = { players: 'assets/ball-tight.png', games: 'assets/avoimet-tight.png', messages: 'assets/viestit-tight.png' };
function KPTabIcon({ id, on }) {
  if (id === 'profile') {
    return <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'radial-gradient(120% 120% at 30% 20%, hsl(150 55% 62%), hsl(174 60% 38%))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 11, boxShadow: on ? '0 0 0 2px var(--lime)' : 'none', opacity: on ? 1 : 0.55 }}>A</div>;
  }
  return <img src={KP_TAB_ICON[id]} alt="" style={{ width: 24, height: 24, objectFit: 'contain', opacity: on ? 1 : 0.42, filter: on ? 'none' : 'grayscale(0.45)', transition: 'opacity .15s' }} />;
}

function KrossiPhone({ startTab = 'players', width = 300, onScrollEl }) {
  const [tab, setTab] = React.useState(startTab);
  const [liveOn, setLiveOn] = React.useState(true);
  const [detailId, setDetailId] = React.useState(null);
  const [requestId, setRequestId] = React.useState(null);
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [convoId, setConvoId] = React.useState(null);
  const [toast, setToast] = React.useState(false);
  const scrollRef = React.useRef(null);
  React.useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [tab]);
  React.useEffect(() => { if (onScrollEl && scrollRef.current) onScrollEl(scrollRef.current); }, []);

  const showToast = () => { setToast(true); setTimeout(() => setToast(false), 1900); };
  const sendRequest = () => { setRequestId(null); setDetailId(null); showToast(); };
  const goTab = (id) => { setDetailId(null); setConvoId(null); setFilterOpen(false); setTab(id); };

  const h = Math.round(width * 2.06);
  const detailPlayer = detailId != null ? KP_PLAYERS[detailId] : null;
  const requestPlayer = requestId != null ? KP_PLAYERS[requestId] : null;
  const convoPlayer = convoId != null ? KP_PLAYERS[convoId] : null;

  return (
    <div style={{ width, height: h, position: 'relative', borderRadius: width * 0.16, background: '#0a0a0a', padding: width * 0.028, boxShadow: '0 50px 90px -30px rgba(60,18,8,0.55), 0 0 0 1.5px rgba(0,0,0,0.4)' }}>
      <div className="kp-clay" style={{ width: '100%', height: '100%', borderRadius: width * 0.135, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: width * 0.085, borderRadius: 99, background: '#000', zIndex: 90 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px 6px', color: '#fff', flexShrink: 0, zIndex: 85, position: 'relative' }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>12.44</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 2.6c2 0 3.8.8 5.1 2.1l1-1C12.5 2 10.4 1 8 1S3.5 2 1.9 3.7l1 1C4.2 3.4 6 2.6 8 2.6z" fill="#fff" /><path d="M8 5.6c1.2 0 2.3.5 3.1 1.3l1-1C11 4.8 9.6 4.2 8 4.2s-3 .6-4.1 1.7l1 1C5.7 6.1 6.8 5.6 8 5.6z" fill="#fff" /><circle cx="8" cy="9" r="1.4" fill="#fff" /></svg>
            <svg width="24" height="11" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="#fff" strokeOpacity="0.5" fill="none" /><rect x="2" y="2" width="16" height="7" rx="1.5" fill="#fff" /><path d="M22 3.5v4c.7-.3 1.2-1 1.2-2s-.5-1.7-1.2-2z" fill="#fff" fillOpacity="0.5" /></svg>
          </div>
        </div>
        <div ref={scrollRef} className="kp-screen" style={{ flex: 1, overflowY: 'auto', paddingTop: 6, paddingBottom: 86 }}>
          {tab === 'players' && <KPPlayers onOpen={setDetailId} onFilter={() => setFilterOpen(true)} />}
          {tab === 'games' && <KPGames onFilter={() => setFilterOpen(true)} />}
          {tab === 'messages' && <KPMessages onConvo={setConvoId} onReply={setConvoId} />}
          {tab === 'profile' && <KPProfile liveOn={liveOn} setLiveOn={setLiveOn} />}
        </div>

        <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, height: 62, borderRadius: 22, background: 'rgba(20,8,4,0.55)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', zIndex: 30 }}>
          {KP_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button key={t.id} onClick={() => goTab(t.id)} style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: 0 }}>
                <KPTabIcon id={t.id} on={on} />
                <span style={{ fontSize: 10.5, fontWeight: on ? 700 : 500, color: on ? 'var(--lime)' : 'rgba(255,255,255,0.55)' }}>{t.label}</span>
              </button>
            );
          })}
        </div>

        {detailPlayer && <KPDetail player={detailPlayer} onBack={() => setDetailId(null)} onRequest={() => setRequestId(detailPlayer.id)} />}
        {convoPlayer && <KPConvo player={convoPlayer} onBack={() => setConvoId(null)} />}
        {filterOpen && <KPFilterSheet onClose={() => setFilterOpen(false)} />}
        {requestPlayer && <KPRequestModal player={requestPlayer} onClose={() => setRequestId(null)} onSend={sendRequest} />}
        <KPToast show={toast} text="Pelipyyntö lähetetty ✓" />

        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.45)', zIndex: 95 }} />
      </div>
    </div>
  );
}

// Static onboarding phone — recreates the real Krossi login screen (clay court + lime wordmark)
function KrossiOnboardPhone({ width = 240 }) {
  const h = Math.round(width * 2.06);
  return (
    <div style={{ width, height: h, position: 'relative', borderRadius: width * 0.16, background: '#0a0a0a', padding: width * 0.028, boxShadow: '0 50px 90px -30px rgba(60,18,8,0.55), 0 0 0 1.5px rgba(0,0,0,0.4)' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: width * 0.135, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', background: "linear-gradient(180deg, rgba(40,14,6,0.15), rgba(40,12,5,0.55)), url('assets/clay-court.jpg') center/cover" }}>
        <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: width * 0.085, borderRadius: 99, background: '#000', zIndex: 10 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 22px 6px', color: '#fff', flexShrink: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>12.44</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 2.6c2 0 3.8.8 5.1 2.1l1-1C12.5 2 10.4 1 8 1S3.5 2 1.9 3.7l1 1C4.2 3.4 6 2.6 8 2.6z" fill="#fff" /><circle cx="8" cy="9" r="1.4" fill="#fff" /></svg>
            <svg width="24" height="11" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="#fff" strokeOpacity="0.5" fill="none" /><rect x="2" y="2" width="16" height="7" rx="1.5" fill="#fff" /></svg>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 22px', textAlign: 'center' }}>
          <div style={{ fontSize: width * 0.21, fontWeight: 800, color: 'var(--lime)', letterSpacing: -1.5, textShadow: '0 3px 0 rgba(60,70,5,0.55), 0 6px 16px rgba(0,0,0,0.4)' }}>Krossi</div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: width * 0.082, lineHeight: 1.2, marginTop: 12, textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>Löydä pelikavereita<br />tennikseen.</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, padding: `0 ${width * 0.075}px ${width * 0.12}px` }}>
          <div style={{ background: 'var(--lime)', color: '#101a08', borderRadius: 999, padding: '14px 0', textAlign: 'center', fontWeight: 700, fontSize: width * 0.062 }}>Jatka sähköpostilla</div>
          <div style={{ background: '#161616', color: '#fff', borderRadius: 999, padding: '13px 0', textAlign: 'center', fontWeight: 600, fontSize: width * 0.058, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ width: width * 0.07, height: width * 0.07, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: width * 0.05, color: '#4285F4' }}>G</span>Jatka Googlella
          </div>
          <div style={{ background: '#161616', color: '#fff', borderRadius: 999, padding: '13px 0', textAlign: 'center', fontWeight: 600, fontSize: width * 0.058, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width={width * 0.06} height={width * 0.07} viewBox="0 0 20 24" fill="#fff"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.2 3.1-2.5.7-1 1-2 1-2-.1 0-2-.8-2-3.3zM13.9 3.5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3.1-1.4z" /></svg>Jatka Applella
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.55)', zIndex: 10 }} />
      </div>
    </div>
  );
}

Object.assign(window, { KrossiPhone, KrossiOnboardPhone });
