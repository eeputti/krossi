// LoginRows — Asetukset → Tili: Google and Apple as extra ways to sign in to the same account
// (the account is shared with Krossi Koutsi). Liitä sends the browser to Google / Apple (Supabase
// linkIdentity) and back to /pelaa; useLoginLinkReturn() then opens Asetukset again and says how it
// went. A linked row can be taken off (Irrota) while another way to sign in stays.
import { useEffect, useState } from 'react';
import { api, loginError } from '../../api/index.js';
import { navigate } from '../../app/router.js';
import { AppleMark, Chip, GoogleMark, ListRow, useConfirm, useToast } from '../../ui/index.js';

const KEY = 'krossi_login_link';
const BACK = '/pelaa/asetukset';
const PROVIDERS = [
  { id: 'google', name: 'Google', with: 'Googlella', Mark: GoogleMark },
  { id: 'apple', name: 'Apple', with: 'Applella', Mark: AppleMark },
];
const byId = (id) => PROVIDERS.find((p) => p.id === id);

function remember(provider) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ provider, at: Date.now() })); } catch { /* private mode: no word on return */ }
}
function forget() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
function readMark() {
  try {
    const mark = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return mark && Date.now() - mark.at < 15 * 60 * 1000 ? mark : null;
  } catch { return null; }
}
/** true while a Liitä is on its way back: the generic "link didn't work" toast stays quiet then. */
export function hasLoginLinkMark() { return Boolean(readMark()); }

const ERROR_KEYS = ['error', 'error_code', 'error_description'];
/** The provider's refusal in the address (Supabase puts it after ? or #), and the address without it. */
function takeUrlError() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const get = (k) => url.searchParams.get(k) || hash.get(k);
  if (!ERROR_KEYS.some(get)) return null;
  const err = { error_code: get('error_code') || get('error'), error_description: get('error_description') || '' };
  ERROR_KEYS.forEach((k) => { url.searchParams.delete(k); hash.delete(k); });
  const rest = hash.toString();
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${rest ? `#${rest}` : ''}`);
  return err;
}

/** In Gate, once signed in: back from Google / Apple after Liitä → Asetukset again, with a word on how it went. */
export function useLoginLinkReturn(userId) {
  const toast = useToast();
  useEffect(() => {
    if (!userId) return;
    const mark = readMark();
    forget();
    if (!mark) return;
    const p = byId(mark.provider);
    const err = takeUrlError();
    navigate(BACK, { replace: true });
    if (err) { toast(loginError(err, mark.provider)); return; }
    api.auth.getLogins()
      .then((list) => { if (p && list.some((l) => l.provider === p.id)) toast(`${p.name} liitetty. Voit nyt kirjautua myös ${p.with}.`, { icon: 'check' }); })
      .catch(() => {});
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
}

const restText = (rest) => {
  const words = rest.map((l) => (l.provider === 'email' ? 'sähköpostilla ja salasanalla' : byId(l.provider)?.with)).filter(Boolean);
  return words.length ? words.join(' tai ') : 'muilla tavoilla';
};

/** Google and Apple rows for the Tili list. */
export function LoginRows() {
  const toast = useToast();
  const confirm = useConfirm();
  const [logins, setLogins] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => api.auth.getLogins().then(setLogins).catch(() => setLogins([]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (p) => {
    if (busy) return;
    setBusy(p.id);
    remember(p.id);
    try {
      const res = await api.auth.linkLogin(p.id);
      if (res?.redirecting) { setTimeout(() => setBusy(null), 10000); return; } // the browser normally leaves first
      forget();
      await load();
      toast(`${p.name} liitetty. Voit nyt kirjautua myös ${p.with}.`, { icon: 'check' });
    } catch (err) {
      forget();
      toast(err);
    }
    setBusy(null);
  };

  const unlink = async (p) => {
    if (busy) return;
    const rest = (logins || []).filter((l) => l.provider !== p.id);
    if (!rest.length) { toast('Tämä on ainoa tapasi kirjautua, joten sitä ei voi irrottaa.', { tone: 'info' }); return; }
    const ok = await confirm({
      title: `Irrotetaanko ${p.name}?`,
      message: `Et voi enää kirjautua ${p.with}. Kirjaudu jatkossa ${restText(rest)}.${rest.some((l) => l.provider === 'email') ? ' Jos et muista salasanaa tai sinulla ei ole sitä, saat uuden Unohditko salasanan -linkistä.' : ''}`,
      confirmLabel: 'Irrota', cancelLabel: 'Peruuta', danger: true,
    });
    if (!ok) return;
    setBusy(p.id);
    try {
      await api.auth.unlinkLogin(p.id);
      await load();
      toast(`${p.name} irrotettu.`);
    } catch (err) { toast(err); }
    setBusy(null);
  };

  if (!logins) return null;
  return PROVIDERS.map((p) => {
    const linked = logins.find((l) => l.provider === p.id);
    const working = busy === p.id;
    return (
      <ListRow key={p.id}
        leading={<span className="list-row-icon"><p.Mark size={18} /></span>}
        title={p.name}
        subtitle={linked ? (linked.email || 'Liitetty') : `Kirjaudu myös ${p.with}`}
        onClick={() => (linked ? unlink(p) : link(p))}
        right={linked
          ? <Chip size="sm" tone="success" icon="check">{working ? 'Irrotetaan…' : 'Liitetty'}</Chip>
          : <Chip size="sm" tone="neutral">{working ? 'Avataan…' : 'Liitä'}</Chip>} />
    );
  });
}
