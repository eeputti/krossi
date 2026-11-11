// scenes.jsx — the drawings of the intro film (IntroFilm.jsx): a phone with the real tab bar or a
// computer window with the real side nav, and one scene per place in the app.
//
// Everything is plain markup animated with CSS (intro.css): `style={at(d)}` sets when a thing
// comes in (--d) and `at(0, o)` when it goes (--o), in seconds from the start of the scene.
// The resting state of every class is how the scene ends. Names in the drawings are made up,
// apart from the viewer's own first name and initials.
import { Icon } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');
/** When a thing comes in (d) and goes (o), in scene seconds. */
const at = (d = 0, o) => (o == null ? { '--d': `${d}s` } : { '--d': `${d}s`, '--o': `${o}s` });

export const firstName = (name) => (name || '').trim().split(/\s+/)[0] || '';
const initials = (name) => (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || 'K';

// The navigation as the apps have it (coach/routes.js, player/routes.js, the side nav's links).
const NAV = {
  coach: {
    tabs: [['koti', 'home', 'Koti'], ['ryhmat', 'calendar', 'Viikkohallinta'], ['merkitse'], ['pelaajat', 'user', 'Pelaajat'], ['lisaa', 'more', 'Lisää']],
    side: [['koti', 'home', 'Koti'], ['ryhmat', 'calendar', 'Viikkohallinta'], ['suunnittele', 'grid', 'Suunnittele'], ['pelaajat', 'user', 'Pelaajat'], ['ryhmalista', 'users', 'Ryhmät']],
    lower: [['harjoitteet', 'book', 'Harjoitepankki'], ['koodit', 'link', 'Liittymiskoodini'], ['palaute', 'mail', 'Anna palautetta']],
    role: 'Valmentaja',
  },
  player: {
    tabs: [['koti', 'home', 'Koti'], ['treenit', 'calendar', 'Viikko'], ['merkitse'], ['kehitys', 'flame', 'Kehitys'], ['lisaa', 'more', 'Lisää']],
    side: [['koti', 'home', 'Koti'], ['treenit', 'calendar', 'Viikko'], ['kehitys', 'flame', 'Kehitys']],
    lower: [['ryhma', 'users', 'Ryhmäsi'], ['harjoitteet', 'play', 'Harjoitteet ja videot'], ['liity', 'plus', 'Liity ryhmään'], ['palaute', 'mail', 'Anna palautetta']],
    role: 'Pelaaja',
  },
};

/** A finger's tap: a dot that lands and fades (inside a position: relative target). */
function Tap({ d }) {
  return <span className="ki-tap" style={at(d)} />;
}

// lit: 'koti' or [['suunnittele', 0.4], ['harjoitteet', 1.2]] (lit one after another)
function litAt(lit, id) {
  if (!lit) return null;
  if (typeof lit === 'string') return lit === id ? 0.25 : null;
  const hit = lit.find(([x]) => x === id);
  return hit ? hit[1] : null;
}

/**
 * Device — the phone (tab bar) or the computer window (side nav) the scene is drawn in.
 *   lit      the place the scene is about (lights up)
 *   tap      { id, d }: a finger taps that nav item at d
 *   overlay  what opens over the screen (a sheet on a phone, a dialog on a computer)
 */
export function Device({ desktop, role, me, lit, tap, overlay, children }) {
  const nav = NAV[role] || NAV.coach;
  const item = (id, icon, label, extra) => {
    const l = litAt(lit, id);
    return (
      <span key={id} className={cx(extra, l != null && 'is-lit')} style={l != null ? { '--l': `${l}s` } : undefined}>
        <Icon name={icon} size={desktop ? 15 : 19} />
        <span className="ki-nav-label">{label}</span>
        {tap?.id === id && <Tap d={tap.d} />}
      </span>
    );
  };
  const merkitseLit = litAt(lit, 'merkitse');
  if (desktop) {
    const meLit = litAt(lit, 'profiili');
    return (
      <div className="ki-device ki-window">
        <div className="ki-window-bar"><i /><i /><i /></div>
        <div className="ki-window-body">
          <div className="ki-side">
            <div className="ki-side-logo">Krossi<span className="ki-logo-ball" /> <small>Koutsi</small></div>
            <div className="ki-side-list">{nav.side.map(([id, icon, label]) => item(id, icon, label, 'ki-side-item'))}</div>
            <span className={cx('ki-side-cta', merkitseLit != null && 'is-lit')} style={merkitseLit != null ? { '--l': `${merkitseLit}s` } : undefined}>
              <Icon name="plus" size={15} /> Merkitse
              {tap?.id === 'merkitse' && <Tap d={tap.d} />}
            </span>
            <div className="ki-side-list ki-side-lower">{nav.lower.map(([id, icon, label]) => item(id, icon, label, 'ki-side-item'))}</div>
            <span className={cx('ki-side-me', meLit != null && 'is-lit')} style={meLit != null ? { '--l': `${meLit}s` } : undefined}>
              <span className="ki-av ki-av-sm">{initials(me?.name)}</span>
              <span className="ki-side-me-copy"><b>{firstName(me?.name) || 'Profiili'}</b><small>{nav.role}</small></span>
            </span>
          </div>
          <div className="ki-main">{children}</div>
        </div>
        {overlay && <div className="ki-overlay">{overlay}</div>}
      </div>
    );
  }
  return (
    <div className="ki-device ki-phone">
      <div className="ki-notch" />
      <div className="ki-screen">{children}</div>
      <div className="ki-tabs">
        {nav.tabs.map(([id, icon, label]) => (id === 'merkitse' ? (
          <span key={id} className={cx('ki-tab ki-tab-center', merkitseLit != null && 'is-lit')} style={merkitseLit != null ? { '--l': `${merkitseLit}s` } : undefined}>
            <span className="ki-center-btn"><Icon name="plus" size={22} strokeWidth={2.4} />{tap?.id === 'merkitse' && <Tap d={tap.d} />}</span>
            <span className="ki-nav-label">Merkitse</span>
          </span>
        ) : item(id, icon, label, 'ki-tab')))}
      </div>
      {overlay && <div className="ki-overlay">{overlay}</div>}
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────────────────────

/** A sheet (phone) / dialog (computer) that opens at d over a dimmed screen; closes at o. */
function Sheet({ d, o, title, sub, children }) {
  return (
    <div className={cx('ki-layer', o != null && 'ki-out')} style={o != null ? at(0, o) : undefined}>
      <div className="ki-scrim" style={at(d)} />
      <div className="ki-sheet" style={at(d + 0.05)}>
        <span className="ki-grabber" />
        <div className="ki-sheet-title">{title}</div>
        {sub && <div className="ki-sheet-sub">{sub}</div>}
        {children}
      </div>
    </div>
  );
}

/** A quiet stand-in for a screen behind a sheet. */
function Ghost({ dark }) {
  return (
    <div className="ki-ghost">
      {dark && <div className="ki-ghost-hero" />}
      <div className="ki-ghost-line" style={{ width: '38%' }} />
      <div className="ki-ghost-card" />
      <div className="ki-ghost-card" />
      <div className="ki-ghost-card is-short" />
    </div>
  );
}

function Avatar({ text, tone = 'blue', size }) {
  return <span className={cx('ki-av', size && `ki-av-${size}`, `is-${tone}`)}>{text}</span>;
}

function Head({ title, d = 0.05, children }) {
  return (
    <div className="ki-head ki-rise" style={at(d)}>
      <span className="ki-h">{title}</span>
      {children}
    </div>
  );
}

const WEEK = ['Ma', 'Ti', 'Ke', 'To', 'Pe', 'La', 'Su'];
function DayStrip({ today = 2, dots = [2, 3, 1, 1, 2, 0, 0], d = 0.2, light }) {
  return (
    <div className={cx('ki-days', light && 'is-light', 'ki-rise')} style={at(d)}>
      {WEEK.map((w, i) => (
        <span key={w} className={cx('ki-day', i === today && 'is-today')}>
          <small>{w}</small><b>{9 + i}</b>
          <span className="ki-day-dots">{Array.from({ length: dots[i] }, (_, j) => <i key={j} />)}</span>
        </span>
      ))}
    </div>
  );
}

// ── the coach ───────────────────────────────────────────────────────────────────────────────

function CoachKoti({ name }) {
  const first = firstName(name) || 'valmentaja';
  return (
    <div className="ki-col">
      <div className="ki-hero ki-rise" style={at(0.05)}>
        <div className="ki-hero-top"><span className="ki-eyebrow-lime">Viikko 46</span><Avatar text={initials(name)} tone="lime" size="sm" /></div>
        <div className="ki-hello">Moi, {first}!</div>
        <div className="ki-swap">
          <span className="ki-out" style={at(0, 2.05)}>
            <span className="ki-btn ki-btn-lime"><Icon name="plus" size={13} /> Aseta teema<Tap d={1.45} /></span>
          </span>
          <span className="ki-theme ki-pop" style={at(2.1)}><Icon name="sparkles" size={13} /> Syöttö ja palautus</span>
        </div>
        <DayStrip d={0.25} />
      </div>
      <div className="ki-label ki-rise" style={at(0.45)}>Tänään</div>
      {[['16.30', 'Juniorit', '6 pelaajaa', 0.55, 2.45], ['18.00', 'Aikuiset', '8 pelaajaa', 0.7, 2.6]].map(([time, group, sub, d, tag]) => (
        <div key={group} className="ki-card ki-rise" style={at(d)}>
          <span className="ki-card-time">{time}</span>
          <span className="ki-card-copy"><b>{group}</b><small>{sub}</small>
            <span className="ki-tag ki-pop" style={at(tag)}><Icon name="sparkles" size={11} /> Syöttö ja palautus</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const COACH_WEEK = [
  ['Ma', [['16.30', 'Juniorit']]],
  ['Ti', [['17.30', 'Aloittelijat', true]]],
  ['Ke', [['18.00', 'Aikuiset']]],
  ['To', [['16.30', 'Juniorit']]],
  ['Pe', [['17.00', 'Kilpa']]],
];
function CoachWeek({ first }) {
  return (
    <div className="ki-week">
      {COACH_WEEK.map(([day, blocks], i) => (
        <div key={day} className="ki-wday">
          <span className="ki-wday-name">{day}</span>
          <span className="ki-wday-blocks">
            {blocks.map(([time, group, fresh]) => (
              <span key={group} className={cx('ki-block', fresh && 'is-new', 'ki-pop')} style={at(first ? (fresh ? 2.15 : 0.3 + i * 0.09) : 0)}>
                <b>{time}</b> {group}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
function CoachRyhmat() {
  return (
    <div className="ki-col">
      <Head title="Viikkohallinta">
        <span className="ki-btn ki-btn-dark ki-btn-sm"><Icon name="plus" size={12} /> Luo ryhmä<Tap d={1.5} /></span>
      </Head>
      <div className="ki-weekbar ki-rise" style={at(0.15)}>
        <Icon name="chevron-left" size={14} />
        <span className="ki-swap">
          <span className="ki-out" style={at(0, 3.55)}>Viikko 46</span>
          <span className="ki-in" style={at(3.6)}>Viikko 47</span>
        </span>
        <Icon name="chevron-right" size={14} />
      </div>
      <div className="ki-weeks">
        <div className="ki-slide-out" style={at(0, 3.5)}><CoachWeek first /></div>
        <div className="ki-slide-in" style={at(3.55)}><CoachWeek /></div>
      </div>
    </div>
  );
}

const RECORD_TILES = [
  ['user-check', 'sand', 'Läsnäolo'], ['chat', 'blue', 'Huomio'], ['check-circle', 'green', 'Kotiläksy'],
  ['play', 'clay', 'Video'], ['sparkles', 'lime', 'Teema'], ['info', 'warn', 'Tiedote'],
];
const ROLL = [['Laura N.', 'LN', 'blue'], ['Maria K.', 'MK', 'green'], ['Sanna P.', 'SP', 'yellow'], ['Tommi H.', 'TH', 'red']];
function CoachMerkitseOverlay() {
  return (
    <Sheet d={1.0} title="Merkitse" sub="Ti 16.30, Juniorit">
      <div className="ki-swap">
        <div className="ki-out" style={at(0, 3.0)}>
          <div className="ki-tiles">
            {RECORD_TILES.map(([icon, tone, label], i) => (
              <span key={label} className="ki-tile ki-pop" style={at(1.3 + i * 0.07)}>
                <span className={`ki-tile-icon is-${tone}`}><Icon name={icon} size={16} /></span>
                {label}
                {i === 0 && <Tap d={2.45} />}
              </span>
            ))}
          </div>
        </div>
        <div className="ki-in" style={at(3.05)}>
          <div className="ki-rollhead"><Icon name="user-check" size={13} /> Läsnäolo</div>
          {ROLL.map(([n, ini, tone], i) => (
            <div key={n} className="ki-row">
              <Avatar text={ini} tone={tone} size="xs" />
              <span className="ki-row-name">{n}</span>
              {i < 3
                ? <span className="ki-check" style={at(3.45 + i * 0.32)}><Icon name="check" size={11} strokeWidth={3} /></span>
                : <span className="ki-row-note ki-in" style={at(4.5)}>Ei pääse</span>}
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

const PLAYERS = [['Laura Niemi', 'LN', 'blue'], ['Maria Koski', 'MK', 'green'], ['Sanna Peltola', 'SP', 'yellow'], ['Tommi Heino', 'TH', 'red']];
function CoachPelaajat() {
  return (
    <div className="ki-col">
      <Head title="Pelaajat">
        <span className="ki-btn ki-btn-outline ki-btn-sm"><Icon name="send" size={12} /> Kutsu<Tap d={1.15} /></span>
      </Head>
      <div className="ki-search ki-rise" style={at(0.15)}><Icon name="search" size={13} /> Hae pelaajaa</div>
      {PLAYERS.map(([n, ini, tone], i) => (
        <div key={n} className="ki-row ki-row-card ki-rise" style={at(0.3 + i * 0.08)}>
          <Avatar text={ini} tone={tone} size="sm" />
          <span className="ki-row-name"><b>{n}</b><small>Juniorit</small></span>
          <span className="ki-swap ki-row-end">
            <span className="ki-out" style={at(0, 3.75 + i * 0.18)}><span className="ki-chip">Ei liittynyt</span></span>
            <span className="ki-pop" style={at(3.8 + i * 0.18)}><span className="ki-chip is-lime"><Icon name="check" size={10} strokeWidth={3} /> Liittyi</span></span>
          </span>
        </div>
      ))}
    </div>
  );
}
function CoachPelaajatOverlay() {
  return (
    <Sheet d={1.4} o={3.3} title="Kutsu pelaajat" sub="Liittynyt pelaaja näkee viikon teeman, treenit ja oman kehityksensä.">
      <div className="ki-linkrow ki-rise" style={at(1.7)}>
        <span className="ki-linkrow-icon"><Icon name="link" size={14} /></span>
        <span><b>Juniorit</b><small>Ryhmän liittymislinkki</small></span>
      </div>
      <span className="ki-btn ki-btn-lime ki-btn-block ki-rise" style={at(1.85)}><Icon name="share" size={13} /> Jaa viesti<Tap d={2.3} /></span>
      <div className="ki-bubble" style={at(2.55)}>Liity Juniorit-ryhmään Koutsissa! koutsi.krossi.app/…</div>
    </Sheet>
  );
}

function MoreRows({ rows, d }) {
  return (
    <div className="ki-rows">
      {rows.map(([icon, title, sub], i) => (
        <div key={title} className="ki-more-row ki-rise" style={at(d + i * 0.09)}>
          <span className="ki-more-icon">{icon === 'me' ? <span className="ki-av ki-av-xs is-lime">{sub}</span> : <Icon name={icon} size={14} />}</span>
          <span><b>{title}</b>{icon !== 'me' && <small>{sub}</small>}</span>
          <Icon name="chevron-right" size={13} />
        </div>
      ))}
    </div>
  );
}

// ── the player ──────────────────────────────────────────────────────────────────────────────

function PlayerKoti({ name }) {
  const first = firstName(name) || 'pelaaja';
  return (
    <div className="ki-col">
      <div className="ki-head ki-rise" style={at(0.05)}>
        <span className="ki-hello-ink">Moi, {first}!</span>
        <Avatar text={initials(name)} tone="lime" size="sm" />
      </div>
      <div className="ki-hero ki-rise" style={at(0.3)}>
        <span className="ki-eyebrow-lime">Seuraava treeni</span>
        <div className="ki-next-time">Ti klo 16.30</div>
        <div className="ki-next-sub">Juniorit, tennishalli</div>
        <span className="ki-theme ki-pop" style={at(1.3)}><Icon name="sparkles" size={13} /> Teema: Syöttö ja palautus</span>
      </div>
      <div className="ki-note ki-rise" style={at(2.15)}>
        <span className="ki-note-head"><Avatar text="V" tone="ink" size="xs" /> Valmentajalta</span>
        <span className="ki-note-text">Hyvä nousu syötössä! Jatketaan samaa tiistaina.</span>
      </div>
    </div>
  );
}

function PlayerViikko() {
  const rows = [
    ['Ti 10.11.', '16.30', 'Juniorit', 'Syöttö ja palautus', 0.4],
    ['To 12.11.', '17.30', 'Juniorit', 'Syöttö ja palautus', 0.5, true],
    ['La 14.11.', '', 'Oma treeni: lenkki', '', 0.6],
  ];
  return (
    <div className="ki-col">
      <Head title="Viikko 46" />
      <DayStrip light d={0.15} today={1} dots={[0, 1, 0, 1, 0, 1, 0]} />
      {rows.map(([day, time, what, theme, d, absent]) => (
        <div key={day} className={cx('ki-card ki-rise', absent && 'ki-card-absent')} style={at(d)}>
          <span className="ki-card-time"><small>{day.split(' ')[0]}</small>{time || <Icon name="flame" size={14} />}</span>
          <span className="ki-card-copy"><b>{what}</b>{theme && <small><Icon name="sparkles" size={10} /> {theme}</small>}
            {absent && <span className="ki-tag is-off ki-pop" style={at(3.05)}>Et pääse, valmentaja tietää</span>}
          </span>
          {absent && <Tap d={1.45} />}
        </div>
      ))}
    </div>
  );
}
function PlayerViikkoOverlay() {
  return (
    <Sheet d={1.75} o={2.85} title="To 12.11. klo 17.30" sub="Juniorit. Teema: Syöttö ja palautus">
      <span className="ki-btn ki-btn-outline ki-btn-block"><Icon name="close" size={13} /> En pääse<Tap d={2.35} /></span>
    </Sheet>
  );
}

const MOODS = ['Raskas', 'Vaisu', 'Ihan ok', 'Hyvä', 'Loistava']; // MOOD_LABELS
const ACTIVITIES = [['racket', 'Tennis'], ['trophy', 'Ottelu'], ['bolt', 'Sali'], ['flame', 'Lenkki']];
function PlayerMerkitseOverlay() {
  return (
    <Sheet d={1.0} title="Merkitse">
      <div className="ki-mood ki-rise" style={at(1.3)}>
        <div className="ki-mood-head"><b>Miten meni?</b><small>Ti 16.30, Juniorit</small></div>
        <div className="ki-mood-row">
          {MOODS.map((m, i) => (
            <span key={m} className={cx('ki-mood-dot', i === 3 && 'is-picked')} style={i === 3 ? at(2.35) : undefined}>
              {i + 1}{i === 3 && <Tap d={2.1} />}
            </span>
          ))}
        </div>
        <div className="ki-mood-said ki-in" style={at(2.45)}>Hyvä</div>
      </div>
      <div className="ki-label">Mitä teit?</div>
      <div className="ki-tiles ki-tiles-4">
        {ACTIVITIES.map(([icon, label], i) => (
          <span key={label} className="ki-tile ki-pop" style={at(1.5 + i * 0.07)}>
            <span className="ki-tile-icon is-sand"><Icon name={icon} size={16} /></span>{label}
          </span>
        ))}
      </div>
    </Sheet>
  );
}

function PlayerKehitys() {
  const weeks = [['Vk 44', 'Syöttö', 0.8], ['Vk 45', 'Palautus', 1.25], ['Vk 46', 'Syöttö ja palautus', 1.7]];
  return (
    <div className="ki-col">
      <Head title="Kehitys" />
      <div className="ki-goal ki-rise" style={at(0.25)}>
        <span className="ki-goal-icon"><Icon name="target" size={16} /></span>
        <span><small>Tavoite</small><b>Varma toinen syöttö</b></span>
      </div>
      <div className="ki-timeline">
        <span className="ki-timeline-line" style={at(0.6)} />
        {weeks.map(([w, theme, d], i) => (
          <div key={w} className="ki-tl-item ki-rise" style={at(d)}>
            <span className={cx('ki-tl-dot', i === weeks.length - 1 && 'is-now')} />
            <span className="ki-tl-copy"><small>{w}</small><b>{theme}</b><span className="ki-tl-meta">{i + 2} treeniä, fiilis {['ihan ok', 'hyvä', 'loistava'][i]}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── the films ───────────────────────────────────────────────────────────────────────────────

/** The coach's film: Koti, Viikkohallinta, Merkitse, Pelaajat, Lisää (side nav on a computer). */
export function coachScenes({ name, desktop }) {
  const first = firstName(name);
  return [
    {
      id: 'koti', lit: 'koti', ms: 6200,
      eyebrow: first ? `Tervetuloa, ${first}!` : 'Tervetuloa!',
      title: 'Koti kokoaa viikkosi',
      text: 'Päivän treenit ja viikon teema yhdellä silmäyksellä. Kirjoita teema kerran, niin pelaajat näkevät sen jo ennen treeniä.',
      screen: <CoachKoti name={name} />,
    },
    {
      id: 'ryhmat', lit: 'ryhmat', ms: 6000,
      eyebrow: <Where icon="calendar" label="Viikkohallinta" />,
      title: 'Ryhmät ja treenit kalenteriin',
      text: 'Luo ryhmä ja valitse sille päivä ja kellonaika. Treenit ilmestyvät kalenteriin joka viikolle.',
      screen: <CoachRyhmat />,
    },
    {
      id: 'merkitse', lit: 'merkitse', tap: { id: 'merkitse', d: 0.6 }, ms: 6600,
      eyebrow: <Where icon="plus" label="Merkitse" />,
      title: 'Merkitse treenin jälkeen',
      text: desktop
        ? 'Sivupalkin Merkitse-napista: läsnäolot, huomio, kotiläksy tai video. Treenin jälkeen ryhmä on valmiina.'
        : 'Iso nappi keskellä: läsnäolot, huomio, kotiläksy tai video. Treenin jälkeen ryhmä on valmiina.',
      screen: <Ghost dark />,
      overlay: <CoachMerkitseOverlay />,
    },
    {
      id: 'pelaajat', lit: 'pelaajat', ms: 6400,
      eyebrow: <Where icon="user" label="Pelaajat" />,
      title: 'Kutsu pelaajat mukaan',
      text: 'Kutsu-napista saat ryhmän linkin. Lähetä se vaikka WhatsAppiin, niin pelaaja näkee teeman, treenit ja oman kehityksensä.',
      screen: <CoachPelaajat />,
      overlay: <CoachPelaajatOverlay />,
    },
    desktop ? {
      id: 'lisaa', lit: [['suunnittele', 0.35], ['harjoitteet', 1.0], ['koodit', 1.65], ['profiili', 2.3]], ms: 5600,
      eyebrow: <Where icon="list" label="Sivupalkki" />,
      title: 'Kaikki muu sivupalkissa',
      text: 'Suunnittele, harjoitepankki, liittymiskoodit ja profiili. Sieltä voit myös antaa palautetta.',
      screen: <Ghost dark />,
    } : {
      id: 'lisaa', lit: 'lisaa', tap: { id: 'lisaa', d: 0.55 }, ms: 5600,
      eyebrow: <Where icon="more" label="Lisää" />,
      title: 'Loput löydät Lisää-valikosta',
      text: 'Liittymiskoodit, harjoitepankki, Suunnittele ja profiili. Sieltä voit myös antaa palautetta.',
      screen: <Ghost dark />,
      overlay: (
        <Sheet d={0.85} title="Lisää">
          <MoreRows d={1.1} rows={[
            ['link', 'Liittymiskoodini', 'Ryhmien koodit pelaajille'], ['book', 'Harjoitepankki', '209 harjoitetta'],
            ['grid', 'Suunnittele', 'Teemat monelle viikolle'], ['users', 'Ryhmät', 'Kaikki ryhmät listana'],
            ['me', 'Profiili', initials(name)], ['chat', 'Anna palautetta', 'Kerro, mikä toimii'],
          ]} />
        </Sheet>
      ),
    },
  ];
}

/** The player's film: Koti, Viikko, Merkitse, Kehitys, Lisää (side nav on a computer). */
export function playerScenes({ name, desktop }) {
  const first = firstName(name);
  return [
    {
      id: 'koti', lit: 'koti', ms: 5800,
      eyebrow: first ? `Moi, ${first}!` : 'Tervetuloa!',
      title: 'Koti näyttää seuraavan treenin',
      text: 'Näet treenin teeman ja sen, mitä valmentaja on sinulle kertonut.',
      screen: <PlayerKoti name={name} />,
    },
    {
      id: 'treenit', lit: 'treenit', ms: 6000,
      eyebrow: <Where icon="calendar" label="Viikko" />,
      title: 'Viikon treenit yhdellä silmäyksellä',
      text: 'Etkö pääse? Napauta treeniä ja valitse En pääse, niin valmentaja tietää.',
      screen: <PlayerViikko />,
      overlay: <PlayerViikkoOverlay />,
    },
    {
      id: 'merkitse', lit: 'merkitse', tap: { id: 'merkitse', d: 0.6 }, ms: 6000,
      eyebrow: <Where icon="plus" label="Merkitse" />,
      title: 'Merkitse oma treeni tai ottelu',
      text: desktop
        ? 'Sivupalkin Merkitse-napista. Treenin jälkeen se kysyy, miten meni.'
        : 'Iso nappi keskellä. Treenin jälkeen se kysyy, miten meni.',
      screen: <Ghost dark />,
      overlay: <PlayerMerkitseOverlay />,
    },
    {
      id: 'kehitys', lit: 'kehitys', ms: 5600,
      eyebrow: <Where icon="flame" label="Kehitys" />,
      title: 'Näe, miten kehityt',
      text: 'Tavoitteesi ja kaikki treenisi teemoineen samalla aikajanalla. Valmentajasi näkee tavoitteesi.',
      screen: <PlayerKehitys />,
    },
    desktop ? {
      id: 'lisaa', lit: [['ryhma', 0.35], ['harjoitteet', 1.0], ['liity', 1.65], ['profiili', 2.3]], ms: 5400,
      eyebrow: <Where icon="list" label="Sivupalkki" />,
      title: 'Kaikki muu sivupalkissa',
      text: 'Ryhmäsi, harjoitteet ja videot, liittyminen uuteen ryhmään ja profiili.',
      screen: <Ghost dark />,
    } : {
      id: 'lisaa', lit: 'lisaa', tap: { id: 'lisaa', d: 0.55 }, ms: 5400,
      eyebrow: <Where icon="more" label="Lisää" />,
      title: 'Loput löydät Lisää-valikosta',
      text: 'Ryhmäsi, harjoitteet ja videot, liittyminen uuteen ryhmään ja profiili.',
      screen: <Ghost dark />,
      overlay: (
        <Sheet d={0.85} title="Lisää">
          <MoreRows d={1.1} rows={[
            ['users', 'Ryhmäsi', 'Juniorit, ti klo 16.30'], ['play', 'Harjoitteet ja videot', 'Valmentajan videot ja omasi'],
            ['plus', 'Liity ryhmään', 'Liittymiskoodilla'], ['me', 'Profiili', initials(name)], ['chat', 'Anna palautetta', 'Kerro, mikä toimii'],
          ]} />
        </Sheet>
      ),
    },
  ];
}

/** "Missä": the place's icon and name above the scene's title. */
function Where({ icon, label }) {
  return <span className="ki-where"><Icon name={icon} size={13} /> {label}</span>;
}
