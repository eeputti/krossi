// koutsi-pelaaja-app.jsx — full-page player web app for koutsi.krossi.app/pelaaja.
// Reads/writes the real Supabase-backed store from koutsi-data.js (see koutsi-auth.jsx
// for the login/onboarding gate this file is mounted behind), so whatever the coach adds
// (a diary entry, a new training, a video) shows up here live, and whatever the player
// sets (their goal, a wish, a video) shows up for the coach live too. The sales demo at
// demo.koutsi.krossi.app runs this very file — lib/koutsi-demo-backend.jsx swaps an
// in-memory store in underneath koutsi-data.js.

const TAG_LABELS = { kaikki: 'Kaikki', syotto: 'Syöttö', liikkuminen: 'Liikkuminen', pistepeli: 'Pistepeli', verkkopeli: 'Verkkopeli', tekniikka: 'Tekniikka', lammittely: 'Lämmittely', fysiikka: 'Fysiikka', drilli: 'Drilli' };
const EXERCISE_TAGS = ['kaikki', 'syotto', 'liikkuminen', 'pistepeli', 'verkkopeli', 'tekniikka', 'lammittely', 'fysiikka', 'drilli'];
const PLAYER_COUNT_FILTERS = [
  { key: 'kaikki', label: 'Kaikki' },
  { key: 1, label: '1 pelaaja' },
  { key: 2, label: '2 pelaajaa' },
  { key: 3, label: '3 pelaajaa' },
  { key: 4, label: '4+ pelaajaa' },
];
const CAL_WEEKDAY_LABELS = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
function playerAgeLabel(player) {
  return player.ageLabel || (player.age == null ? '' : `${player.age} v`);
}

// `src` on profiilikuva, jos sellainen on ladattu; ilman sitä (tai jos kuva ei lataudu)
// näytetään sama nimikirjain-ympyrä kuin ennenkin.
function Avatar({ initial, hue = 150, size = 44, ring = false, src = '' }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setFailed(false); }, [src]);
  const shell = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
    background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue} 55% 62%), hsl(${hue + 24} 60% 38%))`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', fontWeight: 700, fontSize: size * 0.38,
    boxShadow: ring ? '0 0 0 3px var(--lime)' : 'none', letterSpacing: 0.3,
  };
  return (
    <div style={shell}>
      {src && !failed
        ? <img src={src} alt="" onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : initial}
    </div>
  );
}

// Bucket on yksityinen, joten toisto hakee allekirjoitetun linkin klikattaessa.
function VideoPlayerModal({ video, onClose }) {
  const [url, setUrl] = React.useState(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    let cancelled = false;
    if (!video.storagePath) { setUrl(null); return; }
    window.koutsiVideoUrl(video.storagePath)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch((e) => { if (!cancelled) setError(e.message || 'Videota ei voitu avata'); });
    return () => { cancelled = true; };
  }, [video.storagePath]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(10,15,10,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(760px, 100%)' }}>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 15, marginBottom: 10 }}>{video.title}</div>
        {error && <div style={{ background: '#fff', borderRadius: 12, padding: 16, color: '#a13b2f', fontSize: 13.5 }}>{error}</div>}
        {!error && !url && video.storagePath && <div style={{ background: '#fff', borderRadius: 12, padding: 16, color: '#8a857a', fontSize: 13.5 }}>Avataan videota…</div>}
        {url && <video src={url} controls autoPlay playsInline style={{ width: '100%', borderRadius: 14, background: '#000', maxHeight: '75vh' }} />}
        {!video.storagePath && video.externalUrl && (
          <div style={{ background: '#fff', borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: 13.5, color: '#514c42', marginBottom: 12 }}>Tämä video on jaettu linkkinä.</div>
            <a href={video.externalUrl} target="_blank" rel="noopener noreferrer" className="btn-dark" style={{ display: 'inline-block', textDecoration: 'none', padding: '11px 18px' }}>Avaa video</a>
          </div>
        )}
        <button onClick={onClose} className="btn-outline" style={{ marginTop: 12, background: '#fff' }}>Sulje</button>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 }}>{children}</div>;
}
function PageHeader({ title, sub, action }) {
  return (
    <div style={{ marginBottom: 22, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: -0.5, color: 'var(--green-deep)' }}>{title}</h1>
        {sub && <p style={{ fontSize: 14.5, color: '#8a857a', marginTop: 4 }}>{sub}</p>}
      </div>
      {action}
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
      <Avatar src={student.avatarUrl} initial={student.initial} hue={student.hue} size={76} ring />
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
  const [shareId] = React.useState(() => window.koutsiRandomUuid());
  const [title, setTitle] = React.useState('');
  const [date, setDate] = React.useState(window.koutsiTodayStr());
  const [tags, setTags] = React.useState([]);
  const [file, setFile] = React.useState(null);
  const [externalUrl, setExternalUrl] = React.useState('');
  const [source, setSource] = React.useState('link');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [error, setError] = React.useState('');
  const fileRef = React.useRef(null);
  const toggleTag = (t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  const pickFile = (e) => {
    const f = e.target.files?.[0];
    setError('');
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      setFile(null);
      setSource('link');
      setError(`${Math.round(f.size / 1048576)} Mt tiedosto on liian suuri. Lataa pitkä video YouTubeen tai Driveen rajatulla näkyvyydellä ja liitä linkki tähän.`);
      return;
    }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };
  const hasSource = source === 'file' ? Boolean(file) : /^https?:\/\//i.test(externalUrl.trim());
  const ready = title.trim() && date && hasSource && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setProgress(0); setError('');
    try {
      await onSave({
        shareId, title: title.trim(), date, tags,
        file: source === 'file' ? file : null,
        externalUrl: source === 'link' ? externalUrl.trim() : null,
        onProgress: setProgress,
      });
    }
    catch (err) { setError(err.message || 'Videon tallennus epäonnistui'); setBusy(false); }
  };
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(460px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Lisää video</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 16, lineHeight: 1.5 }}>Video näkyy sinulle ja valmentajallesi. Pitkälle videolle käytä rajattua YouTube- tai Drive-linkkiä; lyhyen klipin voit ladata suoraan.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {[['link', 'Pitkä video linkkinä'], ['file', 'Lyhyt klippi tiedostona']].map(([key, label]) => (
            <button key={key} onClick={() => { setSource(key); setError(''); }} disabled={busy} style={{ padding: '9px 15px', borderRadius: 999, border: source === key ? 'none' : '1px solid #d8d4ca', background: source === key ? 'var(--lime)' : '#fff', color: source === key ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{label}</button>
          ))}
        </div>
        {source === 'file' ? (
          <React.Fragment>
            <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/mpeg" onChange={pickFile} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-outline" style={{ width: '100%', padding: '13px 0', marginBottom: 16 }}>
              {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1048576))} Mt)` : 'Valitse enintään 50 Mt video…'}
            </button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://youtube.com/... tai https://drive.google.com/..." style={{ ...inputStyle, marginBottom: 8 }} />
            <div style={{ color: '#8a857a', fontSize: 11.5, lineHeight: 1.45, marginBottom: 16 }}>Koutsi näyttää linkin vain sinulle ja valmentajallesi. Aseta myös YouTube- tai Drive-videon omat jako-oikeudet huolellisesti.</div>
          </React.Fragment>
        )}
        {busy && source === 'file' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b665c', marginBottom: 6 }}><span>Suora lataus Storageen</span><b>{progress}%</b></div>
            <div style={{ height: 7, borderRadius: 999, overflow: 'hidden', background: '#ebe8df' }}><div style={{ height: '100%', width: `${progress}%`, background: 'var(--lime)', transition: 'width .2s ease' }} /></div>
          </div>
        )}
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Otsikko</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Oma syöttöharjoittelu" style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Päivämäärä</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 }}>Aihe</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {window.KOUTSI_TAGS.map((t) => (
            <button key={t} onClick={() => toggleTag(t)} disabled={busy} style={{ padding: '8px 14px', borderRadius: 999, border: tags.includes(t) ? 'none' : '1px solid #d8d4ca', background: tags.includes(t) ? 'var(--lime)' : '#fff', color: tags.includes(t) ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>{window.KOUTSI_TAG_LABELS[t]}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} disabled={!ready} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>{busy ? (source === 'file' ? `Ladataan ${progress}%` : 'Jaetaan…') : 'Lisää'}</button>
        </div>
      </div>
    </div>
  );
}

// ── Koti ─────────────────────────────────────────────────
// Etusivu vastaa kysymykseen "mitä minulle kuuluu juuri nyt": milloin on seuraava
// treeni, mitä läksyjä on tekemättä, mikä on viikon teema, mitä valmentaja viimeksi
// sanoi. Kaikki muu (koko kalenteri, ryhmän tiedot, historia) on omilla välilehdillään.
function NextTrainingCard({ state, student, todayStr }) {
  const upcoming = window.koutsiUpcomingTrainingsForStudent(state, student.id);
  const next = upcoming[0];
  const rest = upcoming.slice(1, 3);
  if (!next) {
    return (
      <div className="k-card" style={{ padding: '18px 20px', marginBottom: 22, color: '#8a857a', fontSize: 14.5 }}>
        Ei tulevia treenejä kalenterissa.
      </div>
    );
  }
  const party = window.koutsiTrainingParty(state, next);
  const coach = window.koutsiCoachById(state, next.coachId);
  const groupName = party.kind === 'group' && party.group ? party.group.name : null;
  const isToday = next.date === todayStr;
  return (
    <div className="k-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 22 }}>
      <div style={{ padding: '17px 20px 16px', background: 'linear-gradient(135deg, rgba(207,228,20,0.22), rgba(14,59,44,0.06))' }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 7 }}>
          {isToday ? 'Tänään' : 'Seuraava treeni'}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#111' }}>
            {isToday ? `klo ${next.time}` : `${window.koutsiFmtShortDate(next.date)} klo ${next.time}`}
          </span>
          <span style={{ fontSize: 14.5, color: '#3c382f' }}>{next.type}{groupName ? ` — ${groupName}` : ''}</span>
        </div>
        {coach && <div style={{ fontSize: 13, color: '#6b665c' }}>{coach.name}</div>}
      </div>
      {rest.length > 0 && (
        <div style={{ padding: '11px 20px 12px', borderTop: '1px solid var(--line)' }}>
          {rest.map((t) => {
            const p = window.koutsiTrainingParty(state, t);
            const gn = p.kind === 'group' && p.group ? p.group.name : null;
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, color: '#8a857a', padding: '3px 0' }}>
                <span style={{ minWidth: 70, fontWeight: 700, color: '#6b665c' }}>{window.koutsiFmtShortDate(t.date)}</span>
                <span>klo {t.time}</span>
                <span>· {t.type}{gn ? ` — ${gn}` : ''}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HomeHomeworkCard({ student, onToggleHomework }) {
  const homework = student.homework || [];
  const open = homework.map((h, i) => ({ h, i })).filter((x) => !x.h.done);
  if (homework.length === 0) return null;
  if (open.length === 0) {
    return (
      <div style={{ marginBottom: 22 }}>
        <SectionTitle>Kotiläksyt</SectionTitle>
        <div className="k-card" style={{ padding: '15px 18px', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(207,228,20,0.12)', borderColor: 'rgba(14,59,44,0.18)' }}>
          <span style={{ width: 21, height: 21, borderRadius: 7, background: 'var(--green-deep)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="12" height="10" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: '#111' }}>Kaikki läksyt tehty — hyvää työtä.</span>
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 22 }}>
      <SectionTitle>{`Kotiläksyt (${open.length})`}</SectionTitle>
      <div className="k-card" style={{ padding: '6px 18px' }}>
        {open.map(({ h, i }, n) => (
          <div key={i} style={{ borderBottom: n === open.length - 1 ? 'none' : '1px solid var(--line)' }}>
            <HomeworkRow item={h} done={false} onToggle={() => onToggleHomework(i)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Ilman valmentajaa etusivu näyttäisi pelkkiä tyhjiä laatikoita ("ei treenejä", "ei
// palautetta") — yksi kortti, joka kertoo miksi, on rehellisempi kuin viisi tyhjää.
function NoCoachCard({ onGoTab }) {
  return (
    <div className="k-card" style={{ padding: '19px 22px', marginBottom: 22, background: 'linear-gradient(135deg, rgba(207,228,20,0.18), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 }}>Tutustumistila</div>
      <div style={{ fontSize: 16.5, fontWeight: 800, color: '#111', marginBottom: 6 }}>Et ole vielä valmentajan ryhmässä</div>
      <p style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.55, marginBottom: 13 }}>
        Treenit, kotiläksyt, harjoitteet ja valmentajan palautteet ilmestyvät tänne heti kun liityt ryhmään liittymiskoodilla. Siihen asti voit asettaa tavoitteen ja kirjata fiiliksiä sekä ottelumuistiinpanoja — ne säilyvät, kun lisäät koodin myöhemmin.
      </p>
      <button onClick={() => onGoTab('group')} className="btn-dark btn-sm">Liity ryhmään koodilla</button>
    </div>
  );
}

function HomeView({ student, state, group, hasCoach, onSaveGoal, wish, setWish, wishSaved, onSaveWish, onToggleHomework, onGoTab }) {
  const latestEntry = student.diary[0];
  const todayStr = window.koutsiTodayStr();
  if (!hasCoach) {
    return (
      <div>
        <IdentityBlock student={student} group={null} />
        <NoCoachCard onGoTab={onGoTab} />
        <GoalCard student={student} onSave={onSaveGoal} />
      </div>
    );
  }
  return (
    <div>
      <IdentityBlock student={student} group={group} />

      <NextTrainingCard state={state} student={student} todayStr={todayStr} />

      <HomeHomeworkCard student={student} onToggleHomework={onToggleHomework} />

      {group && group.theme && (
        <div className="k-card" style={{ padding: '17px 20px', background: 'linear-gradient(135deg, rgba(207,228,20,0.16), rgba(14,59,44,0.05))', borderColor: 'rgba(14,59,44,0.14)', marginBottom: 22 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 5 }}>
            Viikon teema · vko {group.theme.week} — {group.name}
          </div>
          <div style={{ fontSize: 16.5, fontWeight: 800, color: '#111', marginBottom: 4 }}>{group.theme.title}</div>
          {group.theme.lead && <div style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.5 }}>{group.theme.lead}</div>}
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
          <button onClick={() => onGoTab('progress')} className="btn-outline btn-sm" style={{ marginTop: 10 }}>Koko kehityshistoria →</button>
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
// Yksi ryhmä = yksi kortti. Kaikki ryhmää koskeva (aikataulu, valmentaja, viikon
// teema, seuraavat treenit, ryhmäläiset) on saman reunuksen sisällä, jotta useampi
// ryhmä ei valu yhdeksi epämääräiseksi korttipinoksi.
function GroupCardLabel({ children }) {
  return <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--green-deep)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>{children}</div>;
}
function GroupMetaItem({ icon, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#6b665c' }}>
      {icon}{children}
    </span>
  );
}
function GroupMetaIcon({ kind }) {
  const c = '#8a857a';
  if (kind === 'clock') return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.4" stroke={c} strokeWidth="1.4" /><path d="M8 4.6V8l2.4 1.6" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (kind === 'coach') return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.6" r="2.6" stroke={c} strokeWidth="1.4" /><path d="M2.9 13.6c0-2.6 2.3-4.2 5.1-4.2s5.1 1.6 5.1 4.2" stroke={c} strokeWidth="1.4" strokeLinecap="round" /></svg>;
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="5.6" cy="5.8" r="2.2" stroke={c} strokeWidth="1.4" /><circle cx="11" cy="5.8" r="2.2" stroke={c} strokeWidth="1.4" /><path d="M1.4 13.4c0-2.2 1.9-3.5 4.2-3.5s4.2 1.3 4.2 3.5M7.6 13.4c0-2.2 1.9-3.5 4.2-3.5s2.8 1.3 2.8 3.5" stroke={c} strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function GroupCard({ group, state, student, onEditAttendance }) {
  const coach = window.koutsiCoachById(state, group.coachId);
  const members = group.memberIds.map((id) => window.koutsiStudentById(state, id)).filter(Boolean);
  const today = window.koutsiTodayStr();
  const upcoming = window.koutsiTrainingsForGroup(state, group.id).filter((t) => t.date >= today).slice(0, 3);
  return (
    <div className="k-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 18 }}>
      <div style={{ padding: '18px 20px 15px', background: 'linear-gradient(135deg, rgba(14,59,44,0.06), rgba(207,228,20,0.10))', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 9 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#111', letterSpacing: -0.2 }}>{group.name}</div>
          <LevelChip level={group.level} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <GroupMetaItem icon={<GroupMetaIcon kind="clock" />}>{group.day} klo {group.time} viikoittain</GroupMetaItem>
          {(group.slots || []).map((slot) => (
            <GroupMetaItem key={slot.id} icon={<GroupMetaIcon kind="clock" />}>{slot.day} klo {slot.time} viikoittain</GroupMetaItem>
          ))}
          {coach && <GroupMetaItem icon={<GroupMetaIcon kind="coach" />}>{coach.name}</GroupMetaItem>}
          <GroupMetaItem icon={<GroupMetaIcon kind="members" />}>{members.length} ryhmäläistä</GroupMetaItem>
        </div>
      </div>

      {(group.theme || (group.upcomingThemes || []).length > 0) && (
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--line)' }}>
          {group.theme ? (
            <React.Fragment>
              <GroupCardLabel>Viikon teema · vko {group.theme.week}</GroupCardLabel>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: '#111', marginBottom: 4 }}>{group.theme.title}</div>
              {group.theme.lead && <div style={{ fontSize: 13.5, color: '#514c42', lineHeight: 1.5 }}>{group.theme.lead}</div>}
            </React.Fragment>
          ) : (
            <React.Fragment>
              <GroupCardLabel>Viikon teema</GroupCardLabel>
              <div style={{ fontSize: 13.5, color: '#8a857a' }}>Tälle viikolle ei ole teemaa.</div>
            </React.Fragment>
          )}
          {(group.upcomingThemes || []).length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Tulossa</div>
              {group.upcomingThemes.slice(0, 3).map((t) => (
                <div key={t.id} style={{ fontSize: 13, color: '#514c42', padding: '2px 0' }}>
                  <b style={{ color: 'var(--green-deep)' }}>vko {t.week}</b> · {t.title}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--line)' }}>
        <GroupCardLabel>Seuraavat treenit</GroupCardLabel>
        {upcoming.length === 0 ? (
          <div style={{ fontSize: 13.5, color: '#8a857a' }}>Ei tulevia ryhmätreenejä kalenterissa.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {upcoming.map((t) => {
              const entry = (t.absences || []).find((a) => a.studentId === student.id);
              return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 14 }}>
                <span style={{ minWidth: 74, fontWeight: 700, color: 'var(--green-deep)' }}>{window.koutsiFmtShortDate(t.date)}</span>
                <span style={{ color: '#111' }}>klo {t.time}</span>
                <span style={{ color: '#8a857a', flex: 1 }}>· {t.type}</span>
                <window.KoutsiAttendanceBadge entry={entry} compact onClick={() => onEditAttendance(t.id)} />
                {entry?.note && <div style={{ width: '100%', paddingLeft: 84, color: '#6b665c', fontSize: 12.5, lineHeight: 1.4 }}>{entry.note}</div>}
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ padding: '15px 20px 17px' }}>
        <GroupCardLabel>{`Ryhmäläiset (${members.length})`}</GroupCardLabel>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {members.map((m, i) => {
            const isMe = m.id === student.id;
            return (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px',
                borderTop: i === 0 ? 'none' : '1px solid rgba(216,212,202,0.6)',
                background: isMe ? 'rgba(207,228,20,0.14)' : 'transparent',
                borderRadius: isMe ? 12 : 0,
                marginTop: isMe && i > 0 ? -1 : 0,
              }}>
                <Avatar src={m.avatarUrl} initial={m.initial} hue={m.hue} size={38} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5, color: '#111' }}>{m.name}{isMe ? ' (sinä)' : ''}</span>
                    <LevelChip level={m.level} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GroupView({ student, state, hasCoach, onJoined, onEditAttendance }) {
  const groups = window.koutsiGroupsForStudent(state, student.id);
  // Molemmat tyhjät tilanteet päätyvät samaan korttiin: pelkkä "et ole ryhmässä" oli
  // umpikuja, vaikka koodi taskussa on juuri se, mikä sen ratkaisee.
  if (groups.length === 0) {
    return (
      <div>
        <PageHeader title="Ryhmä" sub="Liity valmentajasi ryhmään koodilla" />
        <div className="k-card" style={{ padding: '22px 24px' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#111', marginBottom: 6 }}>
            {hasCoach ? 'Et ole vielä valmennusryhmässä' : 'Liity valmentajan ryhmään koodilla'}
          </div>
          <p style={{ fontSize: 13.5, color: '#8a857a', lineHeight: 1.55, marginBottom: 16 }}>
            {hasCoach
              ? 'Valmentajasi ei ole vielä lisännyt sinua ryhmään. Jos sait liittymiskoodin, voit syöttää sen tässä.'
              : 'Saat liittymiskoodin valmentajaltasi. Sen jälkeen näet täällä ryhmäsi, aikataulun ja ryhmäläiset — ja loput Koutsista täyttyy treeneillä, läksyillä ja palautteilla.'}
          </p>
          <JoinCodeForm onJoined={onJoined} />
        </div>
      </div>
    );
  }
  return (
    <div>
      <PageHeader title="Ryhmä" sub={groups.length === 1 ? 'Ryhmäsi, teema ja ryhmäläiset' : `Olet ${groups.length} ryhmässä — jokainen omalla kortillaan`} />
      {groups.map((g) => <GroupCard key={g.id} group={g} state={state} student={student} onEditAttendance={onEditAttendance} />)}
    </div>
  );
}

// ── kalenteri (pelaajan omat treenit) ────────────────────
// Coach individual = lime, coach group = green, player's own logged practice = blue
// (matches the mood dot elsewhere), a played match = red (matches the Kehitys timeline's
// match colour), a club event stays orange.
function koutsiCalDotColor(t) {
  if (t.loggedBy === 'player') return '#3a82d4';
  return t.groupId != null ? 'var(--green-deep)' : 'var(--lime)';
}
function PlayerCalendarGrid({ state, studentId, matchDates, viewYear, viewMonth, selectedDate, todayStr, onSelect, onPrev, onNext }) {
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
          const hasMatch = matchDates.has(ds);
          const isToday = ds === todayStr;
          const isSelected = ds === selectedDate;
          return (
            <button key={i} onClick={() => onSelect(ds)} style={{
              aspectRatio: '1', borderRadius: 10, border: isSelected ? '2px solid var(--green-deep)' : '2px solid transparent',
              background: isSelected ? 'rgba(14,59,44,0.06)' : isToday ? 'rgba(207,228,20,0.2)' : 'transparent',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit',
            }}>
              <span style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: '#111' }}>{d}</span>
              {(dayTrainings.length > 0 || dayClubEvents.length > 0 || hasMatch) && (
                <span style={{ display: 'flex', gap: 2 }}>
                  {dayTrainings.slice(0, 3).map((t, ti) => <span key={ti} style={{ width: 5, height: 5, borderRadius: '50%', background: koutsiCalDotColor(t) }} />)}
                  {hasMatch && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#a13b2f' }} />}
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
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#3a82d4' }} />Oma merkintä</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#a13b2f' }} />Ottelu</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8a857a' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c77b2e' }} />Seuran tapahtuma</span>
      </div>
    </div>
  );
}

// ── Treenit ──────────────────────────────────────────────
// Järjestys pelaajan näkökulmasta: ensin valmentajan antamat kotiläksyt (tekemättömät),
// sitten kalenteri jossa päivää klikkaamalla näkee sen päivän valmennukset, ja lopuksi
// jo tehdyt läksyt kuittauslistana. Ilman avoimia läksyjä yläosa jää kokonaan pois.
function HomeworkRow({ item, onToggle, done }) {
  return (
    <button onClick={onToggle} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
      background: 'none', border: 'none', cursor: 'pointer', padding: '12px 0', fontFamily: 'inherit',
    }}>
      <span style={{ width: 21, height: 21, borderRadius: 7, border: '1.5px solid ' + (done ? 'var(--green-deep)' : '#c5c0b5'), background: done ? 'var(--green-deep)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {done && <svg width="12" height="10" viewBox="0 0 10 8"><path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      <span style={{ fontSize: 15, color: '#111', textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.55 : 1 }}>{item.text}</span>
    </button>
  );
}

// Lets a player log their own practice — self-directed drills, physical training,
// another sport, or a tournament — for a given day, alongside whatever the coach
// schedules. "Ottelu" is a shortcut into the (more detailed) match note form rather than
// its own entry, so a played match is recorded once, not as two half-empty records.
const SELF_TRAINING_TYPES = ['Omatoiminen harjoitus', 'Fysiikka', 'Muu liikunta', 'Turnaus', 'Ottelu'];
const SELF_TRAINING_NOTE_HINTS = {
  'Omatoiminen harjoitus': 'Esim. Löin kaverin kanssa syöttöjä ja pistepeliä.',
  Fysiikka: 'Esim. Kuntosali — jalat ja keskivartalo.',
  'Muu liikunta': 'Esim. Juoksu 5 km.',
  Turnaus: 'Esim. Piirinmestaruuskisat, Lahti.',
};
function AddSelfTrainingModal({ date, onClose, onSave, onSwitchToMatch }) {
  const [type, setType] = React.useState('Omatoiminen harjoitus');
  const [time, setTime] = React.useState('12:00');
  const [durationMinutes, setDurationMinutes] = React.useState(60);
  const [endDate, setEndDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  const isMatch = type === 'Ottelu';
  const isTournament = type === 'Turnaus';
  const ready = isMatch || isTournament || (time.trim() && Number(durationMinutes) > 0);
  const submit = async () => {
    if (!ready) return;
    if (isMatch) { onSwitchToMatch(date); return; }
    setBusy(true); setError('');
    try {
      await onSave({
        date, type, notes: notes.trim(),
        time: isTournament ? '09:00' : time.trim(),
        durationMinutes: isTournament ? null : Number(durationMinutes),
        endDate: isTournament && endDate ? endDate : null,
      });
    }
    catch (err) { setError(err.message || 'Tallennus epäonnistui'); setBusy(false); }
  };
  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(440px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Lisää oma merkintä</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>{window.koutsiFmtLongDate(date)}. Kirjaa omatoiminen harjoitus, fysiikkatreeni, muu liikunta tai turnaus — se näkyy sinulle ja valmentajallesi.</p>
        {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
        <div style={label}>Mitä teit</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {SELF_TRAINING_TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)} style={{ padding: '9px 15px', borderRadius: 999, border: type === t ? 'none' : '1px solid #d8d4ca', background: type === t ? 'var(--lime)' : '#fff', color: type === t ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{t}</button>
          ))}
        </div>
        {isMatch ? (
          <div style={{ padding: '12px 14px', borderRadius: 12, background: '#f7f5ef', color: '#6b665c', fontSize: 13, lineHeight: 1.5, marginBottom: 4 }}>
            Ottelut kirjataan ottelumuistiinpanoon — sinne merkitset myös tuloksen ja vastustajan.
          </div>
        ) : isTournament ? (
          <React.Fragment>
            <div style={label}>Päättyy (valinnainen, useampipäiväinen turnaus)</div>
            <input type="date" min={date} value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
            <div style={label}>Kuvaus (valinnainen)</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={SELF_TRAINING_NOTE_HINTS[type] || ''}
              style={{ ...inputStyle, resize: 'none', marginBottom: 4 }} />
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={label}>Kellonaika</div>
                <window.KoutsiTimeSelect value={time} onChange={(v) => setTime(window.koutsiRoundTimeToQuarterHour(v))} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={label}>Kesto (min)</div>
                <input type="number" inputMode="numeric" min={15} max={480} step={15} value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                  onBlur={() => setDurationMinutes((d) => window.koutsiRoundToQuarterHourMinutes(d))}
                  style={inputStyle} />
              </div>
            </div>
            <div style={label}>Kuvaus (valinnainen)</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={SELF_TRAINING_NOTE_HINTS[type] || ''}
              style={{ ...inputStyle, resize: 'none', marginBottom: 4 }} />
          </React.Fragment>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} disabled={!ready || busy} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: (ready && !busy) ? 1 : 0.45, cursor: (ready && !busy) ? 'pointer' : 'default' }}>
            {isMatch ? 'Jatka ottelutietoihin' : (busy ? 'Tallennetaan…' : 'Tallenna')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Strava-style month overview: how much the player actually did this month, broken down
// by who logged it. Pulled from koutsiMonthlySummary, which only counts sessions that
// have already happened — a month still in progress should not look busier than it is.
function MonthSummaryCard({ summary, monthLabel }) {
  const active = summary.categories.filter((c) => c.count > 0);
  if (summary.totalSessions === 0) {
    return (
      <div className="k-card" style={{ padding: '16px 18px', marginBottom: 20, color: '#8a857a', fontSize: 13.5, lineHeight: 1.5 }}>
        Ei vielä merkintöjä kuussa {monthLabel.toLowerCase()}. Lisää treenejä, fysiikkaa tai otteluita kalenteriin.
      </div>
    );
  }
  return (
    <div className="k-card" style={{ padding: '18px 20px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>{monthLabel}</div>
        <div style={{ fontSize: 12.5, color: '#8a857a' }}>{summary.totalSessions} suoritusta{summary.totalMinutes ? ` · ${window.koutsiFmtDuration(summary.totalMinutes)}` : ''}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {active.map((c) => (
          <div key={c.key} style={{ padding: '10px 12px', borderRadius: 12, background: '#f7f5ef' }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#111', lineHeight: 1.1 }}>{c.count}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8a857a', marginTop: 3 }}>{c.label}</div>
            {c.minutes > 0 && <div style={{ fontSize: 11, color: '#a8a294', marginTop: 1 }}>{window.koutsiFmtDuration(c.minutes)}</div>}
          </div>
        ))}
      </div>
      {(summary.matchWins > 0 || summary.matchLosses > 0) && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#6b665c' }}>Ottelut: {summary.matchWins} voittoa, {summary.matchLosses} tappiota</div>
      )}
    </div>
  );
}

function TrainingsView({ student, state, hasCoach, note, setNote, noteSaved, onSaveNote, onToggleHomework, onEditAttendance, onAddSelfTraining, onDeleteSelfTraining, onSwitchToMatch }) {
  const todayStr = window.koutsiTodayStr();
  const todayDate = window.koutsiDateFromStr(todayStr);
  const [viewYear, setViewYear] = React.useState(todayDate.getFullYear());
  const [viewMonth, setViewMonth] = React.useState(todayDate.getMonth());
  const [selectedDate, setSelectedDate] = React.useState(todayStr);
  const [addOpen, setAddOpen] = React.useState(false);
  const prevMonth = () => { if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); } else setViewMonth((m) => m + 1); };
  const trainingsOnSelected = window.koutsiTrainingsOnDateForStudent(state, selectedDate, student.id);
  const clubEventsOnSelected = window.koutsiClubEventsOnDate(state, selectedDate);
  const matchesOnSelected = (student.matchNotes || []).filter((n) => n.date === selectedDate);
  const matchDates = React.useMemo(() => new Set((student.matchNotes || []).map((n) => n.date)), [student.matchNotes]);
  const monthSummary = React.useMemo(() => window.koutsiMonthlySummary(state, student.id, viewYear, viewMonth), [state, student.id, viewYear, viewMonth]);
  const homework = student.homework || [];
  const openHomework = homework.map((h, i) => ({ h, i })).filter((x) => !x.h.done);
  const doneHomework = homework.map((h, i) => ({ h, i })).filter((x) => x.h.done);

  return (
    <div>
      <PageHeader title="Treenit" sub="Kotiläksyt ja kalenteri" />

      {openHomework.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <SectionTitle>{`Kotiläksyt (${openHomework.length})`}</SectionTitle>
          <div className="k-card" style={{ padding: '8px 18px', borderColor: 'rgba(14,59,44,0.18)', boxShadow: '0 10px 24px -20px rgba(20,15,5,0.5)' }}>
            {openHomework.map(({ h, i }, n) => (
              <div key={i} style={{ borderBottom: n === openHomework.length - 1 ? 'none' : '1px solid var(--line)' }}>
                <HomeworkRow item={h} done={false} onToggle={() => onToggleHomework(i)} />
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 8 }}>Merkitse tehdyksi, kun olet hoitanut läksyn — valmentaja näkee kuittauksen.</div>
        </div>
      )}

      <div className="kv-calendar-layout" style={{ marginBottom: 20 }}>
        <PlayerCalendarGrid state={state} studentId={student.id} matchDates={matchDates} viewYear={viewYear} viewMonth={viewMonth} selectedDate={selectedDate} todayStr={todayStr}
          onSelect={setSelectedDate} onPrev={prevMonth} onNext={nextMonth} />

        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <SectionTitle>{window.koutsiFmtLongDate(selectedDate)}</SectionTitle>
            {hasCoach && <button onClick={() => setAddOpen(true)} className="btn-outline btn-sm" style={{ marginBottom: 12 }}>+ Lisää</button>}
          </div>
          {clubEventsOnSelected.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {clubEventsOnSelected.map((e) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', borderRadius: 14, background: 'rgba(199,123,46,0.1)', border: '1px solid rgba(199,123,46,0.3)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#c77b2e', flexShrink: 0 }} />
                  <span>
                    <span style={{ display: 'block', fontSize: 13.5, color: '#7a4c1e', fontWeight: 700 }}>{e.title}</span>
                    {e.endDate && e.endDate !== e.date && (
                      <span style={{ display: 'block', fontSize: 11.5, color: '#9a6a30', marginTop: 2 }}>{window.koutsiFmtShortDate(e.date)}–{window.koutsiFmtShortDate(e.endDate)}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {matchesOnSelected.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {matchesOnSelected.map((n) => (
                <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 15px', borderRadius: 14, background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#a13b2f', flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, color: '#7a2c22', fontWeight: 700 }}>
                    Ottelu: {n.format === 'nelinpeli' && n.opponent2Name ? `${n.opponentName} & ${n.opponent2Name}` : n.opponentName}{n.result ? ` — ${n.result === 'voitto' ? 'Voitto' : 'Tappio'}` : ''}{n.score ? ` (${n.score})` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          {trainingsOnSelected.length === 0 ? (
            clubEventsOnSelected.length === 0 && matchesOnSelected.length === 0 && (
              <div className="k-card" style={{ padding: 18, color: '#8a857a', fontSize: 14 }}>
                Ei valmennuksia tänä päivänä. Valitse kalenterista päivä, jossa on merkintä.
              </div>
            )
          ) : (
            <div className="k-card" style={{ padding: 0, overflow: 'hidden' }}>
              {trainingsOnSelected.map((t, i) => {
                const party = window.koutsiTrainingParty(state, t);
                const coach = window.koutsiCoachById(state, t.coachId);
                const label = party.kind === 'group' && party.group ? party.group.name : t.type;
                const entry = (t.absences || []).find((a) => a.studentId === student.id);
                const isSelf = t.loggedBy === 'player';
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '14px 18px', borderBottom: i === trainingsOnSelected.length - 1 ? 'none' : '1px solid var(--line)' }}>
                    <div style={{ width: 52, fontSize: 13.5, fontWeight: 800, color: 'var(--green-deep)', flexShrink: 0 }}>{t.time}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, color: '#111' }}>{t.type}{party.kind === 'group' ? ` — ${label}` : ''}{isSelf ? ' · Oma merkintä' : ''}</div>
                      {coach && !isSelf && <div style={{ fontSize: 12, color: '#8a857a', marginTop: 1 }}>{coach.name}</div>}
                      {isSelf && t.durationMinutes && <div style={{ fontSize: 12, color: '#8a857a', marginTop: 1 }}>{window.koutsiFmtDuration(t.durationMinutes)}</div>}
                      {isSelf && t.endDate && t.endDate !== t.date && <div style={{ fontSize: 12, color: '#8a857a', marginTop: 1 }}>{window.koutsiFmtShortDate(t.date)}–{window.koutsiFmtShortDate(t.endDate)}</div>}
                    </div>
                    {isSelf
                      ? <window.KoutsiRowActions onDelete={() => onDeleteSelfTraining(t)} deleteLabel="Poista merkintä" />
                      : <window.KoutsiAttendanceBadge entry={entry} onClick={() => onEditAttendance(t.id)} />}
                    {entry?.note && <div style={{ width: '100%', paddingLeft: 66, color: '#6b665c', fontSize: 12.5, lineHeight: 1.45 }}>{entry.note}</div>}
                    {isSelf && t.notes && <div style={{ width: '100%', paddingLeft: 66, color: '#6b665c', fontSize: 12.5, lineHeight: 1.45 }}>{t.notes}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <MonthSummaryCard summary={monthSummary} monthLabel={`${window.KOUTSI_MONTHS[viewMonth]} ${viewYear}`} />

      {doneHomework.length > 0 && (
        <div style={{ marginBottom: 26 }}>
          <SectionTitle>{`Tehdyt kotiläksyt (${doneHomework.length})`}</SectionTitle>
          <div className="k-card" style={{ padding: '8px 18px', background: '#faf9f5' }}>
            {doneHomework.map(({ h, i }, n) => (
              <div key={i} style={{ borderBottom: n === doneHomework.length - 1 ? 'none' : '1px solid var(--line)' }}>
                <HomeworkRow item={h} done onToggle={() => onToggleHomework(i)} />
              </div>
            ))}
          </div>
        </div>
      )}

      {hasCoach && (
        <div>
          <SectionTitle>Kommentti valmentajalle</SectionTitle>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Miten treenit sujuivat tällä viikolla? Kirjoita oma kommenttisi valmentajalle…" rows={3}
            style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', borderRadius: 14, padding: '13px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', resize: 'none', background: '#fff', marginBottom: 10 }} />
          <button onClick={onSaveNote} className="btn-dark btn-sm">{noteSaved ? 'Tallennettu ✓' : 'Lähetä kommentti valmentajalle'}</button>
        </div>
      )}

      {addOpen && (
        <AddSelfTrainingModal
          date={selectedDate}
          onClose={() => setAddOpen(false)}
          onSave={async (payload) => { await onAddSelfTraining(payload); setAddOpen(false); }}
          onSwitchToMatch={(date) => { setAddOpen(false); onSwitchToMatch(date); }}
        />
      )}
    </div>
  );
}

// ── Harjoitteet ──────────────────────────────────────────
// A player's own saved video links live in the same koutsi_videos table their coach's
// shares already use — this just gives them a filterable bank of their own, parallel to
// the coach's harjoitepankki below, instead of only surfacing on the Kehitys timeline.
function MyVideoBank({ student, onAddVideo, onOpenVideo, onDeleteVideo }) {
  const [tag, setTag] = React.useState('kaikki');
  const myVideos = (student.videos || []).filter((v) => v.addedBy === 'player');
  const filtered = tag === 'kaikki' ? myVideos : myVideos.filter((v) => (v.tags || []).includes(tag));
  return (
    <div style={{ marginBottom: 34 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <SectionTitle>{`Omat videot (${myVideos.length})`}</SectionTitle>
        <button onClick={onAddVideo} className="btn-dark btn-sm">+ Lisää oma video</button>
      </div>
      <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.5, marginBottom: 14 }}>
        Tallenna tänne hyviä tennisvideoita, tekniikkaklippejä tai muita linkkejä — löydät ne täältä helposti myöhemmin.
      </p>
      {myVideos.length === 0 ? (
        <div className="k-card" style={{ padding: 18, color: '#8a857a', fontSize: 14 }}>Et ole vielä lisännyt omia videoita.</div>
      ) : (
        <React.Fragment>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {EXERCISE_TAGS.map((t) => (
              <button key={t} onClick={() => setTag(t)} style={{ padding: '8px 14px', borderRadius: 999, border: tag === t ? 'none' : '1px solid var(--line)', background: tag === t ? 'var(--lime)' : '#fff', color: tag === t ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}>{TAG_LABELS[t]}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((v) => (
              <div key={v.id} className="k-card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => onOpenVideo(v)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', fontFamily: 'inherit' }}>
                  <span style={{ width: 46, height: 36, borderRadius: 9, flexShrink: 0, position: 'relative', background: `radial-gradient(120% 120% at 30% 20%, hsl(${v.hue} 55% 45%), hsl(${v.hue + 24} 60% 22%))` }}>
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="11" height="13" viewBox="0 0 12 14"><path d="M1 1v12l10-6L1 1z" fill="rgba(255,255,255,0.92)" /></svg>
                    </span>
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: '#111', fontWeight: 700, fontSize: 14.5 }}>{v.title}</div>
                    <div style={{ color: '#8a857a', fontSize: 12, marginTop: 2 }}>
                      {window.koutsiFmtShortDate(v.date)}{(v.tags || []).length > 0 ? ` · ${v.tags.map((t) => window.KOUTSI_TAG_LABELS[t] || t).join(', ')}` : ''}
                    </div>
                  </div>
                </button>
                <window.KoutsiRowActions onDelete={() => onDeleteVideo(v)} deleteLabel="Poista video" />
              </div>
            ))}
            {filtered.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei videoita tällä aiheella.</div>}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

function ExercisesView({ exercises, hasCoach, onOpen, student, onAddVideo, onDeleteVideo }) {
  const [activeTag, setActiveTag] = React.useState('kaikki');
  const [activeCount, setActiveCount] = React.useState('kaikki');
  const [playing, setPlaying] = React.useState(null);
  const filtered = exercises
    .filter((e) => activeTag === 'kaikki' || e.tags.includes(activeTag))
    .filter((e) => activeCount === 'kaikki' || (activeCount === 4 ? e.playerCount >= 4 : e.playerCount === activeCount));
  return (
    <div>
      <PageHeader title="Harjoitteet" sub="Omat videot ja valmentajan harjoitepankki" />
      {playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}

      <MyVideoBank student={student} onAddVideo={onAddVideo} onOpenVideo={setPlaying} onDeleteVideo={onDeleteVideo} />

      <SectionTitle>{`Valmentajan harjoitepankki (${exercises.length})`}</SectionTitle>
      {exercises.length === 0 ? (
        <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5, lineHeight: 1.55 }}>
          {hasCoach ? 'Valmentajasi ei ole vielä jakanut harjoitteita.' : 'Harjoitepankki tulee näkyviin, kun liityt valmentajan ryhmään koodilla.'}
        </div>
      ) : (
        <React.Fragment>
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
        </React.Fragment>
      )}
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
  const [hidden, setHidden] = React.useState(false);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(420px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>Miltä treeni tuntui?</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Merkitse fiiliksesi treenin jälkeen. Oletuksena valmentajasi näkee tämän — voit halutessasi pitää sen omana tietonasi.</p>
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
          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', resize: 'none', marginBottom: 14, background: '#fff' }} />
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: 'var(--green-deep)', flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: '#3c382f', lineHeight: 1.45 }}>Älä näytä tätä valmentajalle — vain omaan seurantaani</span>
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={() => score && onSave({ score, note: note.trim(), hiddenFromCoach: hidden })} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: score ? 1 : 0.45, cursor: score ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

const MATCH_RESULT_OPTIONS = [['voitto', 'Voitto'], ['tappio', 'Tappio']];
const MATCH_FORMAT_OPTIONS = [['kaksinpeli', 'Kaksinpeli'], ['nelinpeli', 'Nelinpeli']];
function MatchNoteModal({ editing, defaultDate, onClose, onSave }) {
  const [opponentName, setOpponentName] = React.useState(() => (editing ? editing.opponentName : ''));
  const [opponent2Name, setOpponent2Name] = React.useState(() => (editing ? editing.opponent2Name || '' : ''));
  const [partnerName, setPartnerName] = React.useState(() => (editing ? editing.partnerName || '' : ''));
  const [date, setDate] = React.useState(() => (editing ? editing.date : (defaultDate || window.koutsiTodayStr())));
  const [result, setResult] = React.useState(() => (editing ? editing.result || '' : ''));
  const [format, setFormat] = React.useState(() => (editing ? editing.format || '' : ''));
  const [durationMinutes, setDurationMinutes] = React.useState(() => (editing ? editing.durationMinutes || '' : ''));
  const [score, setScore] = React.useState(() => (editing ? editing.score || '' : ''));
  const [note, setNote] = React.useState(() => (editing ? editing.note || '' : ''));
  const isDoubles = format === 'nelinpeli';
  const ready = opponentName.trim() && date;
  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  const Pill = ({ on, children, onClick }) => (
    <button onClick={onClick} style={{ padding: '9px 15px', borderRadius: 999, border: on ? 'none' : '1px solid #d8d4ca', background: on ? 'var(--lime)' : '#fff', color: on ? '#101a08' : '#3c382f', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>{children}</button>
  );
  const submit = () => ready && onSave({
    opponentName: opponentName.trim(), date, note: note.trim(),
    result: result || null, format: format || null,
    durationMinutes: durationMinutes === '' ? null : Number(durationMinutes),
    score: score.trim(),
    partnerName: isDoubles ? partnerName.trim() : '',
    opponent2Name: isDoubles ? opponent2Name.trim() : '',
  });
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(440px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>{editing ? 'Muokkaa ottelumuistiinpanoa' : 'Ottelumuistiinpano'}</h3>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Kirjaa tulos ja taktiikkasi — löydät nämä helposti uudestaan, jos sama vastustaja tulee vastaan.</p>
        <div style={label}>Päivämäärä</div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={label}>Tulos</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {MATCH_RESULT_OPTIONS.map(([key, l]) => <Pill key={key} on={result === key} onClick={() => setResult(result === key ? '' : key)}>{l}</Pill>)}
        </div>
        <div style={label}>Pelimuoto</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {MATCH_FORMAT_OPTIONS.map(([key, l]) => <Pill key={key} on={format === key} onClick={() => setFormat(format === key ? '' : key)}>{l}</Pill>)}
        </div>
        {isDoubles && (
          <React.Fragment>
            <div style={label}>Oma pari (valinnainen)</div>
            <input value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="Esim. Liisa Lahtinen" style={{ ...inputStyle, marginBottom: 16 }} />
          </React.Fragment>
        )}
        <div style={label}>{isDoubles ? 'Vastustaja 1' : 'Vastustaja'}</div>
        <input value={opponentName} onChange={(e) => setOpponentName(e.target.value)} placeholder="Esim. Matti Meikäläinen" style={{ ...inputStyle, marginBottom: 16 }} />
        {isDoubles && (
          <React.Fragment>
            <div style={label}>Vastustaja 2 (valinnainen)</div>
            <input value={opponent2Name} onChange={(e) => setOpponent2Name(e.target.value)} placeholder="Esim. Jussi Jokinen" style={{ ...inputStyle, marginBottom: 16 }} />
          </React.Fragment>
        )}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={label}>Erien tulos</div>
            <input value={score} onChange={(e) => setScore(e.target.value)} placeholder="Esim. 6-4 6-3" style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={label}>Kesto (min)</div>
            <input type="number" inputMode="numeric" min={1} max={300} value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value === '' ? '' : Number(e.target.value))} style={inputStyle} />
          </div>
        </div>
        <div style={label}>Muistiinpano</div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={5} placeholder="Oliko taktiikkaa etukäteen? Piti/muuttuiko se? Mitä huomasit vastustajan syötöstä, lyönneistä, pelistä?"
          style={{ ...inputStyle, resize: 'none', marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={submit} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: ready ? 1 : 0.45, cursor: ready ? 'pointer' : 'default' }}>Tallenna</button>
        </div>
      </div>
    </div>
  );
}

// Kehitys is one timeline, not a stack of little lists: every goal edit, coach note,
// homework item, mood, match note, video and past training lands in the same stream —
// see koutsi-timeline.jsx for the builder and the month/filter/search shell. Entries the
// player owns keep their edit/delete controls, now hung off the timeline card itself.
function ProgressView({ student, state, hasCoach, onAddVideo, onAddMood, onAddMatchNote, onDeleteMood, onToggleMoodHidden, onEditMatchNote, onDeleteMatchNote, onDeleteVideo }) {
  const [playing, setPlaying] = React.useState(null);
  const trainings = React.useMemo(() => window.koutsiTrainingsForStudent(state, student.id).map((t) => ({
    ...t, groupName: t.groupId != null ? (window.koutsiGroupById(state, t.groupId)?.name || '') : '',
  })), [state, student.id]);

  const rowActions = (event) => {
    if (event.kind === 'mood') return (
      <React.Fragment>
        <button onClick={() => onToggleMoodHidden(event.source)} className="btn-outline btn-sm"
          title={event.source.hiddenFromCoach ? 'Näytä tämä fiilis valmentajalle' : 'Piilota tämä fiilis valmentajalta'}
          style={{ padding: '3px 9px', fontSize: 11.5 }}>
          {event.source.hiddenFromCoach ? 'Näytä valmentajalle' : 'Piilota'}
        </button>
        <window.KoutsiRowActions onDelete={() => onDeleteMood(event.source)} deleteLabel="Poista fiilis" />
      </React.Fragment>
    );
    if (event.kind === 'match') return <window.KoutsiRowActions onEdit={() => onEditMatchNote(event.source)} onDelete={() => onDeleteMatchNote(event.source)} />;
    // The coach's own uploads are not the player's to delete.
    if (event.kind === 'video' && event.source.addedBy === 'player') return <window.KoutsiRowActions onDelete={() => onDeleteVideo(event.source)} deleteLabel="Poista video" />;
    return null;
  };

  return (
    <div>
      <PageHeader title="Kehitys" sub={hasCoach
        ? 'Koko historiasi yhtenä aikajanana — tavoitteet, valmentajan huomiot, treenit, fiilikset, videot ja ottelut.'
        : 'Koko historiasi yhtenä aikajanana. Valmentajan huomiot ilmestyvät tänne, kun liityt ryhmään.'} />
      {playing && <VideoPlayerModal video={playing} onClose={() => setPlaying(null)} />}
      <window.KoutsiTimeline
        student={student}
        trainings={trainings}
        clubEvents={state.clubEvents}
        onOpenVideo={setPlaying}
        renderActions={rowActions}
        actions={(
          <React.Fragment>
            <button onClick={onAddMood} className="btn-outline btn-sm">+ Fiilis</button>
            <button onClick={onAddMatchNote} className="btn-outline btn-sm">+ Ottelumuistiinpano</button>
            <button onClick={onAddVideo} className="btn-outline btn-sm">+ Video</button>
          </React.Fragment>
        )}
      />
    </div>
  );
}

// ── Profiili ─────────────────────────────────────────────
// Same self-serve export as the coach side, so an access request is a button rather than
// an email thread — the privacy policy promises the right either way.
function DataExportButton({ userId, name }) {
  const toast = window.useKoutsiToast();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    setBusy(true);
    await toast.run(async () => {
      const payload = await window.koutsiExportMyData(userId, 'player');
      const safe = (name || 'koutsi').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      window.koutsiDownloadJson(payload, `koutsi-tiedot-${safe}-${window.koutsiTodayStr()}.json`);
    }, 'Tiedot ladattu.');
    setBusy(false);
  };
  return (
    <button onClick={run} disabled={busy} className="btn-outline btn-sm" style={{ opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Kootaan…' : 'Lataa omat tietoni (JSON)'}
    </button>
  );
}

// Pelaaja omistaa nimensä, kuvansa ja ikänsä. Tason asettaa valmentaja. Pilotissa
// taustatietokenttä ei ole käytössä, koska se pyysi aiemmin terveystietoja.
function PlayerProfileEditModal({ student, onClose, onSaved }) {
  const toast = window.useKoutsiToast();
  const [name, setName] = React.useState(student.name || '');
  const [age, setAge] = React.useState(student.age == null ? '' : String(student.age));
  const [busy, setBusy] = React.useState(false);

  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 14.5, fontFamily: 'inherit', color: '#111', background: '#fff' };
  const label = { fontSize: 12, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 9 };
  const exactAge = /^\d+$/.test(age) ? age : '';
  const parsedAge = exactAge ? Number(exactAge) : null;
  const ageValid = !age || (Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge < 120);
  const ready = name.trim() && ageValid;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const ok = await toast.run(async () => {
      if (name.trim() !== student.name) await window.koutsiSaveDisplayName(student.id, name.trim());
      await window.koutsiSaveStudentProfile(student.id, { age: parsedAge, profileAge: age || null });
    }, 'Profiili tallennettu.');
    setBusy(false);
    if (ok) { await onSaved(); onClose(); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(480px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 19, fontWeight: 800, marginBottom: 18 }}>Muokkaa profiilia</h3>

        <div style={label}>Nimi</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 9 }}>
          <div style={{ ...label, marginBottom: 0 }}>Ikä (valinnainen)</div>
          {age && <button type="button" onClick={() => setAge('')} style={{ border: 'none', background: 'none', padding: 0, color: '#8a857a', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>Tyhjennä</button>}
        </div>
        <input value={exactAge} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" placeholder="Tai tarkka ikä, esim. 24"
          style={{ ...inputStyle, marginBottom: ageValid ? 16 : 6, borderColor: ageValid ? '#d8d4ca' : '#c2543f' }} />
        {!ageValid && <div style={{ fontSize: 12, color: '#c2543f', marginBottom: 16 }}>Iän pitää olla väliltä 1–119 vuotta.</div>}
        <div style={{ padding: '11px 13px', marginBottom: 20, borderRadius: 12, background: '#f7f5ef', color: '#6b665c', fontSize: 12.5, lineHeight: 1.5 }}>
          Älä kirjoita Koutsiin vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button onClick={save} disabled={busy || !ready} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: (busy || !ready) ? 0.45 : 1 }}>{busy ? 'Tallennetaan…' : 'Tallenna'}</button>
        </div>
      </div>
    </div>
  );
}

function ProfileRow({ label, value, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 14, padding: '11px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 13, color: '#8a857a', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14.5, color: value ? '#111' : '#a8a297', fontWeight: value ? 600 : 400, textAlign: 'right' }}>
        {value || hint || '—'}
      </span>
    </div>
  );
}

function ProfileView({ student, group, state, onSignOut, onReload }) {
  const [editOpen, setEditOpen] = React.useState(false);
  const coaches = (state && state.coaches) || [];
  return (
    <div>
      <PageHeader title="Profiili" action={<button onClick={() => setEditOpen(true)} className="btn-dark btn-sm">Muokkaa profiilia</button>} />
      <IdentityBlock student={student} group={group} />

      <SectionTitle>Omat tiedot</SectionTitle>
      <div className="k-card" style={{ padding: '4px 18px 14px', marginBottom: 26 }}>
        <ProfileRow label="Nimi" value={student.name} />
        <ProfileRow label="Ikä" value={playerAgeLabel(student)} hint="Ei asetettu" />
        <ProfileRow label="Taso" value={student.level} hint="Valmentaja asettaa" />
        <ProfileRow label="Ryhmä" value={group ? `${group.name} · ${group.day} klo ${group.time}` : ''} hint="Ei ryhmää" />
        <ProfileRow label="Valmentaja" value={coaches.map((c) => c.name).join(', ')} hint="Ei valmentajaa" />
        <div style={{ paddingTop: 12, color: '#8a857a', fontSize: 12.5, lineHeight: 1.5 }}>
          Beta-pilotissa terveystietoja ei tallenneta Koutsiin.
        </div>
      </div>

      <SectionTitle>Ilmoitukset</SectionTitle>
      <window.KoutsiEmailPrefToggle userId={student.id} />

      <div style={{ marginTop: 26 }}>
        <SectionTitle>Toiminnot</SectionTitle>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a href="https://koutsi.krossi.app" className="btn-outline btn-sm">← Etusivulle</a>
          <button onClick={onSignOut} className="btn-outline btn-sm">Kirjaudu ulos</button>
        </div>
      </div>

      <div style={{ marginTop: 26 }}>
        <SectionTitle>Tili ja tiedot</SectionTitle>
        <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.55, marginBottom: 10 }}>
          Voit ladata kaikki tietosi yhtenä tiedostona. Tilin poisto tyhjentää pysyvästi profiilisi,
          tavoitteesi, fiiliksesi, ottelumuistiinpanosi ja videosi — valmentajasi ei näe sinua enää sen jälkeen.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <DataExportButton userId={student.id} name={student.name} />
          <window.KoutsiDeleteAccountButton profileName={student.name} />
        </div>
        <window.KoutsiLegalLinks style={{ marginTop: 16 }} />
      </div>

      {editOpen && <PlayerProfileEditModal student={student} onClose={() => setEditOpen(false)} onSaved={onReload} />}
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
// Each view's own address: /pelaaja/treenit and so on. Module level on purpose —
// useKoutsiTabRoute needs this object to keep its identity between renders.
const PLAYER_TAB_SLUGS = {
  home: 'koti',
  group: 'ryhma',
  trainings: 'treenit',
  exercises: 'harjoitteet',
  progress: 'kehitys',
  profile: 'profiili',
};
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
  const isDemo = Boolean(window.KOUTSI_DEMO_ROLE);
  const homeHref = isDemo ? 'https://demo.koutsi.krossi.app' : 'https://koutsi.krossi.app';
  return (
    <div style={{ width: 248, flexShrink: 0, background: 'var(--green-deep)', color: '#fff', display: 'flex', flexDirection: 'column', padding: '26px 18px', position: 'fixed', top: 0, left: 0, bottom: 0, overflowY: 'auto' }}>
      <a href={homeHref} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, textDecoration: 'none', paddingLeft: 6 }}>
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
          <Avatar src={student.avatarUrl} initial={student.initial} hue={student.hue} size={34} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{student.name}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>Pelaaja</div>
          </div>
          <window.KoutsiNotificationBell userId={student.id} dark />
        </div>
        <button
          onClick={onSignOut}
          className={isDemo ? 'btn-lime' : 'btn-ghost btn-sm'}
          style={isDemo
            ? { width: '100%', padding: '12px 18px', fontSize: 14 }
            : { justifyContent: 'flex-start', gap: 8 }}>
          {isDemo ? 'Luo tili' : 'Kirjaudu ulos'}
        </button>
        {!isDemo && <a href="https://koutsi.krossi.app" className="btn-ghost btn-sm" style={{ justifyContent: 'flex-start', gap: 8 }}>← Etusivulle</a>}
      </div>
    </div>
  );
}

function MobileTopBar({ student, onProfile, onSignOut }) {
  const isDemo = Boolean(window.KOUTSI_DEMO_ROLE);
  const homeHref = isDemo ? 'https://demo.koutsi.krossi.app' : 'https://koutsi.krossi.app';
  return (
    <div className="kv-mobile-topbar" style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 96, zIndex: 45, alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px 10px', background: 'var(--green-deep)', borderBottom: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 10px 28px -22px rgba(0,0,0,0.65)', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 7, minWidth: 0 }}>
        <a href={homeHref} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, textDecoration: 'none', flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 21, color: 'var(--lime)', letterSpacing: -0.5 }}>Krossi</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>Koutsi</span>
        </a>
        <span style={{ padding: '4px 11px', borderRadius: 999, background: 'rgba(207,228,20,0.12)', border: '1px solid rgba(207,228,20,0.5)', color: 'var(--lime)', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, flexShrink: 0 }}>PELAAJA</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        {isDemo && (
          <button onClick={onSignOut} className="btn-lime" style={{ minHeight: 38, padding: '9px 12px', fontSize: 12.5, whiteSpace: 'nowrap' }}>
            Luo tili
          </button>
        )}
        <window.KoutsiNotificationBell userId={student.id} dark />
        <button onClick={onProfile} aria-label="Avaa profiili" title="Profiili" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, padding: 2, borderRadius: '50%', border: '2px solid var(--lime)', background: 'transparent', cursor: 'pointer' }}>
          <Avatar src={student.avatarUrl} initial={student.initial} hue={student.hue} size={32} />
        </button>
      </div>
    </div>
  );
}

function MobileBottomNav({ tab, setTab }) {
  const mobileNav = NAV.filter((item) => item.id !== 'profile');
  return (
    <div className="kv-mobile-bottomnav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, minHeight: 72, zIndex: 45, padding: '6px 5px max(6px, env(safe-area-inset-bottom))', background: 'var(--green-deep)', borderTop: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 -12px 28px -20px rgba(0,0,0,0.65)' }}>
      {mobileNav.map((n) => {
        const on = tab === n.id;
        const fs = n.label.length > 8 ? 9.5 : 10.5;
        return (
          <button key={n.id} onClick={() => setTab(n.id)} aria-current={on ? 'page' : undefined} style={{ flex: 1, minWidth: 0, margin: '0 2px', border: 'none', borderRadius: 14, background: on ? 'var(--lime)' : 'transparent', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'inherit' }}>
            <NavIcon id={n.id} on={on} offColor="rgba(255,255,255,0.72)" />
            <span style={{ fontSize: fs, fontWeight: on ? 800 : 600, color: on ? 'var(--green-deep)' : 'rgba(255,255,255,0.78)' }}>{n.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function PlayerApp({ studentId, onSignOut }) {
  const toast = window.useKoutsiToast();
  const confirm = window.useKoutsiConfirm();
  const [state, setState] = React.useState(null);
  const [tab, setTab] = window.useKoutsiTabRoute(PLAYER_TAB_SLUGS, 'home');
  const [exerciseId, setExerciseId] = React.useState(null);
  const [videoOpen, setVideoOpen] = React.useState(false);
  const [moodOpen, setMoodOpen] = React.useState(false);
  const [matchNoteOpen, setMatchNoteOpen] = React.useState(false);
  const [matchNoteDefaultDate, setMatchNoteDefaultDate] = React.useState(null);
  const [attendanceTrainingId, setAttendanceTrainingId] = React.useState(null);
  const [editingMatchNote, setEditingMatchNote] = React.useState(null);
  const [note, setNote] = React.useState('');
  const [noteSaved, setNoteSaved] = React.useState(false);
  const [wish, setWish] = React.useState('');
  const [wishSaved, setWishSaved] = React.useState(false);
  const notesInitialized = React.useRef(false);

  const [loadError, setLoadError] = React.useState(false);
  const reload = React.useCallback(async () => {
    const next = await window.koutsiLoadStudentState(studentId);
    setState(next);
  }, [studentId]);
  // Vain ensilataus voi jäädä tyhjän ruudun taakse; myöhemmät virheet raportoi toast.
  const initialLoad = React.useCallback(async () => {
    setLoadError(false);
    try { await reload(); } catch { setLoadError(true); }
  }, [reload]);

  React.useEffect(() => { initialLoad(); }, [initialLoad]);

  React.useEffect(() => {
    const tables = ['koutsi_coaches', 'koutsi_students', 'koutsi_coach_students', 'koutsi_groups', 'koutsi_group_members', 'koutsi_trainings', 'koutsi_training_absences', 'koutsi_exercises', 'koutsi_coach_events', 'koutsi_videos', 'koutsi_diary_entries', 'koutsi_homework', 'koutsi_moods', 'koutsi_match_notes', 'koutsi_player_history'];
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

  if (loadError && !state) return <window.KoutsiErrorScreen message="Tietojasi ei saatu ladattua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={initialLoad} onSignOut={onSignOut} />;
  if (!state || !student) return <window.KoutsiAuthLoadingScreen />;

  const group = window.koutsiGroupForStudent(state, student.id);
  const hasCoach = (state.coaches || []).length > 0;
  const exercise = exerciseId != null ? state.exercises.find((e) => e.id === exerciseId) : null;
  const attendanceTraining = attendanceTrainingId != null ? state.trainings.find((t) => t.id === attendanceTrainingId) : null;
  const attendanceEntry = attendanceTraining ? (attendanceTraining.absences || []).find((a) => a.studentId === student.id) : null;
  const attendanceEligibleTrainings = window.koutsiTrainingsForStudent(state, student.id);

  // Every write reports failures as Finnish toasts instead of a raw alert().
  const act = (fn, successMessage) => async (...args) => {
    await toast.run(async () => { await fn(...args); await reload(); }, successMessage);
  };

  const toggleHomework = act(async (i) => {
    const item = student.homework[i];
    await window.koutsiToggleHomeworkDone(item.id, !item.done);
  });
  const saveNote = act(async () => {
    await window.koutsiSaveNote(studentId, note.trim());
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 1800);
  });
  const saveWish = act(async () => {
    await window.koutsiSaveWish(studentId, wish.trim());
    setWishSaved(true);
    setTimeout(() => setWishSaved(false), 1800);
  });
  const saveGoal = act((goal) => window.koutsiSaveGoal(studentId, goal));
  const saveAttendance = async ({ trainingIds, status, note: attendanceNote }) => toast.run(async () => {
    await window.koutsiSetAttendance(trainingIds, studentId, status, attendanceNote);
    await reload();
  }, status === 'paikalla' ? 'Läsnäolo merkitty.' : `${window.KOUTSI_ATTENDANCE_STATUS_LABELS[status]} ilmoitettu valmentajalle.`);
  // Ei guarded: VideoModal näyttää virheen itse ja palauttaa nappinsa tilan,
  // muuten modaali jäisi jumiin "Ladataan…"-tilaan latauksen kaatuessa.
  const addVideo = async ({ shareId, title, date, tags, file, externalUrl, onProgress }) => {
    await window.koutsiShareVideo({ shareId, title, date, tags, studentIds: [studentId], addedById: studentId, file, externalUrl, onProgress });
    await reload();
    setVideoOpen(false);
    toast.success('Video tallennettu.');
  };
  const deleteVideo = async (v) => {
    const ok = await confirm({ title: 'Poista video?', body: `${v.title} poistetaan pysyvästi.`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteVideo(v.id, v.storagePath), 'Video poistettu.')();
  };

  const addMood = async ({ score, note: moodNote, hiddenFromCoach }) => {
    const ok = await toast.run(async () => { await window.koutsiAddMood(studentId, { score, note: moodNote, hiddenFromCoach }); await reload(); }, 'Fiilis tallennettu.');
    if (ok) setMoodOpen(false);
  };
  const toggleMoodHidden = (m) => toast.run(
    async () => { await window.koutsiSetMoodHidden(m.id, !m.hiddenFromCoach); await reload(); },
    m.hiddenFromCoach ? 'Fiilis näkyy nyt valmentajalle.' : 'Fiilis piilotettu valmentajalta.',
  );
  const deleteMood = async (m) => {
    const ok = await confirm({ title: 'Poista fiilis?', body: `${m.date} — ${MOOD_LABELS[m.score]}`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteMood(m.id), 'Fiilis poistettu.')();
  };

  const saveMatchNote = async ({ opponentName, date, note: matchNote, result, format, durationMinutes, score, partnerName, opponent2Name }) => {
    const ok = await toast.run(async () => {
      const payload = { opponentName, date, note: matchNote, result, format, durationMinutes, score, partnerName, opponent2Name };
      if (editingMatchNote) await window.koutsiUpdateMatchNote(editingMatchNote.id, payload);
      else await window.koutsiAddMatchNote(studentId, payload);
      await reload();
    }, editingMatchNote ? 'Muistiinpano päivitetty.' : 'Muistiinpano tallennettu.');
    if (ok) { setMatchNoteOpen(false); setEditingMatchNote(null); }
  };
  const deleteMatchNote = async (n) => {
    const ok = await confirm({ title: 'Poista ottelumuistiinpano?', body: `Vastustaja ${n.opponentName}`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteMatchNote(n.id), 'Muistiinpano poistettu.')();
  };

  // Ei guarded: AddSelfTrainingModal näyttää virheen itse (sama malli kuin videon lisäys).
  const addSelfTraining = async (payload) => {
    const coachId = (state.coaches[0] || {}).id;
    await window.koutsiAddSelfTraining({ studentId, coachId, ...payload });
    await reload();
  };
  const deleteSelfTraining = async (t) => {
    const ok = await confirm({ title: 'Poista merkintä?', body: `${t.type} — ${window.koutsiFmtShortDate(t.date)}`, confirmLabel: 'Poista', danger: true });
    if (ok) await act(() => window.koutsiDeleteSelfTraining(t.id), 'Merkintä poistettu.')();
  };
  const openMatchNoteForDate = (date) => { setEditingMatchNote(null); setMatchNoteDefaultDate(date); setMatchNoteOpen(true); };

  return (
    <div style={{ minHeight: '100vh' }}>
      <div className="kv-sidebar-wrap">
        <Sidebar tab={tab} setTab={setTab} student={student} onSignOut={onSignOut} />
      </div>
      <MobileTopBar student={student} onProfile={() => setTab('profile')} onSignOut={onSignOut} />
      <div className="kv-main">
        <div key={tab} className="k-rise-in" style={{ maxWidth: 640, margin: '0 auto' }}>
          {tab === 'home' && <HomeView student={student} state={state} group={group} hasCoach={hasCoach} onSaveGoal={saveGoal} wish={wish} setWish={setWish} wishSaved={wishSaved} onSaveWish={saveWish} onToggleHomework={toggleHomework} onGoTab={setTab} />}
          {tab === 'group' && <GroupView student={student} state={state} hasCoach={hasCoach} onJoined={reload} onEditAttendance={setAttendanceTrainingId} />}
          {tab === 'trainings' && (
            <TrainingsView
              student={student} state={state} hasCoach={hasCoach} note={note} setNote={setNote} noteSaved={noteSaved}
              onSaveNote={saveNote} onToggleHomework={toggleHomework} onEditAttendance={setAttendanceTrainingId}
              onAddSelfTraining={addSelfTraining} onDeleteSelfTraining={deleteSelfTraining} onSwitchToMatch={openMatchNoteForDate} />
          )}
          {tab === 'exercises' && (
            <ExercisesView exercises={state.exercises} hasCoach={hasCoach} onOpen={setExerciseId}
              student={student} onAddVideo={() => setVideoOpen(true)} onDeleteVideo={deleteVideo} />
          )}
          {tab === 'progress' && (
            <ProgressView
              student={student} state={state} hasCoach={hasCoach}
              onAddVideo={() => setVideoOpen(true)} onAddMood={() => setMoodOpen(true)}
              onAddMatchNote={() => { setEditingMatchNote(null); setMatchNoteDefaultDate(null); setMatchNoteOpen(true); }}
              onDeleteMood={deleteMood} onToggleMoodHidden={toggleMoodHidden} onDeleteVideo={deleteVideo}
              onEditMatchNote={(n) => { setEditingMatchNote(n); setMatchNoteOpen(true); }}
              onDeleteMatchNote={deleteMatchNote} />
          )}
          {tab === 'profile' && <ProfileView student={student} group={group} state={state} onSignOut={onSignOut} onReload={reload} />}
        </div>
      </div>
      <MobileBottomNav tab={tab} setTab={setTab} />
      {exercise && <ExerciseDetail exercise={exercise} onClose={() => setExerciseId(null)} />}
      {videoOpen && <VideoModal onClose={() => setVideoOpen(false)} onSave={addVideo} />}
      {moodOpen && <MoodModal onClose={() => setMoodOpen(false)} onSave={addMood} />}
      {matchNoteOpen && (
        <MatchNoteModal editing={editingMatchNote} defaultDate={matchNoteDefaultDate}
          onClose={() => { setMatchNoteOpen(false); setEditingMatchNote(null); setMatchNoteDefaultDate(null); }} onSave={saveMatchNote} />
      )}
      {attendanceTraining && (
        <window.KoutsiAttendanceModal
          studentName={student.name} training={attendanceTraining} eligibleTrainings={attendanceEligibleTrainings}
          entry={attendanceEntry} viewerRole="player" onClose={() => setAttendanceTrainingId(null)} onSave={saveAttendance} />
      )}
    </div>
  );
}

// ── root gate: auth -> Krossi onboarding -> personal invite -> pilot acknowledgement -> app ──
// Suljetussa pilotissa jokainen pelaaja tulee valmentajan koodilla. Linkin ?koodi=
// tulee esitäytettynä, jottei koodia tarvitse sanella puhelimessa.
function JoinCodeForm({ onJoined, autoFocus }) {
  const pageParams = new URLSearchParams(window.location.search);
  const [code, setCode] = React.useState(() => (pageParams.get('koodi') || '').trim().toUpperCase());
  const targetStudentId = pageParams.get('oppilas') || '';
  const [error, setError] = React.useState('');
  const [info, setInfo] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const finish = (result) => {
    setInfo(`Liityit${result.group_name ? ` ryhmään ${result.group_name}` : ''}${result.coach_name ? ` — valmentaja ${result.coach_name}` : ''}!`);
    setTimeout(() => onJoined(), 1400);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    const normalized = code.trim().toUpperCase();
    try {
      const result = targetStudentId
        ? await window.koutsiClaimPlayer(normalized, targetStudentId)
        : await window.koutsiRedeemInviteCode(normalized);
      finish(result);
    } catch (err) { setError(window.koutsiErrorText(err, 'Koodi ei kelvannut')); } finally { setBusy(false); }
  };
  return (
    <React.Fragment>
      {error && <div style={{ background: 'rgba(161,59,47,0.08)', border: '1px solid rgba(161,59,47,0.25)', color: '#a13b2f', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{error}</div>}
      {info && <div style={{ background: 'rgba(14,59,44,0.08)', border: '1px solid rgba(14,59,44,0.25)', color: 'var(--green-deep)', padding: '10px 14px', borderRadius: 12, fontSize: 13, marginBottom: 14 }}>{info}</div>}
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Esim. VHDC6P" autoFocus={autoFocus} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '13px 14px', fontSize: 18, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', fontFamily: 'inherit', color: '#111', background: '#fff' }} />
        <button className="btn-dark" type="submit" disabled={busy || !code.trim()} style={{ padding: '13px 0', opacity: (busy || !code.trim()) ? 0.5 : 1 }}>{busy ? 'Liitytään...' : targetStudentId ? 'Aktivoi oma pelaajaprofiili' : 'Liity'}</button>
      </form>
    </React.Fragment>
  );
}

function InviteCodeScreen({ onSignOut }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand)' }}>
      <div className="k-card" style={{ width: 'min(400px, 100%)', padding: '30px 28px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#111' }}>Liity valmentajasi ryhmään</h2>
        <p style={{ fontSize: 13, color: '#8a857a', marginBottom: 18, lineHeight: 1.5 }}>Syötä valmentajaltasi saamasi liittymiskoodi.</p>
        <JoinCodeForm onJoined={() => window.location.reload()} autoFocus />

        <div style={{ borderTop: '1px solid var(--line)', marginTop: 22, paddingTop: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#111', marginBottom: 5 }}>Etkö tiedä koodia?</div>
          <p style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.55, marginBottom: 12 }}>
            Suljettuun beta-pilottiin pääsee vain valmentajan kutsulla. Jos olet alle 18-vuotias, pyydä valmentajalta juuri sinulle tehty henkilökohtainen liittymislinkki. Alle 13-vuotias tarvitsee lisäksi huoltajan hyväksynnän.
          </p>
        </div>

        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13 }}>
          <button onClick={onSignOut} style={{ background: 'none', border: 'none', color: '#8a857a', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Kirjaudu ulos</button>
        </div>
      </div>
    </div>
  );
}
function KoutsiPelaajaRoot() {
  const auth = window.useKoutsiAuth();
  const [studentRow, setStudentRow] = React.useState(undefined); // undefined = checking, null = no coach yet
  const [checkFailed, setCheckFailed] = React.useState(false);

  // Rivin olemassaolo riittää. Suljetussa pilotissa uusi rivi syntyy vain valmentajan
  // koodia lunastaessa; aiemmin luodut koodittomat rivit saavat silti jatkaa.
  // Keyed on the user id rather than the session object: Supabase hands out a new session
  // object on every token refresh and every return to the tab, so depending on the object
  // itself re-queried the student row each time for a person who had not changed.
  const uid = auth.session?.user?.id || null;

  const checkStudent = React.useCallback(async () => {
    if (!uid) return;
    setCheckFailed(false);
    try {
      const student = await window.koutsiFetchStudentRow(uid);
      setStudentRow(student || null);
    } catch { setCheckFailed(true); } // katkennut yhteys ei saa jättää rautalankaan pyörimään
  }, [uid]);

  React.useEffect(() => {
    if (!uid || auth.needsOnboarding) { setStudentRow(undefined); return; }
    checkStudent();
  }, [uid, auth.needsOnboarding, checkStudent]);

  if (auth.loading) return <window.KoutsiAuthLoadingScreen />;
  // a recovery link must lead to a new password, not straight into the app
  if (auth.recoveryMode && auth.session) return <window.KoutsiPasswordResetScreen />;
  if (!auth.session) return <window.KoutsiAuthScreen />;
  if (auth.profileError) return <window.KoutsiErrorScreen message="Profiilitietojasi ei saatu haettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={auth.retryProfile} onSignOut={auth.signOut} />;
  if (auth.needsOnboarding) return <window.KoutsiProfileOnboarding />;
  if (checkFailed) return <window.KoutsiErrorScreen onRetry={checkStudent} onSignOut={auth.signOut} />;
  if (studentRow === undefined) return <window.KoutsiAuthLoadingScreen />;
  if (!studentRow) return <InviteCodeScreen onSignOut={auth.signOut} />;
  if (auth.pilotError) return <window.KoutsiErrorScreen message="Pilotin käyttörajausta ei saatu tarkistettua. Tarkista verkkoyhteys ja yritä uudelleen." onRetry={auth.retryPilot} onSignOut={auth.signOut} />;
  if (!auth.pilotAccepted) return <window.KoutsiPilotGate />;
  return <PlayerApp studentId={auth.session.user.id} onSignOut={auth.signOut} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <window.KoutsiUIProvider>
    <window.KoutsiAuthProvider><KoutsiPelaajaRoot /></window.KoutsiAuthProvider>
  </window.KoutsiUIProvider>
);
