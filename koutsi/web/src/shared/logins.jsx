// logins.jsx — Profiili → Tili: Google and Apple as extra ways to sign in to the same account.
// Liitä sends the browser to Google / Apple (Supabase linkIdentity) and back to the app's own
// sign-in address; useLoginLinkReturn() then opens the profile again and says how it went.
// A linked row can be taken off (Irrota) while another way to sign in stays.
import { useEffect, useState } from 'react';
import { api, loginError } from '../api/index.js';
import { navigate } from '../app/router.js';
import { AppleMark, GoogleMark, ListRow, useConfirm, useToast } from '../ui/index.js';

const KEY = 'koutsi_login_link';
const PROVIDERS = [
  { id: 'google', name: 'Google', with: 'Googlella', Mark: GoogleMark },
  { id: 'apple', name: 'Apple', with: 'Applella', Mark: AppleMark },
];
const byId = (id) => PROVIDERS.find((p) => p.id === id);

function remember(provider, back) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ provider, back, at: Date.now() })); } catch { /* private mode: no word on return */ }
}
function forget() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
function takeMark() {
  try {
    const mark = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    sessionStorage.removeItem(KEY);
    return mark && Date.now() - mark.at < 15 * 60 * 1000 ? mark : null;
  } catch { return null; }
}

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

/** In the app shell: back from Google / Apple after Liitä → the profile again, with a word on how it went. */
export function useLoginLinkReturn() {
  const toast = useToast();
  useEffect(() => {
    const mark = takeMark();
    if (!mark) return;
    const p = byId(mark.provider);
    const err = takeUrlError();
    if (mark.back) navigate(mark.back, { replace: true });
    if (err) { toast(loginError(err, mark.provider)); return; }
    api.auth.getLogins()
      .then((list) => { if (p && list.some((l) => l.provider === p.id)) toast(`${p.name} liitetty. Voit nyt kirjautua myös ${p.with}.`); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

const restText = (rest) => {
  const words = rest.map((l) => (l.provider === 'email' ? 'sähköpostilla ja salasanalla' : byId(l.provider)?.with)).filter(Boolean);
  return words.length ? words.join(' tai ') : 'muilla tavoilla';
};

/**
 * Google and Apple rows for the Tili list. `home` is the app's sign-in address (/valmentaja,
 * /pelaaja): the providers return there, as after signing in. `back` is this profile page.
 */
export function LoginRows({ home, back }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [logins, setLogins] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = () => api.auth.getLogins().then(setLogins).catch(() => setLogins([]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (p) => {
    if (busy) return;
    setBusy(p.id);
    remember(p.id, back);
    try {
      const res = await api.auth.linkLogin(p.id, `${window.location.origin}${home}`);
      if (res?.redirecting) { setTimeout(() => setBusy(null), 10000); return; } // the browser normally leaves first
      forget();
      await load();
      toast(`${p.name} liitetty. Voit nyt kirjautua myös ${p.with}.`);
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
      confirmLabel: 'Irrota', danger: true,
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
    const opening = busy === p.id;
    return (
      <ListRow key={p.id} className="k-login-row"
        leading={<span className="list-row-icon"><p.Mark size={18} /></span>}
        title={p.name}
        subtitle={linked ? (linked.email || 'Liitetty') : `Kirjaudu myös ${p.with}`}
        onClick={() => (linked ? unlink(p) : link(p))}
        right={linked
          ? <span className="chip chip-sm chip-success">{opening ? 'Irrotetaan…' : 'Liitetty'}</span>
          : <span className="k-textlink">{opening ? `Avataan…` : 'Liitä'}</span>} />
    );
  });
}
