// SettingsScreen — /pelaa/asetukset: email notifications, account, visibility, privacy, sign out.
import { useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { SUPPORT_EMAIL } from '../../lib/constants.js';
import { Button, Chip, ErrorState, ListRow, Page, Skeleton, Toggle, TopBar, useConfirm, useToast } from '../../ui/index.js';
import { InviteSheet } from '../shared/InviteSheet.jsx';
import { LegalSheet } from '../shared/LegalSheet.jsx';
import { profileToInput } from './profileForm.js';

const cx = (...c) => c.filter(Boolean).join(' ');

const EMAIL_TYPES = [
  { key: 'playRequests', icon: 'racket', label: 'Pelipyynnöt', hint: 'Kun joku pyytää sinua pelaamaan' },
  { key: 'messages', icon: 'chat', label: 'Viestit', hint: 'Uudet viestit keskusteluissasi' },
  { key: 'areaGames', icon: 'pin', label: 'Uudet pelit alueellasi', hint: 'Kun kaupunkiisi julkaistaan uusi peli' },
  { key: 'gameJoins', icon: 'users', label: 'Liittymiset', hint: 'Kun joku liittyy peliisi' },
  { key: 'gameInvites', icon: 'mail', label: 'Kutsut', hint: 'Kun sinut kutsutaan peliin' },
  { key: 'playingNow', icon: 'bolt', label: '"Pelaan nyt" -viestit', hint: 'Kun joku lähistöllä haluaa pelata heti' },
];

const IDENTITY_LABELS = { email: 'Sähköposti', google: 'Google', apple: 'Apple' };

function Group({ title, note, children }) {
  return (
    <section className="profile-settings-group rise">
      <h2 className="profile-settings-title">{title}</h2>
      {children}
      {note && <p className="profile-settings-note">{note}</p>}
    </section>
  );
}

function EmailPrefs() {
  const toast = useToast();
  const { data: prefs, loading, error, reload, setData } = useAsync(() => api.notifications.getPrefs(), []);
  const latest = useRef(null);
  latest.current = prefs;

  const change = async (key, value) => {
    const before = latest.current;
    const next = { ...before, [key]: value };
    setData(next);
    try {
      await api.notifications.savePrefs(next);
    } catch (err) {
      setData((cur) => ({ ...cur, [key]: before[key] }));
      toast(err);
    }
  };

  if (loading) {
    return (
      <div className="list-group profile-toggle-group">
        {[0, 1, 2].map((i) => (
          <div key={i} className="profile-toggle-skeleton"><Skeleton w={34} h={34} r={10} /><span className="grow"><Skeleton w="45%" h={14} /><Skeleton w="70%" h={11} /></span><Skeleton w={46} h={28} r={14} /></div>
        ))}
      </div>
    );
  }
  if (error) return <ErrorState compact error={error} onRetry={reload} title="Ilmoitusasetukset eivät latautuneet" />;

  const on = Boolean(prefs?.emailEnabled);
  return (
    <div className="list-group profile-toggle-group">
      <Toggle icon="bell" label="Sähköposti-ilmoitukset" hint={on ? 'Saat tärkeimmät tapahtumat sähköpostiisi.' : 'Pois päältä — et saa sähköposteja Krossista.'} checked={on} onChange={(v) => change('emailEnabled', v)} />
      <div className={cx('profile-toggle-sub', !on && 'is-off')} aria-disabled={!on || undefined}>
        {EMAIL_TYPES.map((t) => (
          <Toggle key={t.key} icon={t.icon} label={t.label} hint={t.hint} checked={on && Boolean(prefs?.[t.key])} disabled={!on} onChange={(v) => change(t.key, v)} />
        ))}
      </div>
    </div>
  );
}

function Identities() {
  const { data, loading, error, reload } = useAsync(() => api.auth.getIdentities(), []);
  if (loading) return <ListRow icon="log-in" title="Kirjautumistavat" subtitle={<Skeleton w={120} h={12} />} />;
  if (error) return <ListRow icon="log-in" title="Kirjautumistavat" subtitle="Ei saatu haettua — napauta yrittääksesi uudelleen" onClick={() => reload()} right={null} />;
  const list = (data?.length ? data : ['email']).filter((id) => IDENTITY_LABELS[id]);
  return (
    <ListRow
      icon="log-in"
      title="Kirjautumistavat"
      subtitle={(
        <span className="profile-identities">
          {list.map((id) => <Chip key={id} size="sm" tone="success" icon="check">{IDENTITY_LABELS[id]}</Chip>)}
        </span>
      )}
    />
  );
}

export function SettingsScreen() {
  const { user, profile, setProfile, isAdmin, paid, refreshProfile } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [legal, setLegal] = useState({ open: false, doc: 'terms' });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [paidBusy, setPaidBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [visBusy, setVisBusy] = useState(false);

  const setVisible = async (visible) => {
    if (!profile) return;
    const before = profile;
    setVisBusy(true);
    setProfile({ ...before, hiddenFromFeed: !visible });
    try {
      const saved = await api.profile.saveMine(user.id, profileToInput(before, { hiddenFromFeed: !visible }));
      setProfile(saved);
      toast(visible ? 'Näyt taas pelaajalistassa' : 'Piilotettu pelaajalistasta', { icon: visible ? 'eye' : 'eye-off' });
    } catch (err) {
      setProfile(before);
      toast(err);
    } finally {
      setVisBusy(false);
    }
  };

  const setThisWeek = async (on) => {
    if (!profile) return;
    const before = profile;
    setProfile({ ...before, playingThisWeek: on });
    try {
      await api.profile.setPlayingThisWeek(user.id, on);
      if (on) toast('Merkitty: pelaat tällä viikolla', { icon: 'calendar' });
    } catch (err) {
      setProfile(before);
      toast(err);
    }
  };

  const togglePaid = async (on) => {
    setPaidBusy(true);
    try {
      await api.payments.adminSetOwnPaid(on);
      await refreshProfile();
      toast(on ? 'Maksullinen versio päällä' : 'Maksuton versio päällä');
    } catch (err) {
      toast(err);
    } finally {
      setPaidBusy(false);
    }
  };

  const openCookies = () => {
    if (typeof window.krossiOpenCookieSettings === 'function') window.krossiOpenCookieSettings();
    else toast('Evästeasetuksia ei voitu avata tällä sivulla.', { tone: 'error' });
  };

  const signOut = async () => {
    const ok = await confirm({ title: 'Kirjaudutaanko ulos?', message: 'Voit kirjautua takaisin milloin tahansa.', confirmLabel: 'Kirjaudu ulos', cancelLabel: 'Peruuta' });
    if (!ok) return;
    try { await api.auth.signOut(); } catch (err) { toast(err); }
  };

  const deleteAccount = async () => {
    const ok = await confirm({
      title: 'Poistetaanko tilisi pysyvästi?',
      message: 'Profiilisi, pelisi, viestisi ja ottelutuloksesi poistetaan lopullisesti. Tätä ei voi perua.',
      confirmLabel: 'Poista tili pysyvästi',
      cancelLabel: 'Peruuta',
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.profile.deleteAccount();
    } catch (err) {
      toast(err);
      setDeleting(false);
    }
  };

  const openLegal = (doc) => setLegal({ open: true, doc });

  return (
    <>
      <TopBar title="Asetukset" back="/pelaa/profiili" />
      <Page className="profile-subpage profile-settings">
        <Group title="Sähköposti-ilmoitukset" note="Mobiilisovelluksen push-ilmoitukset säädetään sovelluksen omista asetuksista.">
          <EmailPrefs />
        </Group>

        <Group title="Näkyvyys">
          <div className="list-group profile-toggle-group">
            <Toggle
              icon="eye"
              label="Näy pelaajalistassa"
              hint="Muut löytävät sinut ja voivat pyytää pelaamaan."
              checked={!profile?.hiddenFromFeed}
              disabled={!profile || visBusy}
              onChange={setVisible}
            />
            <Toggle
              icon="calendar"
              label="Pelaan tällä viikolla"
              hint="Näytät muille, että olet valmis peliin."
              checked={Boolean(profile?.playingThisWeek)}
              disabled={!profile}
              onChange={setThisWeek}
            />
          </div>
        </Group>

        <Group title="Tili">
          <div className="list-group">
            <ListRow icon="mail" title="Sähköposti" subtitle={user?.email || 'Ei sähköpostiosoitetta'} />
            <Identities />
            <ListRow icon="edit" title="Muokkaa profiilia" subtitle="Kuva, taso, ajat ja esittely" onClick={() => navigate('/pelaa/profiili/muokkaa')} />
          </div>
        </Group>

        <Group title="Yksityisyys" note="Sinulla on oikeus tarkastaa, oikaista ja poistaa omat tietosi sekä siirtää ne toiseen palveluun. Tiedot käsitellään EU-alueella.">
          <div className="list-group">
            <ListRow icon="info" title="Käyttöehdot" onClick={() => openLegal('terms')} />
            <ListRow icon="shield" title="Tietosuojaseloste" onClick={() => openLegal('privacy')} />
            <ListRow icon="sliders" title="Evästeasetukset" onClick={openCookies} />
            <ListRow icon="download" title="Omat tiedot ja poistopyynnöt" subtitle="Lähetä pyyntö sähköpostilla" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Tietosuojapyyntö')}`} />
          </div>
        </Group>

        <Group title="Muut">
          <div className="list-group">
            <ListRow icon="eye-off" title="Estetyt profiilit" onClick={() => navigate('/pelaa/asetukset/estetyt')} />
            <ListRow icon="chat" title="Ota yhteyttä tukeen" subtitle="Vastaamme yleensä saman päivän aikana" href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Krossi-tuki')}`} />
            <ListRow icon="gift" title="Kutsu kaveri" subtitle="Jaa oma kutsulinkkisi" onClick={() => setInviteOpen(true)} />
          </div>
        </Group>

        {isAdmin && (
          <Group title="Ylläpito" note="Maksutilan kytkin näkyy vain ylläpitäjille — sillä voit testata maksamattoman käyttäjän näkymiä.">
            <div className="list-group profile-toggle-group">
              <Toggle icon="euro" label="Maksullinen versio" hint={paid ? 'Käytössä: kaikki auki' : 'Pois: näet maksumuurit'} checked={paid} disabled={paidBusy} onChange={togglePaid} />
              <ListRow icon="grid" title="Ylläpito" subtitle="Tilastot ja käyttäjät" onClick={() => navigate('/pelaa/yllapito')} />
            </div>
          </Group>
        )}

        <div className="profile-settings-actions rise">
          <Button variant="outline" size="lg" block icon="logout" onClick={signOut}>Kirjaudu ulos</Button>
          <div className="list-group">
            <ListRow
              icon="trash"
              tone="danger"
              title={deleting ? 'Poistetaan tiliä…' : 'Poista tili pysyvästi'}
              subtitle="Poistaa profiilisi, pelisi, viestisi ja tuloksesi"
              onClick={deleting ? undefined : deleteAccount}
              chevron={false}
            />
          </div>
        </div>

        <p className="profile-settings-footer">Krossi · selainversio</p>
      </Page>

      <LegalSheet open={legal.open} doc={legal.doc} onClose={() => setLegal((l) => ({ ...l, open: false }))} />
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </>
  );
}
