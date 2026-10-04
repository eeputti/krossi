// LeaguesScreen — /pelaa/liigat: how a Krossi league works, city picker, the city's leagues
// (join / open) and "Luo liiga".
import { useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useIsDesktop, useLocalState } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { CITIES } from '../../lib/constants.js';
import { plural } from '../../lib/format.js';
import {
  Button, Chip, ChipSelect, EmptyState, ErrorState, Icon, IconButton, Page, ProgressBar, Skeleton, TopBar,
  confetti, useToast,
} from '../../ui/index.js';
import { CreateLeagueSheet } from './CreateLeagueSheet.jsx';
import { MIN_MEMBERS_TO_START, cityIn, levelLabel, statusOf } from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');

const HOW_STEPS = [
  { title: 'Ilmoittaudu', text: 'Valitse oman tasosi liiga kaupungistasi.' },
  { title: 'Lohkot arvotaan', text: 'Kausi alkaa, kun mukana on vähintään 4 pelaajaa.' },
  { title: 'Pelaa kaikkia vastaan', text: 'Sovi pelit lohkosi pelaajien kanssa kauden aikana.' },
  { title: 'Ilmoita tulos', text: 'Kirjaa erät heti matsin jälkeen.' },
  { title: 'Vastustaja vahvistaa', text: 'Tulos päivittyy sarjataulukkoon.' },
];

/** Where the pressed button is — read synchronously (React clears currentTarget after the handler). */
export function burstOrigin(event) {
  const rect = event?.currentTarget?.getBoundingClientRect?.();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : {};
}

export function LeaguesScreen() {
  const { profile } = useSession();
  const { requirePaid } = usePaywall();
  const toast = useToast();
  const homeCity = profile?.city || profile?.areas?.[0] || CITIES[0];
  const [city, setCity] = useState(homeCity);
  const isDesktop = useIsDesktop();
  const [createOpen, setCreateOpen] = useState(false);
  const [joining, setJoining] = useState(null);
  const { data, error, loading, reload, setData } = useAsync(() => api.leagues.listByCity(city), [city]);

  const cityOptions = useMemo(() => {
    const mine = (profile?.areas?.length ? profile.areas : [homeCity]).filter((c) => CITIES.includes(c));
    return [...new Set([...mine, ...CITIES])].map((c) => ({ value: c, label: c, icon: mine.includes(c) ? 'home' : undefined }));
  }, [profile?.areas, homeCity]);

  const openCreate = () => requirePaid(() => setCreateOpen(true), 'Luo liiga');

  const join = (league, event) => {
    const at = burstOrigin(event);
    return requirePaid(async () => {
      setJoining(league.id);
      try {
        await api.leagues.join(league.id);
        confetti({ ...at, count: 70 });
        toast(`Olet mukana: ${league.seasonLabel}! 🎾`);
        setData((list) => (list || []).map((l) => (l.id === league.id ? { ...l, iAmMember: true, memberCount: l.memberCount + 1 } : l)));
      } catch (err) {
        toast(err);
      } finally {
        setJoining(null);
      }
    }, 'Liity liigaan');
  };

  const onCreated = (id) => {
    setCreateOpen(false);
    confetti();
    toast('Liiga luotu! Jaa linkki, niin saat pelaajat mukaan.', { icon: 'trophy' });
    navigate(`/pelaa/liiga/${id}`);
  };

  const leagues = data || [];

  return (
    <>
      <TopBar
        title="Liigat"
        back="/pelaa/pelit"
        actions={<IconButton icon="plus" label="Luo liiga" variant="soft" onClick={openCreate} />}
      />
      <Page className="leagues-page">
        <HowItWorks />

        <div className="leagues-city">
          <div className="leagues-city-label">Kaupunki</div>
          <ChipSelect ariaLabel="Kaupunki" layout={isDesktop ? 'wrap' : 'scroll'} size="sm" options={cityOptions} value={city} onChange={(v) => v && setCity(v)} />
        </div>

        <div className="leagues-list-head">
          <h2 className="leagues-list-title">Liigat · {city}</h2>
          {!loading && !error && leagues.length > 0 && (
            <span className="leagues-list-count t-num">{plural(leagues.length, 'liiga', 'liigaa')}</span>
          )}
        </div>

        {loading ? (
          <div className="leagues-grid" aria-busy="true" aria-label="Ladataan liigoja">
            {[0, 1].map((i) => <LeagueCardSkeleton key={i} />)}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => reload()} compact />
        ) : leagues.length === 0 ? (
          <EmptyState
            art="league"
            title="Aloita kaupunkisi ensimmäinen liiga"
            text={`${cityIn(city)} ei ole vielä liigaa. Perusta se — kun ${MIN_MEMBERS_TO_START} pelaajaa on mukana, kausi voi alkaa.`}
            action={<Button variant="lime" icon="trophy" onClick={openCreate}>Luo liiga</Button>}
          />
        ) : (
          <div className="leagues-grid stagger">
            {leagues.map((league, i) => (
              <LeagueCard key={league.id} league={league} index={i} joining={joining === league.id} onJoin={join} />
            ))}
            <button type="button" className="leagues-create-card" style={{ '--i': leagues.length }} onClick={openCreate}>
              <span className="leagues-create-card-icon"><Icon name="plus" size={22} /></span>
              <span className="leagues-create-card-text">
                <span className="leagues-create-card-title">Perusta uusi liiga</span>
                <span className="leagues-create-card-sub">Eri taso tai uusi kausi? Luo oma ja kutsu porukka.</span>
              </span>
            </button>
          </div>
        )}
      </Page>
      <CreateLeagueSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        defaultCity={city}
        defaultLevel={profile?.skillLevel}
        onCreated={onCreated}
      />
    </>
  );
}

function HowItWorks() {
  const [open, setOpen] = useLocalState('krossi_leagues_how_open', true);
  return (
    <section className={cx('leagues-how', 'court-lines', 'on-dark', !open && 'is-collapsed')} aria-labelledby="leagues-how-title">
      <div className="leagues-how-head">
        <span className="leagues-how-badge" aria-hidden="true"><Icon name="trophy" size={22} /></span>
        <div className="leagues-how-headtext">
          <div className="eyebrow">Krossi-liiga</div>
          <h1 id="leagues-how-title" className="leagues-how-title">Pelaa koko kausi oman tasosi porukassa</h1>
        </div>
        <button
          type="button"
          className="leagues-how-toggle"
          aria-expanded={open}
          aria-label={open ? 'Piilota ohje' : 'Näytä, miten liiga toimii'}
          aria-controls="leagues-how-steps"
          onClick={() => setOpen(!open)}
        >
          <span className="leagues-how-toggle-label">{open ? 'Piilota' : 'Näin se toimii'}</span>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} />
        </button>
      </div>
      {open && (
        <ol id="leagues-how-steps" className="leagues-how-steps stagger">
          {HOW_STEPS.map((s, i) => (
            <li key={s.title} className="leagues-how-step" style={{ '--i': i }}>
              <span className="leagues-how-num t-num" aria-hidden="true">{i + 1}</span>
              <span className="leagues-how-text">
                <span className="leagues-how-step-title">{s.title}</span>
                <span className="leagues-how-step-sub">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function LeagueCard({ league, index, joining, onJoin }) {
  const st = statusOf(league.status);
  const groups = Math.max(1, Math.ceil(league.memberCount / (league.groupSize || 6)));
  const missing = Math.max(0, MIN_MEMBERS_TO_START - league.memberCount);
  const open = () => navigate(`/pelaa/liiga/${league.id}`);
  return (
    <article className={cx('leagues-card', league.iAmMember && 'is-member', `is-${league.status}`)} style={{ '--i': index }}>
      <button type="button" className="leagues-card-main" onClick={open} aria-label={`Avaa liiga ${league.seasonLabel}`}>
        <div className="leagues-card-top">
          <Chip tone={st.tone} size="sm" icon={st.icon} dot={st.dot}>{st.label}</Chip>
          <Icon name="chevron-right" size={18} className="leagues-card-chevron" />
        </div>
        <h3 className="leagues-card-title">{league.seasonLabel}</h3>
        <div className="leagues-card-meta">
          <span><Icon name="target" size={15} />{levelLabel(league.skillLevel)}</span>
          <span><Icon name="pin" size={15} />{league.city}</span>
        </div>
        {league.status === 'signup' ? (
          <div className="leagues-card-progress">
            <div className="leagues-card-progress-row">
              <span className="leagues-card-count"><Icon name="users" size={15} /><span className="t-num">{league.memberCount}</span> ilmoittautunut</span>
              <span className={cx('leagues-card-need', missing === 0 && 'is-ready')}>
                {missing > 0 ? `Vielä ${missing} pelaaja${missing === 1 ? '' : 'a'}` : 'Valmis alkamaan'}
              </span>
            </div>
            <ProgressBar value={league.memberCount / MIN_MEMBERS_TO_START} tone={missing === 0 ? 'green' : 'lime'} label="Ilmoittautuneet" />
          </div>
        ) : (
          <div className="leagues-card-facts">
            <span><Icon name="users" size={15} /><span className="t-num">{league.memberCount}</span> pelaajaa</span>
            <span><Icon name="grid" size={15} />{plural(groups, 'lohko', 'lohkoa')}</span>
          </div>
        )}
      </button>
      <div className="leagues-card-foot">
        {league.iAmMember ? (
          <Chip tone="success" icon="check-circle" className="leagues-card-in pop">Olet mukana</Chip>
        ) : league.status === 'signup' ? (
          <Button variant="lime" size="sm" icon="plus" loading={joining} onClick={(e) => onJoin(league, e)}>Liity</Button>
        ) : (
          <span className="leagues-card-closed">{league.status === 'active' ? 'Ilmoittautuminen päättynyt' : 'Kausi on päättynyt'}</span>
        )}
        <button type="button" className="leagues-card-link" onClick={open}>
          {league.status === 'signup' ? 'Katso pelaajat' : 'Sarjataulukko'}
        </button>
      </div>
    </article>
  );
}

function LeagueCardSkeleton() {
  return (
    <div className="leagues-card leagues-card-skeleton">
      <div className="leagues-card-main">
        <Skeleton w={118} h={24} r={999} />
        <Skeleton w="62%" h={22} className="leagues-sk-gap" />
        <Skeleton w="44%" h={13} />
        <Skeleton w="100%" h={8} r={999} className="leagues-sk-gap" />
      </div>
      <div className="leagues-card-foot"><Skeleton w={84} h={34} r={999} /></div>
    </div>
  );
}
