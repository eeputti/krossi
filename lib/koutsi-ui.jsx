// koutsi-ui.jsx — shared interaction primitives for both real Koutsi apps.
//
// Exists because the coach and player apps had grown the same three gaps: every failure
// surfaced as alert(err.message) in English, nothing destructive asked for confirmation,
// and there was no way to see what had happened while you were away. Keeping these here
// means one behaviour, not two implementations that drift.

// ── Toasts ───────────────────────────────────────────────────
// Replaces alert(): non-blocking, Finnish, and it can report success as well as failure,
// which alert() never did.
const KoutsiToastContext = React.createContext(null);

function KoutsiToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const remove = React.useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const push = React.useCallback((message, tone = 'info', ms = 4200) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => remove(id), ms);
    return id;
  }, [remove]);

  const api = React.useMemo(() => ({
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error', 6000),
    info: (m) => push(m, 'info'),
    // Wraps an async action: reports the Finnish version of whatever went wrong and
    // resolves to false, so callers can keep a modal open on failure.
    run: async (fn, successMessage) => {
      try {
        await fn();
        if (successMessage) push(successMessage, 'success');
        return true;
      } catch (err) {
        push(window.koutsiErrorText(err), 'error', 6000);
        return false;
      }
    },
  }), [push]);

  const tone = {
    success: { bg: '#0E3B2C', fg: '#fff' },
    error: { bg: '#8f2f24', fg: '#fff' },
    info: { bg: '#2f2b24', fg: '#fff' },
  };

  return (
    <KoutsiToastContext.Provider value={api}>
      {children}
      <div style={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'max(22px, env(safe-area-inset-bottom))', zIndex: 200, display: 'flex', flexDirection: 'column', gap: 8, width: 'min(440px, calc(100vw - 32px))', pointerEvents: 'none' }}>
        {toasts.map((t) => (
          <div key={t.id} onClick={() => remove(t.id)} role="status" style={{
            pointerEvents: 'auto', cursor: 'pointer',
            background: tone[t.tone].bg, color: tone[t.tone].fg,
            padding: '13px 17px', borderRadius: 14, fontSize: 14, lineHeight: 1.45, fontWeight: 600,
            boxShadow: '0 16px 34px -18px rgba(0,0,0,0.55)', animation: 'kRiseIn .22s ease both',
          }}>{t.message}</div>
        ))}
      </div>
    </KoutsiToastContext.Provider>
  );
}
function useKoutsiToast() { return React.useContext(KoutsiToastContext); }

// ── Confirmation ─────────────────────────────────────────────
// `confirm(...)` returns a promise so a caller reads top-to-bottom:
//   if (!(await confirm({ ... }))) return;
// `typeToConfirm` is reserved for the genuinely irreversible ones (account deletion).
const KoutsiConfirmContext = React.createContext(null);

function KoutsiConfirmProvider({ children }) {
  const [dialog, setDialog] = React.useState(null);
  const [typed, setTyped] = React.useState('');
  const confirm = React.useCallback((opts) => new Promise((resolve) => {
    setTyped('');
    setDialog({ ...opts, resolve });
  }), []);

  const close = (result) => {
    if (dialog) dialog.resolve(result);
    setDialog(null);
    setTyped('');
  };

  React.useEffect(() => {
    if (!dialog) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const needsTyping = Boolean(dialog?.typeToConfirm);
  const canConfirm = !needsTyping || typed.trim().toLowerCase() === String(dialog.typeToConfirm).trim().toLowerCase();

  return (
    <KoutsiConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div onClick={() => close(false)} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(10,15,10,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="k-card" role="alertdialog" aria-modal="true" style={{ width: 'min(420px, 100%)', padding: '26px 26px 22px', animation: 'kFadeIn .18s ease' }}>
            <h3 style={{ fontSize: 18.5, fontWeight: 800, marginBottom: 8, color: '#111' }}>{dialog.title}</h3>
            {dialog.body && <p style={{ fontSize: 14, color: '#514c42', lineHeight: 1.55, marginBottom: needsTyping ? 14 : 20 }}>{dialog.body}</p>}
            {needsTyping && (
              <React.Fragment>
                <p style={{ fontSize: 12.5, color: '#8a857a', marginBottom: 8 }}>Kirjoita vahvistukseksi <b style={{ color: '#111' }}>{dialog.typeToConfirm}</b></p>
                <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #d8d4ca', borderRadius: 12, padding: '11px 13px', fontSize: 14, fontFamily: 'inherit', color: '#111', background: '#fff', marginBottom: 20 }} />
              </React.Fragment>
            )}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => close(false)} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>{dialog.cancelLabel || 'Peruuta'}</button>
              <button onClick={() => canConfirm && close(true)} disabled={!canConfirm}
                className="btn-dark"
                style={{
                  flex: 1, padding: '13px 0', border: 'none',
                  background: dialog.danger ? '#8f2f24' : 'var(--green-deep)',
                  opacity: canConfirm ? 1 : 0.45, cursor: canConfirm ? 'pointer' : 'default',
                }}>{dialog.confirmLabel || 'Vahvista'}</button>
            </div>
          </div>
        </div>
      )}
    </KoutsiConfirmContext.Provider>
  );
}
function useKoutsiConfirm() { return React.useContext(KoutsiConfirmContext); }

// One provider wrapper so each app's entry point stays a single line.
function KoutsiUIProvider({ children }) {
  return <KoutsiToastProvider><KoutsiConfirmProvider>{children}</KoutsiConfirmProvider></KoutsiToastProvider>;
}

// ── Small shared controls ────────────────────────────────────
function KoutsiIconButton({ label, onClick, danger, children }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(e); }} title={label} aria-label={label} style={{
      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
      border: '1px solid var(--line)', background: '#fff', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: danger ? '#8f2f24' : '#6b665c',
    }}>{children}</button>
  );
}
function KoutsiEditIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.9l2.6 2.6M2 14l.6-3 8-8 2.4 2.4-8 8L2 14z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}
function KoutsiTrashIcon() {
  return <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v5M9.5 6.5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
// Edit + delete pair used on every list row that can now be corrected.
function KoutsiRowActions({ onEdit, onDelete, editLabel = 'Muokkaa', deleteLabel = 'Poista' }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      {onEdit && <KoutsiIconButton label={editLabel} onClick={onEdit}><KoutsiEditIcon /></KoutsiIconButton>}
      {onDelete && <KoutsiIconButton label={deleteLabel} onClick={onDelete} danger><KoutsiTrashIcon /></KoutsiIconButton>}
    </div>
  );
}
// Stands in for the native <input type="time"> picker everywhere a coach sets a session's
// clock time. The native picker's UI varies wildly by browser/OS — on some it renders as a
// bare scrollable "20/21/22/23" number wheel with no colon and no obvious hour/minute
// split, which reads as broken rather than as a time picker. Every time-of-day value in
// the app is already rounded to the quarter hour, so two plain selects (00-23, then
// 00/15/30/45) lose no precision and can't be misread — they work identically everywhere.
function KoutsiTimeSelect({ value, onChange, style, hourLabel = 'Tunti', minuteLabel = 'Minuutti', disabled }) {
  const [h, m] = (value || '').split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = ['00', '15', '30', '45'];
  const selectStyle = { ...style, minWidth: 0, flex: 1, cursor: disabled ? 'default' : 'pointer' };
  return (
    <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
      <select aria-label={hourLabel} disabled={disabled} value={h || ''} onChange={(e) => onChange(`${e.target.value}:${m || '00'}`)} style={selectStyle}>
        <option value="" disabled>--</option>
        {hours.map((hh) => <option key={hh} value={hh}>{hh}</option>)}
      </select>
      <select aria-label={minuteLabel} disabled={disabled} value={m || ''} onChange={(e) => onChange(`${h || '00'}:${e.target.value}`)} style={selectStyle}>
        <option value="" disabled>--</option>
        {minutes.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
      </select>
    </div>
  );
}

// ── Attendance controls shared by coach and player ─────────────────────────
const KOUTSI_ATTENDANCE_TONES = {
  paikalla: { fg: '#2f7d54', bg: 'rgba(47,125,84,0.10)', border: 'rgba(47,125,84,0.28)' },
  poissa: { fg: '#6b665c', bg: 'rgba(138,133,122,0.10)', border: 'rgba(138,133,122,0.30)' },
};

function KoutsiAttendanceBadge({ entry, onClick, compact = false }) {
  const status = entry ? 'poissa' : 'paikalla';
  const tone = KOUTSI_ATTENDANCE_TONES[status] || KOUTSI_ATTENDANCE_TONES.paikalla;
  const label = (window.KOUTSI_ATTENDANCE_STATUS_LABELS || {})[status] || 'Paikalla';
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      minHeight: compact ? 30 : 34, padding: compact ? '6px 10px' : '7px 12px',
      borderRadius: 999, border: `1px solid ${tone.border}`, background: tone.bg,
      color: tone.fg, fontWeight: 750, fontSize: compact ? 11.5 : 12.5,
      cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.fg }} />
      {label} · Muokkaa
    </button>
  );
}

function KoutsiAttendanceModal({ studentName, training, eligibleTrainings, entry, viewerRole = 'coach', onClose, onSave }) {
  const [status, setStatus] = React.useState(entry ? 'poissa' : 'paikalla');
  const [count, setCount] = React.useState(1);
  const [busy, setBusy] = React.useState(false);
  const baseKey = `${training.date}T${training.time || '00:00'}`;
  const candidates = [training, ...(eligibleTrainings || [])]
    .filter((t, i, all) => t && `${t.date}T${t.time || '00:00'}` >= baseKey && all.findIndex((x) => x && x.id === t.id) === i)
    .sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`))
    .slice(0, 4);
  const maxCount = status === 'paikalla' ? 1 : Math.max(1, candidates.length);
  const chosenCount = Math.min(count, maxCount);
  const statusOptions = [
    { value: 'paikalla', label: 'Paikalla' },
    { value: 'poissa', label: 'Poissa' },
  ];
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onSave({
      trainingIds: candidates.slice(0, chosenCount).map((t) => t.id),
      status,
      note: '',
    });
    setBusy(false);
    if (ok !== false) onClose();
  };
  return (
    <div onClick={onClose} role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(10,15,10,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Läsnäolo — ${studentName}`} className="k-card" style={{ width: 'min(500px, 100%)', maxHeight: '90vh', overflowY: 'auto', padding: '26px 26px 22px', animation: 'kFadeIn .2s ease' }}>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 5 }}>Läsnäolo — {studentName}</h3>
        <div style={{ fontSize: 13.5, color: '#8a857a', marginBottom: 20 }}>{window.koutsiFmtShortDate(training.date)} · klo {training.time} · {training.type}</div>

        <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.55, marginBottom: 9 }}>Tila</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 18 }}>
          {statusOptions.map((option) => {
            const on = status === option.value;
            const tone = KOUTSI_ATTENDANCE_TONES[option.value];
            return (
              <button type="button" key={option.value} onClick={() => { setStatus(option.value); if (option.value === 'paikalla') setCount(1); }} style={{
                minHeight: 44, padding: '9px 7px', borderRadius: 13,
                border: `1.5px solid ${on ? tone.fg : '#d8d4ca'}`,
                background: on ? tone.bg : '#fff', color: on ? tone.fg : '#514c42',
                fontWeight: 750, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
              }}>{option.label}</button>
            );
          })}
        </div>

        {status !== 'paikalla' && (
          <React.Fragment>
            {candidates.length > 1 && (
              <React.Fragment>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8a857a', textTransform: 'uppercase', letterSpacing: 0.55, marginBottom: 9 }}>Kuinka moneen treeniin?</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 18 }}>
                  {Array.from({ length: candidates.length }, (_, i) => i + 1).map((n) => (
                    <button type="button" key={n} onClick={() => setCount(n)} style={{
                      padding: '8px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
                      border: n === chosenCount ? '1px solid var(--green-deep)' : '1px solid #d8d4ca',
                      background: n === chosenCount ? 'rgba(14,59,44,0.08)' : '#fff',
                      color: n === chosenCount ? 'var(--green-deep)' : '#514c42', fontSize: 12.5, fontWeight: 700,
                    }}>{n === 1 ? 'Vain tämä' : `${n} treeniä`}</button>
                  ))}
                </div>
              </React.Fragment>
            )}
          </React.Fragment>
        )}

        <div style={{ borderRadius: 12, background: '#f7f5ef', padding: '10px 12px', color: '#6b665c', fontSize: 12.5, lineHeight: 1.45, marginBottom: 18 }}>
          {viewerRole === 'player'
            ? 'Valmentajasi näkee läsnäolotilan heti. Beta-pilotissa poissaolon syytä ei tallenneta.'
            : 'Pelaaja näkee merkinnän omassa treenikalenterissaan. Beta-pilotissa poissaolon syytä ei tallenneta.'}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={onClose} disabled={busy} className="btn-outline" style={{ flex: 1, padding: '13px 0' }}>Peruuta</button>
          <button type="button" onClick={submit} disabled={busy} className="btn-dark" style={{ flex: 1, padding: '13px 0', opacity: busy ? 0.65 : 1 }}>{busy ? 'Tallennetaan…' : 'Tallenna'}</button>
        </div>
      </div>
    </div>
  );
}

// ── QR ───────────────────────────────────────────────────────
// Rendered as inline SVG from window.koutsiQrMatrix — no image service, so an invite link
// (which grants access to a coaching group) never leaves the device to be rendered.
function KoutsiQrCode({ text, size = 190 }) {
  const matrix = React.useMemo(() => {
    try { return window.koutsiQrMatrix(text); } catch { return null; }
  }, [text]);
  if (!matrix) return null;
  const quiet = 2;
  const dim = matrix.length + quiet * 2;
  const cells = [];
  matrix.forEach((row, r) => row.forEach((on, c) => {
    if (on) cells.push(<rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} fill="#0E3B2C" />);
  }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} shapeRendering="crispEdges" role="img" aria-label="QR-koodi liittymislinkkiin"
      style={{ background: '#fff', borderRadius: 12, display: 'block' }}>
      <rect x="0" y="0" width={dim} height={dim} fill="#fff" />
      {cells}
    </svg>
  );
}

// ── Copy to clipboard ────────────────────────────────────────
// navigator.clipboard needs a secure context and can be refused; the textarea fallback is
// what makes "kopioi viesti" work on an older phone browser in a tennis hall.
async function koutsiCopyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}
function KoutsiCopyButton({ text, label = 'Kopioi', copiedLabel = 'Kopioitu!', className = 'btn-outline btn-sm', style }) {
  const [copied, setCopied] = React.useState(false);
  const toast = useKoutsiToast();
  return (
    <button className={className} style={style} onClick={async () => {
      const ok = await koutsiCopyText(text);
      if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      else toast.error('Kopiointi ei onnistunut — valitse teksti ja kopioi käsin.');
    }}>{copied ? copiedLabel : label}</button>
  );
}

// ── Notifications ────────────────────────────────────────────
// The bell is the other half of the email notifications: someone who turns email off
// still needs somewhere to see what changed.
function KoutsiNotificationBell({ userId, dark = false }) {
  const [items, setItems] = React.useState([]);
  const [open, setOpen] = React.useState(false);
  const toast = useKoutsiToast();
  // The desktop sidebar and mobile top bar both mount this component for the same
  // userId at once. Supabase's channel(name) returns the same object for a repeated
  // name, so a shared "koutsi-notif-<uid>" name would make the second instance call
  // .subscribe() on an already-subscribed channel and throw — give every mounted
  // instance its own channel instead.
  const instanceId = React.useRef(Math.random().toString(36).slice(2)).current;

  const load = React.useCallback(async () => {
    try { setItems(await window.koutsiLoadNotifications(userId)); } catch { /* non-critical */ }
  }, [userId]);

  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const channel = window.koutsiSupabase
      .channel(`koutsi-notif-${userId}-${instanceId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'koutsi_notifications', filter: `recipient_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => window.koutsiSupabase.removeChannel(channel);
  }, [userId, instanceId, load]);

  const unread = items.filter((n) => !n.read).length;

  const openPanel = async () => {
    setOpen(true);
    if (unread > 0) {
      try {
        await window.koutsiMarkNotificationsRead(userId);
        setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      } catch (err) { toast.error(window.koutsiErrorText(err)); }
    }
  };

  return (
    <React.Fragment>
      <button onClick={openPanel} aria-label={unread ? `Ilmoitukset (${unread} uutta)` : 'Ilmoitukset'} style={{
        position: 'relative', width: 36, height: 36, borderRadius: '50%', cursor: 'pointer',
        border: dark ? '1px solid rgba(255,255,255,0.2)' : '1px solid var(--line)',
        background: dark ? 'rgba(255,255,255,0.08)' : '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
          <path d="M9 2a5 5 0 015 5v3l1.4 2.2a.6.6 0 01-.5.9H3.1a.6.6 0 01-.5-.9L4 10V7a5 5 0 015-5z" stroke={dark ? '#fff' : '#3c382f'} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M7 15a2 2 0 004 0" stroke={dark ? '#fff' : '#3c382f'} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span style={{ position: 'absolute', top: 1, right: 1, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: '#c23b28', color: '#fff', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid ' + (dark ? '#0E3B2C' : '#fff') }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {/* Kello istuu sivupalkissa, jonka sisaruksena main-sisalto muodostaa oman
          pinoutuskontekstin — ilman porttia paneeli jaisi sivun korttien alle. */}
      {open && ReactDOM.createPortal((
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(10,15,10,0.4)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '70px 16px 20px' }}>
          <div onClick={(e) => e.stopPropagation()} className="k-card" style={{ width: 'min(420px, 100%)', maxHeight: '70vh', overflowY: 'auto', padding: '22px 22px 18px', animation: 'kFadeIn .18s ease' }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 14, color: '#111' }}>Ilmoitukset</h3>
            {items.length === 0 && <div style={{ color: '#8a857a', fontSize: 14 }}>Ei vielä ilmoituksia.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {items.map((n) => (
                <div key={n.id} style={{ padding: '11px 13px', borderRadius: 12, background: n.read ? '#f7f5ef' : 'rgba(207,228,20,0.14)', border: '1px solid ' + (n.read ? 'var(--line)' : 'rgba(207,228,20,0.5)') }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: 13, color: '#514c42', marginTop: 3, lineHeight: 1.45 }}>{n.body}</div>}
                  <div style={{ fontSize: 11.5, color: '#8a857a', marginTop: 4 }}>{n.date}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setOpen(false)} className="btn-outline" style={{ width: '100%', padding: '12px 0', marginTop: 16 }}>Sulje</button>
          </div>
        </div>
      ), document.body)}
    </React.Fragment>
  );
}

// ── Email notification toggle ────────────────────────────────
function KoutsiEmailPrefToggle({ userId }) {
  const [enabled, setEnabled] = React.useState(null);
  const toast = useKoutsiToast();
  React.useEffect(() => {
    let cancelled = false;
    window.koutsiLoadEmailPref(userId).then((v) => { if (!cancelled) setEnabled(v); }).catch(() => { if (!cancelled) setEnabled(true); });
    return () => { cancelled = true; };
  }, [userId]);

  if (enabled === null) return null;
  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    const ok = await toast.run(() => window.koutsiSetEmailPref(userId, next));
    if (!ok) setEnabled(!next);
  };
  return (
    <button onClick={toggle} className="k-card" style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '13px 15px', width: '100%', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', background: '#fff' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>Sähköposti-ilmoitukset</div>
        <div style={{ fontSize: 12.5, color: '#8a857a', marginTop: 2, lineHeight: 1.45 }}>Uusista palautteista, kotiläksyistä ja treenimuutoksista.</div>
      </div>
      <span style={{ width: 44, height: 26, borderRadius: 999, background: enabled ? 'var(--green-deep)' : '#d8d4ca', position: 'relative', flexShrink: 0, transition: 'background .18s' }}>
        <span style={{ position: 'absolute', top: 3, left: enabled ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .18s' }} />
      </span>
    </button>
  );
}

// ── Danger zone: account deletion ────────────────────────────
function KoutsiDeleteAccountButton({ profileName }) {
  const confirm = useKoutsiConfirm();
  const toast = useKoutsiToast();
  const [busy, setBusy] = React.useState(false);
  const run = async () => {
    const ok = await confirm({
      title: 'Poista tili ja kaikki tiedot',
      body: 'Tämä poistaa pysyvästi tilisi, profiilisi sekä kaikki Koutsiin tallennetut merkinnät, kotiläksyt, videot ja ryhmätiedot. Toimintoa ei voi perua.',
      confirmLabel: 'Poista lopullisesti',
      cancelLabel: 'Peruuta',
      danger: true,
      typeToConfirm: profileName || 'POISTA',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await window.koutsiDeleteAccount();
      window.location.href = 'https://koutsi.krossi.app';
    } catch (err) {
      toast.error(window.koutsiErrorText(err));
      setBusy(false);
    }
  };
  return (
    <button onClick={run} disabled={busy} className="btn-outline btn-sm" style={{ color: '#8f2f24', borderColor: '#e3c9c4', opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Poistetaan…' : 'Poista tili ja tiedot'}
    </button>
  );
}

// ── Legal links ──────────────────────────────────────────────
function KoutsiLegalLinks({ style }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: '#8a857a', ...style }}>
      <a href="/tietosuoja" style={{ color: '#8a857a' }}>Tietosuojaseloste</a>
      <a href="/kayttoehdot" style={{ color: '#8a857a' }}>Käyttöehdot</a>
      <a href="mailto:eelispuro@gmail.com?subject=Krossi%20Koutsi" style={{ color: '#8a857a' }}>Ota yhteyttä</a>
    </div>
  );
}

// ── Views as addresses ───────────────────────────────────────
// Both apps kept the open view in a single useState, so every view shared one address:
// a refresh dropped you back on the first tab, a link could not point at anything in
// particular, and a phone's back button left the app instead of stepping back a view.
// This maps each tab id to a path segment under the app's own base — /valmentaja/oppilaat,
// /pelaaja/treenit — and keeps the two in step in both directions. Vercel serves the same
// HTML for every segment (see vercel.json), so a deep link survives a cold load too.
//
// Opened any other way — the raw /koutsi-valmentaja.html during local development, say —
// there is no base path to hang views off, so the hook quietly stays a plain useState and
// leaves the address bar alone rather than inventing URLs the server would not serve.
function koutsiRouteBase() {
  const path = window.location.pathname;
  for (const base of ['/valmentaja', '/pelaaja']) {
    if (path === base || path.startsWith(base + '/')) return base;
  }
  return null;
}

// `slugs` maps tab id -> path segment and must be a stable object: define it once at
// module level, never inline in a render.
function useKoutsiTabRoute(slugs, fallback) {
  const base = React.useMemo(koutsiRouteBase, []);
  const readTab = React.useCallback(() => {
    if (!base) return fallback;
    let seg = window.location.pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
    try { seg = decodeURIComponent(seg); } catch { /* a broken %-escape is simply not a view */ }
    return Object.keys(slugs).find((id) => slugs[id] === seg) || fallback;
  }, [base, slugs, fallback]);

  const [tab, setTabState] = React.useState(readTab);
  // The view the address bar is currently showing. Starts unset so the first sync
  // replaces rather than pushes — landing on the app should not leave a history entry
  // that the back button has to chew through before it can leave.
  const shown = React.useRef(null);
  const replaceNext = React.useRef(false);

  React.useEffect(() => {
    if (!base || shown.current === tab) return;
    const url = base + '/' + encodeURIComponent(slugs[tab] || slugs[fallback]) + window.location.search + window.location.hash;
    if (shown.current === null || replaceNext.current) window.history.replaceState({ koutsiTab: tab }, '', url);
    else window.history.pushState({ koutsiTab: tab }, '', url);
    shown.current = tab;
    replaceNext.current = false;
  }, [base, tab, slugs, fallback]);

  React.useEffect(() => {
    if (!base) return undefined;
    const onPop = () => {
      const next = readTab();
      shown.current = next; // the browser already moved the address bar; do not push it back
      setTabState(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [base, readTab]);

  // { replace: true } for a correction rather than a move — swapping out a view the person
  // cannot actually open should not become a back-button stop.
  const setTab = React.useCallback((next, opts) => {
    if (opts && opts.replace) replaceNext.current = true;
    setTabState(next);
  }, []);

  return [tab, setTab];
}

Object.assign(window, {
  KoutsiUIProvider, KoutsiToastProvider, KoutsiConfirmProvider,
  useKoutsiToast, useKoutsiConfirm,
  KoutsiIconButton, KoutsiRowActions, KoutsiEditIcon, KoutsiTrashIcon, KoutsiTimeSelect,
  KoutsiAttendanceBadge, KoutsiAttendanceModal,
  KoutsiQrCode, KoutsiCopyButton, koutsiCopyText,
  KoutsiNotificationBell, KoutsiEmailPrefToggle,
  KoutsiDeleteAccountButton, KoutsiLegalLinks,
  useKoutsiTabRoute,
});
