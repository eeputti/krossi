// account.jsx — settings both roles share: email notifications, feedback, data export, account
// deletion, legal links, going back to the old Koutsi, signing out.
import { useEffect, useState } from 'react';
import { api, isDemo } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { Button, ChipSelect, Field, Icon, ListRow, Sheet, Textarea, Toggle, useConfirm, useToast } from '../ui/index.js';
import { FEEDBACK_CATEGORIES, SUPPORT_EMAIL } from '../lib/constants.js';
import { EMAIL_CHOICES, withChoice } from '../domain/emailPrefs.js';

/** Profiili → Sähköpostit: all e-mails on or off, and each kind on its own. Saves at once. */
export function EmailPrefs({ uid, role = 'player' }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    let alive = true;
    api.notifications.getEmailPrefs(uid).then((v) => alive && setPrefs(v)).catch(() => alive && setPrefs({ enabled: true, off: [] }));
    return () => { alive = false; };
  }, [uid]);
  if (prefs === null) return null;
  const save = async (next) => {
    const before = prefs;
    setPrefs(next);
    try { await api.notifications.setEmailPrefs(uid, next); toast('Sähköpostiasetukset tallennettu.'); } catch (err) { setPrefs(before); toast(err); }
  };
  const choices = EMAIL_CHOICES[role] || EMAIL_CHOICES.player;
  return (
    <div className="email-prefs">
      <Toggle icon="mail" checked={prefs.enabled} onChange={(on) => save({ ...prefs, enabled: on })} label="Sähköpostit"
        hint={prefs.enabled ? 'Valitse alta, mitkä haluat. Sovelluksen kello näyttää kaiken joka tapauksessa.' : 'Et saa sähköposteja. Sovelluksen kello näyttää kaiken.'} />
      {prefs.enabled && (
        <div className="email-prefs-list">
          {choices.map((c) => (
            <Toggle key={c.id} checked={!prefs.off.includes(c.id)} label={c.label} hint={c.hint}
              onChange={(on) => save({ ...prefs, off: withChoice(prefs.off, c.id, on) })} />
          ))}
          <p className="email-prefs-note">Useammat asiat tulevat yhtenä koosteena, korkeintaan kolmen tunnin välein eikä yöllä.</p>
        </div>
      )}
    </div>
  );
}

/** Anna palautetta: what it is about, the words, and a clear thank-you once it has arrived. */
export function FeedbackSheet({ open, onClose, uid }) {
  const toast = useToast();
  const [category, setCategory] = useState(FEEDBACK_CATEGORIES[0].id);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => { if (open) { setCategory(FEEDBACK_CATEGORIES[0].id); setMessage(''); setSent(false); } }, [open]);
  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      await api.account.submitFeedback(uid, { category, message: message.trim() });
      setSent(true);
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  if (sent) {
    return (
      <Sheet open={open} onClose={onClose} size="sm" title="Anna palautetta"
        footer={<Button variant="dark" size="lg" block onClick={onClose}>Sulje</Button>}>
        <div className="fb-thanks" role="status">
          <span className="fb-thanks-icon"><Icon name="check" size={28} strokeWidth={3} /></span>
          <strong className="fb-thanks-title">Kiitos palautteestasi!</strong>
          <span className="fb-thanks-text">Palaute vastaanotettu!</span>
        </div>
      </Sheet>
    );
  }
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Anna palautetta" subtitle="Kerro, mikä sovelluksessa toimii ja mikä ei. Kaikenlainen palaute on tärkeää!" size="md" dismissible={!busy} confirmClose={Boolean(message.trim())}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" missing={!message.trim() ? 'Kirjoita palautteesi ensin.' : null} loading={busy} onClick={send}>Lähetä</Button></div>}>
      <div className="stack-4">
        <Field label="Mistä on kyse?"><ChipSelect size="sm" options={FEEDBACK_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))} value={category} onChange={(v) => v && setCategory(v)} ariaLabel="Aihe" /></Field>
        <Field label="Kertoisitko hieman tarkemmin?" htmlFor="fb-msg"><p className="fb-help">Tämä auttaa kehittämään koko sovellusta eteenpäin!</p><Textarea id="fb-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Mitä huomasit?" maxLength={4000} /></Field>
      </div>
    </Sheet>
  );
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * The bottom of a profile page: feedback, export, legal, back to the old app, sign out, delete.
 * `role` is 'coach' | 'player'.
 */
export function AccountSection({ role, uid, profileName }) {
  const { signOut } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const base = role === 'coach' ? '/valmentaja' : '/pelaaja';

  const exportData = async () => {
    setExporting(true);
    try {
      const payload = await api.account.exportMyData(uid, role);
      downloadJson(payload, `koutsi-tiedot-${new Date().toISOString().slice(0, 10)}.json`);
      toast('Tietosi ladattiin JSON-tiedostona.');
    } catch (err) { toast(err); } finally { setExporting(false); }
  };
  const deleteAccount = async () => {
    const ok = await confirm({
      title: 'Poista tili ja kaikki tiedot',
      message: 'Tämä poistaa pysyvästi tilisi, profiilisi sekä kaikki Koutsiin tallennetut merkinnät, läksyt, videot ja ryhmätiedot. Sama tunnus on käytössä myös Krossissa, joten myös Krossi-tilisi poistuu. Toimintoa ei voi perua.',
      confirmLabel: 'Poista lopullisesti', danger: true, typeToConfirm: profileName || 'POISTA',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.account.deleteAccount();
      window.location.href = 'https://koutsi.krossi.app';
    } catch (err) { toast(err); setDeleting(false); }
  };
  return (
    <div className="stack-5">
      <button type="button" className="k-feedback-cta" onClick={() => setFeedbackOpen(true)}>
        <span className="k-feedback-cta-icon"><Icon name="chat" size={20} /></span>
        <span className="k-feedback-cta-text">
          <span className="k-feedback-cta-title">Anna palautetta</span>
          <span className="k-feedback-cta-sub">Kerro, mikä tässä sovelluksessa toimii ja mikä ei. Pienikin huomio auttaa tekemään Koutsista paremman.</span>
        </span>
        <Icon name="chevron-right" size={18} className="k-feedback-cta-chevron" />
      </button>
      <div className="list-group">
        <ListRow icon="download" title={exporting ? 'Valmistellaan…' : 'Lataa tietoni'} subtitle="Kaikki näkemäsi tiedot JSON-tiedostona" onClick={exporting ? undefined : exportData} />
        <ListRow icon="shield" title="Tietosuojaseloste" href="/tietosuoja" />
        <ListRow icon="list" title="Käyttöehdot" href="/kayttoehdot" />
        <ListRow icon="mail" title="Ota yhteyttä" subtitle={SUPPORT_EMAIL} href={`mailto:${SUPPORT_EMAIL}?subject=Krossi%20Koutsi`} />
      </div>
      <div className="list-group">
        {!isDemo && <ListRow icon="undo" title="Palaa vanhaan Koutsiin" subtitle="Pääset takaisin vanhan Koutsin Siirry uuteen -napista" href={`${base}?uusi=0`} />}
        <ListRow icon="logout" title="Kirjaudu ulos" onClick={signOut} />
        <ListRow icon="trash" tone="danger" title={deleting ? 'Poistetaan…' : 'Poista tili ja tiedot'} onClick={deleting ? undefined : deleteAccount} />
      </div>
      <FeedbackSheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} uid={uid} />
    </div>
  );
}
