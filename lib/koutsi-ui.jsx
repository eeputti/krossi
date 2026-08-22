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
    <button onClick={onClick} title={label} aria-label={label} style={{
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

Object.assign(window, {
  KoutsiUIProvider, KoutsiToastProvider, KoutsiConfirmProvider,
  useKoutsiToast, useKoutsiConfirm,
  KoutsiIconButton, KoutsiRowActions, KoutsiEditIcon, KoutsiTrashIcon,
  KoutsiQrCode, KoutsiCopyButton, koutsiCopyText,
  KoutsiNotificationBell, KoutsiEmailPrefToggle,
  KoutsiDeleteAccountButton, KoutsiLegalLinks,
});
