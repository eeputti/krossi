// koutsi-pelaaja-app.jsx — full-page player web app for koutsi.krossi.app/pelaaja.
// Reads/writes the real Supabase-backed store from koutsi-data.js (see koutsi-auth.jsx
// for the login/onboarding gate this file is mounted behind), so whatever the coach adds
// (a diary entry, a new training, a video) shows up here live, and whatever the player
// sets (their goal, a wish, a video) shows up for the coach live too. The localStorage-only
// sales demo is lib/koutsi-demo-pelaaja-app.jsx.

const TAG_LABELS = { kaikki: 'Kaikki', syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka', lammittely: 'Lämmittely' };
const EXERCISE_TAGS = ['kaikki', 'syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely'];
const PLAYER_COUNT_FILTERS = [
  { key: 'kaikki', label: 'Kaikki' },
  { key: 1, label: '1 pelaaja' },
  { key: 2, label: '2 pelaajaa' },
  { key: 3, label: '3 pelaajaa' },
  { key: 4, label: '4+ pelaajaa' },
];
const CAL_WEEKDAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];

function Avatar({ initial, hue = 150, size = 44, ring = false }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue} 55% 62%), hsl(${hue + 24} 60% 38%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.38,
      boxShadow: ring ? '0 0 0 3px var(--lime)' : 'none', letterSpacing: 0.3,
    }}>{initial}</div>
  );
}

function VideoRow({ videos, onAdd }) {
  return (
    <div>
      {videos.length === 0 ? (
        <div style={{ color: '#8a857a', fontSize: 14.5, marginBottom: 12 }}>Ei vielä videoita.</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 2, marginBottom: 12 }}>
          {videos.map((v) => (
            <div key={v.id} style={{ width: 160, flexShrink: 0 }}>
              <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 16, position: 'relative', overflow: 'hidden', background: `radial-gradient(120% 120% at 30% 20%, hsl(${v.hue} 55% 45%), hsl(${v.hue + 24} 60% 22%))` }}>
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="14" height="16" viewBox="0 0 12 14"><path d="M1 1v12l10-6L1 1z" fill="#101a08" /></svg>
                  </span>
                </span>
                {v.addedBy === 'player' && <span style={{ position: 'absolute', left: 7, top: 7, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 6 }}>Oma</span>}
              </div>
              <div style={{ color: '#111', fontSize: 13, fontWeight: 600, marginTop: 7, lineHeight: 1.35 }}>{v.title}</div>
              <div style={{ color: '#8a857a', fontSize: 11, marginTop: 2 }}>{window.koutsiFmtShortDate(v.date)}</div>
              {v.tags && v.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                  {v.tags.map((t) => <span key={t} className="k-chip" style={{ padding: '2px 8px', fontSize: 10.5 }}>{window.KOUTSI_TAG_LABELS[t] || t}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <button onClick={onAdd} className="btn-outline btn-sm">+ Lisää video</button>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>{children}</div>;
}
function PageHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, color: 'var(--green-deep)' }}>{title}</h1>
      {sub && <p style={{ fontSize: 14.5, color: '#8a857a', marginTop: 4 }}>{sub}</p>}
    </div>
  );
}
function LevelChip({ level }) {
  const c = window.koutsiLevelColor(level);
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, lineHeight: 1, background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}>{level}</span>;
}
function IdentityBlock({ student, group }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 26, textAlign: 'center' }}>
      <Avatar initial={student.initial} hue={student.hue} size={76} ring />
      <div style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>{student.name}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <LevelChip level={student.level || 'Ei asetettu'} />
        {group && <span className="k-chip">Ryhmä: {group.name} · {group.day} {group.time}</span>}
      </div>
    </div>
  );
}
function GoalCard({ student, onSave }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(student.goal);
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => { setValue(student.goal); setEditing(false); }, [student.id]);
  const save = () => {
    onSave(value.trim());
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };
  return (
    <div style={{ marginBottom: 26 }}>
      <SectionTitle>Tavoitteeni</SectionTitle>
      <div className="k-card" style={{ padding: '16px 18px' }}>
        {editing ? (
          <React.Fragment>
            <textarea autoFocus value={value} onChange={(e) => setValue(e.target.value)} rows={2} placeholder="Missä haluaisit kehittyä?"
              style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 12, padding: '11px 13px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 10, background: '#fff' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditing(false)} className="btn-outline btn-sm">Peruuta</button>
              <button onClick={save} className="btn-dark btn-sm">Tallenna</button>
            </div>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <p style={{ fontSize: 15, color: '#111', lineHeight: 1.55, marginBottom: 10 }}>{student.goal || 'Et ole vielä asettanut tavoitetta.'}</p>
            <button onClick={() => setEditing(true)} className="btn-outline btn-sm">{saved ? 'Tallennettu ✓' : 'Muokkaa tavoitetta'}</button>
          </React.Fragment>
        )}
      </div>
    </div>
  );
}
function VideoModal({ onClose, onSave }) {
  const [title, setTitle] = React.useState('');
  const [date, setDate] = React.useState(window.koutsiTodayStr());
  const [tags, setTags] = React.useState([]);
  const toggleTag = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  const ready = title.trim() && date;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Lisää video</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Videon tiedostoa ei voi vielä ladata täältä — anna videolle otsikko, päivämäärä ja aihe. Lähetä itse tiedosto esim. viestillä.</p>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Otsikko</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Oma syöttöharjoittelu" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Päivämäärä</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Aihe</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {window.KOUTSI_TAGS.map((t) => (
            <button key={t} onClick={() => toggleTag(t)} style={{ padding: '8px 14px', borderRadius: 999, border: tags.includes(t) ? 'none' : '1px solid #d8d4ca', background: tags.includes(t) ? 'var(--lime)' : '#fff', color: tags.includes(t) ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{window.KOUTSI_TAG_LABELS[t]}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ title: title.trim(), date, tags })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>Lisää</button>
        </div>
      </div>
    </div>
  );
}

// ── Koti ─────────────────────────────────────────────────
function HomeView({ student, group, onSaveGoal, wish, setWish, wishSaved, onSaveWish }) {
  const latestEntry = student.diary[0];
  return (
    <div>
      <IdentityBlock student={student} group={group} />

      {group && group.theme && (
        <div className="k-card" style={{ padding: '20px 24px', background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)', marginBottom: 22 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 }}>Viikon teema — {group.name}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#111', marginBottom: 5 }}>{group.theme.title}</div>
          <div style={{ fontSize: 14, color: '#514c42', lineHeight: 1.55 }}>{group.theme.lead}</div>
        </div>
      )}

      <GoalCard student={student} onSave={onSaveGoal} />

      {latestEntry && (
        <div style={{ marginBottom: 26 }}>
          <SectionTitle>Viimeisin palaute valmentajalta</SectionTitle>
          <div className="k-card" style={{ padding: '18px 20px', borderColor: 'var(--green-deep)', borderWidth: 1.5 }}>
            <p style={{ fontSize: 15.5, color: '#111', lineHeight: 1.6 }}>{latestEntry.text}</p>
            <div style={{ marginTop: 8, fontSize: 12.5, color: '#8a857a', fontWeight: 600 }}>{latestEntry.date}</div>
          </div>
        </div>
      )}

      <div>
        <SectionTitle>Toiveeni seuraavalle kerralle</SectionTitle>
        <textarea value={wish} onChange={(e) => setWish(e.target.value)} placeholder="Mitä haluaisit harjoitella seuraavassa treenissä?" rows={2}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', resize: 'none', background: '#fff', marginBottom: 10 }} />
        <button onClick={onSaveWish} className="btn-dark btn-sm">{wishSaved ? 'Tallennettu ✓' : 'Lähetä toive valmentajalle'}</button>
      </div>
    </div>
  );
}

// ── Ryhmä ────────────────────────────────────────────────
function GroupView({ student, state }) {
  const groups = window.koutsiGroupsForStudent(state, student.id);
  if (groups.length === 0) {
    return (
      <div>
        <PageHeader title="Ryhmä" />
        <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5 }}>Et ole vielä valmennusryhmässä.</div>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Ryhmä" sub="Ryhmäsi, teema ja ryhmäläiset" />
      {groups.map((g) => {
        const coach = window.koutsiCoachById(state, g.coachId);
        const members = g.memberIds.map((id) => window.koutsiStudentById(state, id)).filter(Boolean);
        return (
          <div key={g.id} style={{ marginBottom: 30 }}>
            <div className="k-card" style={{ padding: '18px 20px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>{g.name}</div>
                  <div style={{ fontSize: 13, color: '#8a857a', marginTop: 3 }}>{g.day} klo {g.time} viikoittain{coach ? ` · ${coach.name}` : ''}</div>
                </div>
                <LevelChip level={g.level} />
              </div>
            </div>
            {g.theme && (
              <div className="k-card" style={{ padding: '18px 20px', background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)', marginBottom: 16 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 5 }}>Viikon teema</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#111', marginBottom: 4 }}>{g.theme.title}</div>
                <div style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.5 }}>{g.theme.lead}</div>
              </div>
            )}
            <SectionTitle>{`Ryhmäläiset (${members.length})`}</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {members.map((m) => (
                <div key={m.id} className="k-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
                  <Avatar initial={m.initial} hue={m.hue} size={40} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14.5, color: '#111' }}>{m.name}{m.id === student.id ? ' (sinä)' : ''}</span>
                      <LevelChip level={m.level} />
                    </div>
                    <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2 }}>{m.goal}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── kalenteri (pelaajan omat treenit) ────────────────────
function PlayerCalendarGrid({ state, studentId, viewYear, viewMonth, selectedDate, todayStr, onSelect, onPrev, onNext }) {
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const dateStrFor = (d) => `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return (
    <div className="k-card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button onClick={onPrev} aria-label="Edellinen kuukausi" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="7" height="12" viewBox="0 0 8 14"><path d="M7 1L1 7l6 6" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', textTransform: 'capitalize' }}>{window.KOUTSI_MONTHS[viewMonth]} {viewYear}</div>
        <button onClick={onNext} aria-label="Seuraava kuukausi" style={{ width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="7" height="12" viewBox="0 0 8 14"><path d="M1 1l6 6-6 6" stroke="#111" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
        {CAL_WEEKDAY_LABELS.map((d) => <div key={d} style={{ fontSize: 10.5, fontWeight: 700, color: '#a8a297', textAlign: 'center' }}>{d}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const ds = dateStrFor(d);
          const dayTrainings = window.koutsiTrainingsOnDateForStudent(state, ds, studentId);
          const dayClubEvents = window.koutsiClubEventsOnDate(state, ds);
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDate;
          return (
            <button key={i} onClick={() => onSelect(ds)} style={{
              aspectRatio: '1', borderRadius: 10, border: isSelected ? '2px solid var(--green-deep)' : '2px solid transparent',
              background: isSelected ? 'rgba(14,59,44,0.06)' : isToday ? 'rgba(207,228,20,0.2)' : 'transparent',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit',
            }}>
              <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: '#111' }}>{d}</span>
              {(dayTrainings.length > 0 || dayClubEvents.length > 0) && (
                <span style={{ display: 'flex', gap: 2 }}>
                  {dayTrainings.slice(0, 3).map((t, ti) => <span key={ti} style={{ width: 5, height: 5, borderRadius: '50%', background: t.groupId != null ? 'var(--green-deep)' : 'var(--lime)' }} />)}
                  {dayClubEvents.length > 0 && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c77b2e' }} />}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--lime)' }} />Yksilö</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green-deep)' }} />Ryhmä</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c77b2e' }} />Seuran tapahtuma</span>
      </div>
    </div>
  );
}

// ── Treenit ──────────────────────────────────────────────
function TrainingsView({ student, state, upcoming, note, setNote, noteSaved, onSaveNote, onToggleHomework }) {
  const todayStr = window.koutsiTodayStr();
  const todayDate = window.koutsiDateFromStr(todayStr);
  const [viewYear, setViewYear] = React.useState(todayDate.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(todayDate.getMonth());
  const [selectedDate, setSelectedDate] = React.useState(todayStr);
  const prevMonth = () => { if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else setViewMonth((m) => m + 1); };
  const trainingsOnSelected = window.koutsiTrainingsOnDateForStudent(state, selectedDate, student.id);
  const clubEventsOnSelected = window.koutsiClubEventsOnDate(state, selectedDate);

  return (
    <div>
      <PageHeader title="Treenit" sub="Kalenteri, tulevat valmennukset ja omatoimiset tehtävät" />

      <div className="kv-calendar-layout" style={{ marginBottom: 26 }}>
        <PlayerCalendarGrid state={state} studentId={student.id} viewYear={viewYear} viewMonth={viewMonth} selectedDate={selectedDate} todayStr={todayStr}
          onSelect={setSelectedDate} onPrev={prevMonth} onNext={nextMonth} />

        <div>
          <div style={{ marginBottom: 26 }}>
            <SectionTitle>{window.koutsiFmtLongDate(selectedDate)}</SectionTitle>
            {clubEventsOnSelected.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {clubEventsOnSelected.map((e) => (
                  <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', borderRadius: 14, background: 'rgba(199,123,46,0.1)', border: '1px solid rgba(199,123,46,0.3)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c77b2e', flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: '#7a4c1e', fontWeight: 700 }}>{e.title}</span>
                  </div>
                ))}
              </div>
            )}
            {trainingsOnSelected.length === 0 ? (
              clubEventsOnSelected.length === 0 && <div className="k-card" style={{ padding: 18, color: '#8a857a', fontSize: 14 }}>Ei valmennuksia tänä päivänä.</div>
            ) : (
              <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
                {trainingsOnSelected.map((t, i) => {
                  const party = window.koutsiTrainingParty(state, t);
                  const coach = window.koutsiCoachById(state, t.coachId);
                  const label = party.kind === 'group' && party.group ? party.group.name : t.type;
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: i === trainingsOnSelected.length - 1 ? 'none' : '1px solid var(--line)' }}>
                      <div style={{ width: 52, fontSize: 13.5, fontWeight: 800, color: 'var(--green-deep)', flexShrink: 0 }}>{t.time}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, color: '#111' }}>{t.type}{party.kind === 'group' ? ` — ${label}` : ''}</div>
                        {coach && <div style={{ fontSize: 12, color: '#8a857a', marginTop: 1 }}>{coach.name}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {upcoming.length > 0 ? (
            <div>
              <SectionTitle>Tulevat valmennukset</SectionTitle>
              <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
                {upcoming.map((t, i) => {
                  const party = window.koutsiTrainingParty(state, t);
                  const coach = window.koutsiCoachById(state, t.coachId);
                  const label = party.kind === 'group' && party.group ? party.group.name : t.type;
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: i === upcoming.length - 1 ? 'none' : '1px solid var(--line)' }}>
                      <div style={{ width: 90, fontSize: 13.5, fontWeight: 800, color: 'var(--green-deep)', flexShrink: 0 }}>{window.koutsiFmtShortDate(t.date)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, color: '#111' }}>{t.type}{party.kind === 'group' ? ` — ${label}` : ''}</div>
                        {coach && <div style={{ fontSize: 12, color: '#8a857a', marginTop: 1 }}>{coach.name}</div>}
                      </div>
                      <div style={{ fontSize: 13.5, color: '#8a857a', fontWeight: 600, flexShrink: 0 }}>{t.time}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5 }}>Ei tulevia valmennuksia.</div>
          )}
        </div>
      </div>

      <div>
        <SectionTitle>Omatoimiset tehtävät</SectionTitle>
        {student.homework.length === 0 ? (
          <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5, marginBottom: 12 }}>Ei vielä kotiläksyjä.</div>
        ) : (
          <div className="k-card" style={{ padding: '8px 18px' }}>
            {student.homework.map((h, i) => (
              <button key={i} onClick={() => onToggleHomework(i)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '12px 0', borderBottom: i === student.homework.length - 1 ? 'none' : '1px solid var(--line)', fontFamily: 'inherit' }}>
                <span style={{ width: 21, height: 21, borderRadius: 7, border: '1.5px solid ' + (h.done ? 'var(--green-deep)' : '#c5c0b5'), background: h.done ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {h.done && <svg width="12" height="10" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </span>
                <span style={{ fontSize: 15, color: '#111', textDecoration: h.done ? 'line-through' : 'none', opacity: h.done ? 0.55 : 1 }}>{h.text}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Miten treenit sujuivat tällä viikolla? Kirjoita oma kommenttisi valmentajalle…" rows={3}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', resize: 'none', background: '#fff', marginBottom: 10 }} />
          <button onClick={onSaveNote} className="btn-dark btn-sm">{noteSaved ? 'Tallennettu ✓' : 'Lähetä kommentti valmentajalle'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Harjoitteet ──────────────────────────────────────────
function ExercisesView({ exercises, onOpen }) {
  const [activeTag, setActiveTag] = React.useState('kaikki');
  const [activeCount, setActiveCount] = React.useState('kaikki');
  const filtered = exercises
    .filter((e) => activeTag === 'kaikki' || e.tags.includes(activeTag))
    .filter((e) => activeCount === 'kaikki' || (activeCount === 4 ? e.playerCount >= 4 : e.playerCount === activeCount));
  return (
    <div>
      <PageHeader title="Harjoitteet" sub="Valmentajan harjoitepankki" />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {PLAYER_COUNT_FILTERS.map((f) => (
          <button key={f.key} onClick={() => setActiveCount(f.key)} style={{ padding: '9px 16px', borderRadius: 999, border: activeCount === f.key ? 'none' : '1px solid var(--line)', background: activeCount === f.key ? 'var(--green-deep)' : '#fff', color: activeCount === f.key ? '#fff' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{f.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {EXERCISE_TAGS.map((t) => (
          <button key={t} onClick={() => setActiveTag(t)} style={{ padding: '9px 16px', borderRadius: 999, border: activeTag === t ? 'none' : '1px solid var(--line)', background: activeTag === t ? 'var(--lime)' : '#fff', color: activeTag === t ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{TAG_LABELS[t]}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {filtered.map((ex) => (
          <button key={ex.id} onClick={() => onOpen(ex.id)} className="k-card" style={{ textAlign: 'left', cursor: 'pointer', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ color: '#111', fontWeight: 700, fontSize: 15.5 }}>{ex.name}</div>
            <div style={{ color: '#8a857a', fontSize: 13 }}>{ex.players} pelaajaa · {ex.duration} · {ex.level}</div>
          </button>
        ))}
        {filtered.length === 0 && <div style={{ color: '#8a857a', fontSize: 14.5 }}>Ei harjoitteita tällä suodattimella.</div>}
      </div>
    </div>
  );
}
function ExerciseDetail({ exercise, onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', padding: '28px 28px 26px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>{exercise.name}</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 18 }}>
          <span className="k-chip">{exercise.players} pelaajaa</span>
          <span className="k-chip">{exercise.duration}</span>
          <LevelChip level={exercise.level} />
        </div>
        <SectionTitle>Tavoite</SectionTitle>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: '#3c382f', marginBottom: 20 }}>{exercise.goal}</p>
        <button onClick={onClose} className="btn-outline" style={{ width: '100%', padding: '13px 0' }}>Sulje</button>
      </div>
    </div>
  );
}

// ── Kehitys ──────────────────────────────────────────────
const MOOD_LABELS = { 1: 'Raskas', 2: 'Vaisu', 3: 'Ihan ok', 4: 'Hyvä', 5: 'Loistava' };
function MoodModal({ onClose, onSave }) {
  const [score, setScore] = React.useState(null);
  const [note, setNote] = React.useState('');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(420px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Miltä treeni tuntui?</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Merkitse fiiliksesi treenin jälkeen — tämä näkyy myös valmentajallesi.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setScore(n)} style={{
              flex: 1, padding: '14px 0', borderRadius: 14, border: score === n ? 'none' : '1px solid #d8d4ca',
              background: score === n ? 'var(--lime)' : '#fff', color: score === n ? '#101a08' : '#3c382f',
              fontWeight: 800, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              {n}
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.2 }}>{MOOD_LABELS[n]}</span>
            </button>
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Miksi? (valinnainen)" rows={3}
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 16, background: '#fff' }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => score && onSave({ score, note: note.trim() })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: score ? 1 : 0.45, cursor: score ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

function MatchNoteModal({ onClose, onSave }) {
  const [opponentName, setOpponentName] = React.useState('');
  const [date, setDate] = React.useState(window.koutsiTodayStr());
  const [note, setNote] = React.useState('');
  const ready = opponentName.trim() && date;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(440px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Ottelumuistiinpano</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Kirjaa taktiikkasi ja huomiosi vastustajasta — löydät nämä helposti uudestaan, jos sama vastustaja tulee vastaan.</p>
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Vastustaja</div>
        <input value={opponentName} onChange={(e) => setOpponentName(e.target.value)} placeholder="Esim. Matti Meikäläinen" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Päivämäärä</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Muistiinpano</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} placeholder="Oliko taktiikkaa etukäteen? Piti/muuttuiko se? Mitä huomasit vastustajan syötöstä, lyönneistä, pelistä?"
          style={{ ...inputStyle, resize: 'none', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => ready && onSave({ opponentName: opponentName.trim(), date, note: note.trim() })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

function ProgressView({ student, onAddVideo, onAddMood, onAddMatchNote }) {
  const moods = student.moods || [];
  const matchNotes = student.matchNotes || [];
  const [opponentSearch, setOpponentSearch] = React.useState('');
  const filteredNotes = opponentSearch.trim()
    ? matchNotes.filter((n) => n.opponentName.toLowerCase().includes(opponentSearch.trim().toLowerCase()))
    : matchNotes;
  return (
    <div>
      <PageHeader title="Kehitys" sub="Kehityshistoriasi ja valmentajan huomiot jokaisesta kerrasta" />

      <div style={{ marginBottom: 26 }}>
        <SectionTitle>Videot</SectionTitle>
        <VideoRow videos={student.videos} onAdd={onAddVideo} />
      </div>

      <div style={{ marginBottom: 26 }}>
        <SectionTitle>Fiilikset</SectionTitle>
        {moods.length === 0 ? (
          <div className="k-card" style={{ padding: 18, color: '#8a857a', fontSize: 14 }}>Ei vielä merkittyjä fiiliksiä.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
            {moods.map((m, i) => (
              <div key={i} className="k-card" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 15px' }}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--lime)', color: '#101a08', fontWeight: 800, fontSize: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{m.score}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{MOOD_LABELS[m.score]}{m.note ? ` — ${m.note}` : ''}</div>
                  <div style={{ fontSize: 11.5, color: '#8a857a', marginTop: 2 }}>{m.date}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <button onClick={onAddMood} className="btn-outline btn-sm" style={{ marginTop: 10 }}>+ Lisää fiilis treenin jälkeen</button>
      </div>

      <div style={{ marginBottom: 26 }}>
        <SectionTitle>Ottelumuistiinpanot</SectionTitle>
        {matchNotes.length > 0 && (
          <input value={opponentSearch} onChange={(e) => setOpponentSearch(e.target.value)} placeholder="Hae vastustajan nimellä…"
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '11px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 10 }} />
        )}
        {filteredNotes.length === 0 ? (
          <div className="k-card" style={{ padding: 18, color: '#8a857a', fontSize: 14 }}>
            {matchNotes.length === 0 ? 'Ei vielä ottelumuistiinpanoja.' : 'Ei osumia haulla.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
            {filteredNotes.map((n) => (
              <div key={n.id} className="k-card" style={{ padding: '13px 15px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: n.note ? 6 : 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{n.opponentName}</div>
                  <div style={{ fontSize: 11.5, color: '#8a857a', flexShrink: 0 }}>{window.koutsiFmtShortDate(n.date)}</div>
                </div>
                {n.note && <div style={{ fontSize: 13.5, color: '#3c382f', lineHeight: 1.5 }}>{n.note}</div>}
              </div>
            ))}
          </div>
        )}
        <button onClick={onAddMatchNote} className="btn-outline btn-sm" style={{ marginTop: 10 }}>+ Lisää ottelumuistiinpano</button>
      </div>

      <SectionTitle>Aikajana</SectionTitle>
      {student.diary.length === 0 ? (
        <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5 }}>Ei vielä merkintöjä — kehityshistoriasi kertyy tänne sitä mukaa kun valmentaja kirjaa huomioita treeneistä.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {student.diary.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: 12 }}>
              <div style={{ width: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: i === 0 ? 'var(--lime)' : '#d8d4ca' }} />
                {i < student.diary.length - 1 && <span style={{ width: 1.5, flex: 1, background: '#e3dfd4', marginTop: 4 }} />}
              </div>
              <div className="k-card" style={{ padding: '14px 16px', marginBottom: 4, flex: 1 }}>
                <div style={{ fontSize: 14.5, color: '#111', lineHeight: 1.55 }}>{d.text}</div>
                <div style={{ fontSize: 12, color: '#8a857a', fontWeight: 600, marginTop: 6 }}>{d.date}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Profiili ─────────────────────────────────────────────
function ProfileView({ student, group, onSignOut }) {
  return (
    <div>
      <PageHeader title="Profiili" />
      <IdentityBlock student={student} group={group} />

      <SectionTitle>Toiminnot</SectionTitle>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a href="https://koutsi.krossi.app" className="btn-outline btn-sm">← Etusivulle</a>
        <button onClick={onSignOut} className="btn-outline btn-sm" style={{ color: '#a13b2f', borderColor: '#e3c9c4' }}>Kirjaudu ulos</button>
      </div>
    </div>
  );
}

// ── nav / shell ──────────────────────────────────────────
const NAV = [
  { id: 'home', label: 'Koti' },
  { id: 'group', label: 'Ryhmä' },
  { id: 'trainings', label: 'Treenit' },
  { id: 'exercises', label: 'Harjoitteet' },
  { id: 'progress', label: 'Kehitys' },
  { id: 'profile', label: 'Profiili' },
];
function NavIcon({ id, on, offColor = '#9a958a' }) {
  const c = on ? 'var(--green-deep)' : offColor;
  if (id === 'home') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><path d="M3 10.5L11 3l8 7.5" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 9v9.5a1 1 0 001 1h10a1 1 0 001-1V9" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (id === 'group') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="7" cy="7.5" r="3" stroke={c} strokeWidth="1.7" /><circle cx="15" cy="7.5" r="3" stroke={c} strokeWidth="1.7" /><path d="M1.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5M9.5 19c0-3.1 2.5-5 5.5-5s5.5 1.9 5.5 5" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'trainings') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="2.5" y="4.5" width="17" height="15" rx="3" stroke={c} strokeWidth="1.7" /><path d="M2.5 9h17M7 2.5v4M15 2.5v4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'exercises') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><rect x="4" y="3" width="14" height="17" rx="2.5" stroke={c} strokeWidth="1.7" /><path d="M8 1.5h6a1 1 0 011 1V4H7V2.5a1 1 0 011-1z" stroke={c} strokeWidth="1.7" /><path d="M7.5 9.5h7M7.5 13h7M7.5 16.5h4" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (id === 'progress') return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><path d="M2.5 19.5h17" stroke={c} strokeWidth="1.7" strokeLinecap="round" /><path d="M3.5 15.5l5-5.5 4 3.5 6-7.5" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M14.5 6h4v4" stroke={c} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg width="19" height="19" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="7.5" r="4" stroke={c} strokeWidth="1.7" /><path d="M3 20c0-4.4 3.6-7 8-7s8 2.6 8 7" stroke={c} strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function Sidebar({ tab, setTab, student, onSignOut }) {
  return (
    <div style={{ width: 248, flexShrink: 0, background: 'var(--green-deep)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '26px 18px', position: 'fixed', top: 0, left: 0, bottom: 0, overflowY: 'auto' }}>
      <a href="https://koutsi.krossi.app" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, textDecoration: 'none', paddingLeft: 6 }}>
        <span style={{ fontWeight: 800, fontSize: 20, color: 'var(--lime)', letterSpacing: -0.5 }}>Krossi</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Koutsi</span>
      </a>
      <span style={{ display: 'inline-flex', alignSelf: 'flex-start', marginLeft: 6, marginTop: 8, marginBottom: 22, padding: '4px 11px', borderRadius: 999, background: 'rgba(207,228,20,0.16)', border: '1px solid rgba(207,228,20,0.4)', color: 'var(--lime)', fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>PELAAJA</span>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'auto' }}>
        {NAV.map((n) => {
          const on = tab === n.id;
          return (
            <button key={n.id} onClick={() => setTab(n.id)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: on ? 'var(--lime)' : 'transparent', color: on ? '#101a08' : 'rgba(255,255,255,0.85)',
              fontWeight: on ? 700 : 600, fontSize: 14.5, fontFamily: 'inherit', textAlign: 'left', transition: 'background .15s',
            }}>
              <NavIcon id={n.id} on={on} offColor="rgba(255,255,255,0.72)" />{n.label}
            </button>
          );
        })}
      </nav>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 6px 8px' }}>
          <Avatar initial={student.initial} hue={student.hue} size={34} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{student.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Pelaaja</div>
          </div>
        </div>
        <button onClick={onSignOut} className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>Kirjaudu ulos</button>
        <a href="https://koutsi.krossi.app" className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>← Etusivulle</a>
      </div>
    </div>
  );
}

function MobileTopBar({ student }) {
  return (
    <div className="kv-mobile-topbar" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 60, zIndex: 45, alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', background: 'rgba(247,245,239,0.9)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
        <a href="https://koutsi.krossi.app" style={{ display: 'inline-flex', alignItems: 'baseline', textDecoration: 'none', flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--green-deep)', letterSpacing: -0.4 }}>Krossi</span>
        </a>
        <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(14,59,44,0.1)', border: '1px solid rgba(14,59,44,0.22)', color: 'var(--green-deep)', fontSize: 10, fontWeight: 800, letterSpacing: 0.4, flexShrink: 0 }}>PELAAJA</span>
      </div>
      <Avatar initial={student.initial} hue={student.hue} size={30} />
    </div>
  );
}

function MobileBottomNav({ tab, setTab }) {
  return (
    <div className="kv-mobile-bottomnav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 68, zIndex: 45, background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderTop: '1px solid var(--line)', boxShadow: '0 -8px 24px -18px rgba(0,0,0,0.2)' }}>
      {NAV.map((n) => {
        const on = tab === n.id;
        const fs = n.label.length > 8 ? 9.5 : 10.5;
        return (
          <button key={n.id} onClick={() => setTab(n.id)} style={{ flex: 1, border: 'none', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit' }}>
            <NavIcon id={n.id} on={on} />
            <span style={{ fontSize: fs, fontWeight: on ? 700 : 500, color: on ? 'var(--green-deep)' : '#9a958a' }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PlayerApp({ studentId, onSignOut }) {
  const [state, setState] = React.useState(null);
  const [tab, setTab] = React.useState('home');
  const [exerciseId, setExerciseId] = React.useState(null);
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [moodOpen, setMoodOpen] = React.useState(false);
  const [matchNoteOpen, setMatchNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [noteSaved, setNoteSaved] = React.useState(false);
  const [wish, setWish] = React.useState('');
  const [wishSaved, setWishSaved] = React.useState(false);
  const notesInitialized = React.useRef(false);

  const reload = React.useCallback(async () => {
    const next = await window.koutsiLoadStudentState(studentId);
    setState(next);
  }, [studentId]);

  React.useEffect(() => { reload(); }, [reload]);

  React.useEffect(() => {
    const tables = ['koutsi_coaches', 'koutsi_students', 'koutsi_coach_students', 'koutsi_groups', 'koutsi_group_members', 'koutsi_trainings', 'koutsi_training_absences', 'koutsi_exercises', 'koutsi_coach_events', 'koutsi_videos', 'koutsi_diary_entries', 'koutsi_homework', 'koutsi_moods', 'koutsi_match_notes'];
    const channel = tables.reduce((ch, table) => ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => reload()), window.koutsiSupabase.channel(`koutsi-player-${studentId}`)).subscribe();
    return () => window.koutsiSupabase.removeChannel(channel);
  }, [studentId, reload]);

  const student = state ? state.students[0] : null;
  React.useEffect(() => {
    if (!student || notesInitialized.current) return;
    notesInitialized.current = true;
    setNote(student.playerNote || '');
    setWish(student.playerWish || '');
  }, [student]);

  if (!state || !student) return <window.KoutsiAuthLoadingScreen />;

  const group = window.koutsiGroupForStudent(state, student.id);
  const upcoming = window.koutsiUpcomingTrainingsForStudent(state, student.id);
  const exercise = exerciseId != null ? state.exercises.find((e) => e.id === exerciseId) : null;

  const guarded = (fn) => async (...args) => { try { await fn(...args); } catch (err) { alert(err.message || 'Jokin meni pieleen'); } };

  const toggleHomework = guarded(async (i) => {
    const item = student.homework[i];
    await window.koutsiToggleHomeworkDone(item.id, !item.done);
    await reload();
  });
  const saveNote = guarded(async () => {
    await window.koutsiSaveNote(studentId, note.trim());
    await reload();
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1800);
  });
  const saveWish = guarded(async () => {
    await window.koutsiSaveWish(studentId, wish.trim());
    await reload();
    setWishSaved(true);
    setTimeout(() => setWishSaved(false), 1800);
  });
  const saveGoal = guarded(async (goal) => {
    await window.koutsiSaveGoal(studentId, goal);
    await reload();
  });
  const addVideo = guarded(async ({ title, date, tags }) => {
    await window.koutsiShareVideo({ title, date, tags, studentIds: [studentId], addedById: studentId });
    await reload();
    setVideoOpen(false);
  });
  const addMood = guarded(async ({ score, note: moodNote }) => {
    await window.koutsiAddMood(studentId, { score, note: moodNote });
    await reload();
    setMoodOpen(false);
  });
  const addMatchNote = guarded(async ({ opponentName, date, note: matchNote }) => {
    await window.koutsiAddMatchNote(studentId, { opponentName, date, note: matchNote });
    await reload();
    setMatchNoteOpen(false);
  });

  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="kv-sidebar-wrap">
        <Sidebar tab={tab} setTab={setTab} student={student} onSignOut={onSignOut} />
      </div>
      <MobileTopBar student={student} />
      <div className="kv-main">
        <div key={tab} className="k-rise-in" style={{ maxWidth: 640, margin: '0 auto' }}>
          {tab === 'home' && <HomeView student={student} group={group} onSaveGoal={saveGoal} wish={wish} setWish={setWish} wishSaved={wishSaved} onSaveWish={saveWish} />}
          {tab === 'group' && <GroupView student={student} state={state} />}
          {tab === 'trainings' && <TrainingsView student={student} state={state} upcoming={upcoming} note={note} setNote={setNote} noteSaved={noteSaved} onSaveNote={saveNote} onToggleHomework={toggleHomework} />}
          {tab === 'exercises' && <ExercisesView exercises={state.exercises} onOpen={setExerciseId} />}
          {tab === 'progress' && <ProgressView student={student} onAddVideo={() => setVideoOpen(true)} onAddMood={() => setMoodOpen(true)} onAddMatchNote={() => setMatchNoteOpen(true)} />}
          {tab === 'profile' && <ProfileView student={student} group={group} onSignOut={onSignOut} />}
        </div>
      </div>
      <MobileBottomNav tab={tab} setTab={setTab} />
      {exercise && <ExerciseDetail exercise={exercise} onClose={() => setExerciseId(null)} />}
      {videoOpen && <VideoModal onClose={() => setVideoOpen(false)} onSave={addVideo} />}
      {moodOpen && <MoodModal onClose={() => setMoodOpen(false)} onSave={addMood} />}
      {matchNoteOpen && <MatchNoteModal onClose={() => setMatchNoteOpen(false)} onSave={addMatchNote} />}
    </div>
  );
}

// ── root gate: auth -> Krossi onboarding -> invite code -> app ─────────
function InviteCodeScreen({ onSignOut }) {
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      const result = await window.koutsiRedeemInviteCode(code.trim().toUpperCase());
      setInfo(`Liityit${result.group_name ? ` ryhmään ${result.group_name}` : ''}${result.coach_name ? ` — valmentaja ${result.coach_name}` : ''}!`);
      setTimeout(() => window.location.reload(), 1400);
    } catch (err) { setError(err.message || 'Koodi ei kelvannut'); } finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)' }}>
      <div className="k-card" style={{ width: 'min(400px, 100%)', padding: '30px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#111' }}>Liity valmentajasi ryhmään</h2>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Syötä valmentajaltasi saamasi liittymiskoodi.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        {info && <div style={{ background: 'rgba(14,59,44,0.08)', border: '1px solid rgba(14,59,44,0.25)', color: 'var(--green-deep)', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{info}</div>}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Esim. VHDC6P" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 18, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'inherit', color: '#111', background: '#fff' }} />
          <button className="btn-dark" type="submit" disabled={busy || !code.trim()} style={{ padding: '13px 0', opacity: (busy || !code.trim()) ? 0.5 : 1 }}>{busy ? 'Liitytään...' : 'Liity'}</button>
        </form>
        <button onClick={onSignOut} style={{ background: 'none', border: 'none', color: '#8a857a', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', marginTop: 16, width: '100%', textAlign: 'center' }}>Kirjaudu ulos</button>
      </div>
    </div>
  );
}
function KoutsiPelaajaRoot() {
  const auth = window.useKoutsiAuth();
  const [studentRow, setStudentRow] = React.useState(undefined); // undefined = checking, null = no coach yet

  const checkStudent = React.useCallback(async () => {
    if (!auth.session) return;
    const student = await window.koutsiFetchStudentRow(auth.session.user.id);
    if (!student) { setStudentRow(null); return; }
    const links = await window.koutsiFetchCoachLinksForStudent(auth.session.user.id);
    setStudentRow(links.length > 0 ? student : null);
  }, [auth.session]);

  React.useEffect(() => {
    if (!auth.session || auth.needsOnboarding) { setStudentRow(undefined); return; }
    checkStudent();
  }, [auth.session, auth.needsOnboarding, checkStudent]);

  if (auth.loading) return <window.KoutsiAuthLoadingScreen />;
  if (!auth.session) return <window.KoutsiAuthScreen />;
  if (auth.needsOnboarding) return <window.KoutsiProfileOnboarding />;
  if (studentRow === undefined) return <window.KoutsiAuthLoadingScreen />;
  if (!studentRow) return <InviteCodeScreen onSignOut={auth.signOut} />;
  return <PlayerApp studentId={auth.session.user.id} onSignOut={auth.signOut} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <window.KoutsiAuthProvider><KoutsiPelaajaRoot /></window.KoutsiAuthProvider>
);
