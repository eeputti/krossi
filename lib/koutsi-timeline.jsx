// koutsi-timeline.jsx — the player's Kehitys tab, rebuilt as one real timeline.
//
// Everything that happens to a player used to live in its own little list: the goal on the
// home tab, moods here, match notes there, the coach's diary somewhere else. This file
// folds all of it into a single reverse-chronological stream — goals (including the goal
// that got replaced), coach notes, homework, moods, match notes, videos, trainings and
// absences — grouped by month, filterable by kind and searchable as free text, because a
// player who has been in the app for a season has a *lot* of entries.
//
// It is deliberately kept free of any backend detail: koutsi-pelaaja-app.jsx builds the
// `student` object out of Supabase and the demo builds the same shape out of
// lib/koutsi-demo-backend.jsx, and both leave the same date helpers on `window`.

const KOUTSI_TL_MOOD_LABELS = { 1: 'Raskas', 2: 'Vaisu', 3: 'Ihan ok', 4: 'Hyvä', 5: 'Loistava' };
const KOUTSI_TL_PREVIOUS_LABELS = { goal: 'Aiempi tavoite', wish: 'Aiempi toive', note: 'Aiempi muistiinpano' };

// One entry per event kind: the filter chip label, the rail dot colour, and the little
// glyph in the card's badge. Order here is the order the filter chips appear in.
const KOUTSI_TL_KINDS = {
  goal: { label: 'Tavoitteet', short: 'Tavoite', fg: '#5c6b06', bg: 'rgba(180,205,20,0.28)', dot: '#b4cd14', icon: '◎' },
  diary: { label: 'Valmentajalta', short: 'Valmentaja', fg: '#0e3b2c', bg: 'rgba(14,59,44,0.10)', dot: '#0e3b2c', icon: '✎' },
  homework: { label: 'Kotiläksyt', short: 'Kotiläksy', fg: '#8a5a12', bg: 'rgba(214,140,44,0.16)', dot: '#d68c2c', icon: '☑' },
  mood: { label: 'Fiilikset', short: 'Fiilis', fg: '#2a5d94', bg: 'rgba(58,130,212,0.13)', dot: '#3a82d4', icon: '☺' },
  match: { label: 'Ottelut', short: 'Ottelu', fg: '#a13b2f', bg: 'rgba(161,59,47,0.11)', dot: '#a13b2f', icon: '⚑' },
  video: { label: 'Videot', short: 'Video', fg: '#6a389c', bg: 'rgba(148,88,214,0.13)', dot: '#9458d6', icon: '▶' },
  wish: { label: 'Toiveet', short: 'Toive', fg: '#1f6b5c', bg: 'rgba(31,107,92,0.12)', dot: '#1f6b5c', icon: '✱' },
  note: { label: 'Muistiinpanot', short: 'Muistiinpano', fg: '#6b665c', bg: '#efece4', dot: '#6b665c', icon: '✐' },
  event: { label: 'Tapahtumat', short: 'Tapahtuma', fg: '#94571a', bg: 'rgba(214,140,44,0.13)', dot: '#c07820', icon: '★' },
  training: { label: 'Treenit', short: 'Treeni', fg: '#514c42', bg: '#efece4', dot: '#a8a294', icon: '●' },
  start: { label: 'Alku', short: 'Alku', fg: '#514c42', bg: '#efece4', dot: '#a8a294', icon: '⚑' },
};
const KOUTSI_TL_KIND_ORDER = ['goal', 'diary', 'homework', 'mood', 'match', 'video', 'wish', 'note', 'event', 'training', 'start'];

// ── time helpers ─────────────────────────────────────────────
// Sources mix full ISO timestamps (created_at) with plain date strings (a video's or a
// match note's own date). Both normalise to a sortable epoch and a local YYYY-MM-DD day.
function koutsiTlPad(n) { return String(n).padStart(2, '0'); }
function koutsiTlTime(at) {
  if (!at) return 0;
  if (at.length <= 10) { const d = window.koutsiDateFromStr(at); d.setHours(12, 0, 0, 0); return d.getTime(); }
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? 0 : t;
}
function koutsiTlDay(at) {
  if (!at) return '';
  if (at.length <= 10) return at;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${koutsiTlPad(d.getMonth() + 1)}-${koutsiTlPad(d.getDate())}`;
}
function koutsiTlMonthLabel(dayStr) {
  const [y, m] = dayStr.split('-').map(Number);
  const name = window.KOUTSI_MONTHS[m - 1] || '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}
// "Tänään" / "Eilen" beat a date for the two days a player actually looks at.
function koutsiTlDayLabel(dayStr) {
  const today = window.koutsiTodayStr();
  if (dayStr === today) return 'Tänään';
  const y = window.koutsiDateFromStr(today);
  y.setDate(y.getDate() - 1);
  if (dayStr === `${y.getFullYear()}-${koutsiTlPad(y.getMonth() + 1)}-${koutsiTlPad(y.getDate())}`) return 'Eilen';
  const d = window.koutsiDateFromStr(dayStr);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

// ── the builder ──────────────────────────────────────────────
// Turns one student (plus the trainings that concern them) into a flat, newest-first list
// of timeline events. `search` on each event is the blob the free-text filter matches, so
// searching "Venla" finds the match note and searching "syöttö" finds the coach's note.
function koutsiBuildTimeline(student, trainings, clubEvents) {
  const items = [];
  const push = (e) => { if (e.at) items.push(e); };

  (student.goalHistory || []).forEach((g) => push({
    id: `goal-${g.id}`, kind: 'goal', at: g.at, source: g,
    title: g.previousValue ? 'Tavoite päivitetty' : 'Tavoite asetettu',
    body: g.value || '(tavoite tyhjennetty)',
    previous: g.previousValue || '',
    search: `${g.value || ''} ${g.previousValue || ''} tavoite`,
  }));

  (student.diary || []).forEach((d) => push({
    id: `diary-${d.id != null ? d.id : d.at}`, kind: 'diary', at: d.at, source: d,
    title: 'Valmentajan huomio', body: d.text,
    search: `${d.text} valmentaja`,
  }));

  // Assigned and ticked-off are two separate moments, and putting "tehty" on the day the
  // coach assigned it would misdate the one thing the player actually did.
  (student.homework || []).forEach((h, i) => {
    const key = h.id != null ? h.id : i;
    push({
      id: `hw-${key}`, kind: 'homework', at: h.at, source: h,
      title: 'Kotiläksy', body: h.text,
      search: `${h.text} kotiläksy`,
    });
    if (h.done && h.doneAt) push({
      id: `hw-done-${key}`, kind: 'homework', at: h.doneAt, source: h,
      title: 'Kotiläksy tehty', body: h.text, done: true,
      search: `${h.text} kotiläksy tehty`,
    });
  });

  (student.moods || []).forEach((m, i) => push({
    id: `mood-${m.id != null ? m.id : i}`, kind: 'mood', at: m.at, source: m,
    title: `Fiilis treenin jälkeen: ${KOUTSI_TL_MOOD_LABELS[m.score] || m.score}`,
    body: m.note || '', score: m.score, hidden: !!m.hiddenFromCoach,
    search: `${m.note || ''} fiilis ${KOUTSI_TL_MOOD_LABELS[m.score] || ''}`,
  }));

  (student.matchNotes || []).forEach((n) => push({
    id: `match-${n.id}`, kind: 'match', at: n.at || n.date, source: n,
    title: `Ottelu: ${n.opponentName}`, body: n.note || '',
    search: `${n.opponentName} ${n.note || ''} ottelu vastustaja`,
  }));

  (student.videos || []).forEach((v, i) => push({
    id: `video-${v.id != null ? v.id : i}`, kind: 'video', at: v.at || v.date, source: v,
    title: v.addedBy === 'player' ? 'Lisäsit videon' : 'Valmentaja lisäsi videon',
    body: v.title, video: v, tags: v.tags || [],
    search: `${v.title} video ${(v.tags || []).join(' ')}`,
  }));

  // The wish and the player's own note overwrite themselves exactly like the goal did, so
  // each edit is kept and shown the same way — with what it replaced underneath.
  (student.wishHistory || []).forEach((w) => push({
    id: `wish-${w.id}`, kind: 'wish', at: w.at, source: w,
    title: w.previousValue ? 'Toive päivitetty' : 'Toive valmentajalle',
    body: w.value || '(toive tyhjennetty)', previous: w.previousValue || '',
    search: `${w.value || ''} ${w.previousValue || ''} toive`,
  }));

  (student.noteHistory || []).forEach((n) => push({
    id: `note-${n.id}`, kind: 'note', at: n.at, source: n,
    title: n.previousValue ? 'Muistiinpano päivitetty' : 'Oma muistiinpano',
    body: n.value || '(muistiinpano tyhjennetty)', previous: n.previousValue || '',
    search: `${n.value || ''} ${n.previousValue || ''} muistiinpano`,
  }));

  // Only sessions that have already happened belong on a history timeline; the upcoming
  // ones live on the Treenit tab.
  const today = window.koutsiTodayStr();
  (trainings || []).filter((t) => t.date <= today).forEach((t) => {
    const absence = (t.absences || []).find((a) => a.studentId === student.id);
    const reason = absence ? (window.KOUTSI_ABSENCE_REASON_LABELS[absence.reason] || 'Poissa') : '';
    push({
      id: `training-${t.id}`, kind: 'training', at: t.date,
      title: absence ? `${t.type} — ${reason}` : t.type,
      body: t.groupName ? t.groupName : '',
      time: t.time, absent: !!absence,
      search: `${t.type} ${t.groupName || ''} treeni ${reason}`,
    });
  });

  // Club tournaments and play days are things that happened to the player too, even though
  // they belong to the club rather than to one student.
  (clubEvents || []).filter((e) => e.date <= today).forEach((e) => push({
    id: `event-${e.id}`, kind: 'event', at: e.date,
    title: e.title, body: e.kind ? `Seuran ${e.kind}` : '',
    search: `${e.title} ${e.kind || ''} tapahtuma seura`,
  }));

  if (student.joinedAt) push({
    id: 'start', kind: 'start', at: student.joinedAt,
    title: 'Aloitit Krossi Koutsissa', body: 'Tästä kehityshistoriasi lähtee liikkeelle.',
    search: 'alku aloitus',
  });

  return items.sort((a, b) => koutsiTlTime(b.at) - koutsiTlTime(a.at));
}

// ── presentation ─────────────────────────────────────────────
function KoutsiTlStat({ label, value, hint }) {
  return (
    <div className="k-card" style={{ padding: '13px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#111', lineHeight: 1.1, letterSpacing: -0.4 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 5 }}>{label}</div>
      {hint && <div style={{ fontSize: 11.5, color: '#a8a294', marginTop: 3 }}>{hint}</div>}
    </div>
  );
}

function KoutsiTlChip({ active, onClick, children, count }) {
  return (
    <button onClick={onClick} style={{
      flexShrink: 0, padding: '7px 13px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
      border: active ? 'none' : '1px solid #d8d4ca', background: active ? 'var(--green-deep, #0e3b2c)' : '#fff',
      color: active ? '#fff' : '#514c42', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
    }}>
      {children}{count != null && <span style={{ opacity: 0.65, marginLeft: 6, fontWeight: 600 }}>{count}</span>}
    </button>
  );
}

function KoutsiTlBadge({ kind }) {
  const k = KOUTSI_TL_KINDS[kind];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
      background: k.bg, color: k.fg, borderRadius: 999, padding: '3px 9px',
      fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4,
    }}><span style={{ fontSize: 10 }}>{k.icon}</span>{k.short}</span>
  );
}

// One card on the rail. The kind decides the dot colour and the badge; only a few kinds
// (goal, mood, video) add anything beyond title + body.
function KoutsiTlEvent({ event, onOpenVideo, renderActions }) {
  const actions = renderActions ? renderActions(event) : null;
  return (
    <div className="k-card" style={{ padding: '13px 15px', flex: 1, minWidth: 0, opacity: event.absent ? 0.72 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
        <KoutsiTlBadge kind={event.kind} />
        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111', minWidth: 0 }}>{event.title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {event.time && <span style={{ fontSize: 11.5, color: '#a8a294' }}>{event.time}</span>}
          {actions}
        </span>
      </div>

      {event.kind === 'mood' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--lime)', color: '#101a08', fontWeight: 800, fontSize: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{event.score}</span>
          <div style={{ minWidth: 0 }}>
            {event.body && <div style={{ fontSize: 13.5, color: '#3c382f', lineHeight: 1.5 }}>{event.body}</div>}
            {event.hidden && <span className="k-chip" style={{ marginTop: event.body ? 5 : 0, fontSize: 11 }}>🔒 Vain sinulle</span>}
          </div>
        </div>
      ) : event.body ? (
        <div style={{ fontSize: 13.5, color: '#3c382f', lineHeight: 1.55, textDecoration: event.done ? 'line-through' : 'none' }}>{event.body}</div>
      ) : null}

      {/* The whole point of keeping a history: the text it replaced stays readable underneath. */}
      {event.previous && (
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px dashed #e3dfd4' }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: '#a8a294', textTransform: 'uppercase', letterSpacing: 0.5 }}>{KOUTSI_TL_PREVIOUS_LABELS[event.kind] || 'Aiempi'}</span>
          <div style={{ fontSize: 13, color: '#8a857a', lineHeight: 1.5, marginTop: 3 }}>{event.previous}</div>
        </div>
      )}

      {event.kind === 'video' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9, flexWrap: 'wrap' }}>
          <span style={{ width: 42, height: 34, borderRadius: 9, flexShrink: 0, position: 'relative', background: `radial-gradient(120% 120% at 30% 20%, hsl(${event.video.hue} 55% 45%), hsl(${event.video.hue + 24} 60% 22%))` }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="10" height="12" viewBox="0 0 12 14"><path d="M1 1v12l10-6L1 1z" fill="rgba(255,255,255,0.92)" /></svg>
            </span>
          </span>
          {(event.tags || []).map((t) => <span key={t} className="k-chip">{window.KOUTSI_TAG_LABELS[t] || t}</span>)}
          {/* The demo has no files behind its videos, so the play button only appears
              when there is actually something to open. */}
          {onOpenVideo && (event.video.storagePath || event.video.externalUrl) && (
            <button onClick={() => onOpenVideo(event.video)} className="btn-outline btn-sm" style={{ marginLeft: 'auto' }}>Katso video</button>
          )}
        </div>
      )}
    </div>
  );
}

const KOUTSI_TL_PAGE = 40;

function KoutsiTimeline({ student, trainings, clubEvents, onOpenVideo, actions, renderActions }) {
  const [kind, setKind] = React.useState('kaikki');
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState(KOUTSI_TL_PAGE);

  const all = React.useMemo(() => koutsiBuildTimeline(student, trainings, clubEvents), [student, trainings, clubEvents]);

  // Counts come off the unfiltered list so a chip never reads "0" while showing results.
  const counts = React.useMemo(() => {
    const c = {};
    all.forEach((e) => { c[e.kind] = (c[e.kind] || 0) + 1; });
    return c;
  }, [all]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => (kind === 'kaikki' || e.kind === kind) && (!q || (e.search || '').toLowerCase().includes(q)));
  }, [all, kind, query]);

  React.useEffect(() => { setLimit(KOUTSI_TL_PAGE); }, [kind, query]);

  const shown = filtered.slice(0, limit);

  // Month buckets, each remembering which day each event fell on so the date rail can
  // print a date once per day instead of once per card.
  const months = React.useMemo(() => {
    const out = [];
    let current = null;
    let lastDay = null;
    shown.forEach((e) => {
      const day = koutsiTlDay(e.at);
      const key = day.slice(0, 7);
      if (!current || current.key !== key) { current = { key, label: koutsiTlMonthLabel(day), events: [] }; out.push(current); lastDay = null; }
      current.events.push({ event: e, day, showDay: day !== lastDay });
      lastDay = day;
    });
    return out;
  }, [shown]);

  const moods = student.moods || [];
  const moodAvg = moods.length ? (moods.reduce((sum, m) => sum + m.score, 0) / moods.length) : null;
  const pastTrainings = counts.training || 0;

  const activeKinds = KOUTSI_TL_KIND_ORDER.filter((k) => counts[k]);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
        <KoutsiTlStat label="Treenejä" value={pastTrainings} hint="tähän mennessä" />
        <KoutsiTlStat label="Fiilis ka." value={moodAvg == null ? '–' : moodAvg.toFixed(1)} hint={moods.length ? `${moods.length} merkintää` : 'ei merkintöjä'} />
        <KoutsiTlStat label="Videoita" value={(student.videos || []).length} />
        <KoutsiTlStat label="Otteluita" value={(student.matchNotes || []).length} />
      </div>

      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>{actions}</div>}

      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae aikajanalta — vastustaja, lyönti, sana muistiinpanosta…"
        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 14, padding: '11px 14px', fontSize: 14, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 10 }} />

      <div className="k-scroll-x" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 4, marginBottom: 18 }}>
        <KoutsiTlChip active={kind === 'kaikki'} onClick={() => setKind('kaikki')} count={all.length}>Kaikki</KoutsiTlChip>
        {activeKinds.map((k) => (
          <KoutsiTlChip key={k} active={kind === k} onClick={() => setKind(k)} count={counts[k]}>{KOUTSI_TL_KINDS[k].label}</KoutsiTlChip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="k-card" style={{ padding: 22, color: '#8a857a', fontSize: 14.5, lineHeight: 1.55 }}>
          {all.length === 0
            ? 'Aikajanasi on vielä tyhjä. Se täyttyy itsestään: valmentajan huomiot, tavoitteesi, treenit, fiilikset, videot ja ottelumuistiinpanot päätyvät kaikki tänne.'
            : 'Ei osumia — kokeile toista hakusanaa tai suodatinta.'}
        </div>
      ) : (
        months.map((month) => (
          <div key={month.key} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#111', textTransform: 'uppercase', letterSpacing: 0.6 }}>{month.label}</span>
              <span style={{ flex: 1, height: 1, background: '#e3dfd4' }} />
              <span style={{ fontSize: 11.5, color: '#a8a294' }}>{month.events.length} tapahtumaa</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {month.events.map(({ event, day, showDay }, i) => (
                <div key={event.id} style={{ display: 'flex', gap: 9, alignItems: 'stretch' }}>
                  <div style={{ width: 46, flexShrink: 0, paddingTop: 13, textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: showDay ? '#8a857a' : 'transparent' }}>
                    {koutsiTlDayLabel(day)}
                  </div>
                  <div style={{ width: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, paddingTop: 17 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: KOUTSI_TL_KINDS[event.kind].dot, flexShrink: 0 }} />
                    {i < month.events.length - 1 && <span style={{ width: 1.5, flex: 1, background: '#e3dfd4', marginTop: 4 }} />}
                  </div>
                  <KoutsiTlEvent event={event} onOpenVideo={onOpenVideo} renderActions={renderActions} />
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {filtered.length > shown.length && (
        <button onClick={() => setLimit((n) => n + KOUTSI_TL_PAGE)} className="btn-outline" style={{ width: '100%', padding: '12px 0' }}>
          Näytä lisää ({filtered.length - shown.length} jäljellä)
        </button>
      )}
    </div>
  );
}

// Exported because the same "Tänään / Eilen / ma 18.8." reading applies wherever a single
// event is shown outside the timeline (the coach's diary list, the player's latest note).
function koutsiFmtEventDate(at) {
  const day = koutsiTlDay(at);
  if (!day) return '';
  const label = koutsiTlDayLabel(day);
  return (label === 'Tänään' || label === 'Eilen') ? label : window.koutsiFmtShortDate(day);
}

Object.assign(window, { koutsiBuildTimeline, KoutsiTimeline, koutsiFmtEventDate, KOUTSI_TL_KINDS });
