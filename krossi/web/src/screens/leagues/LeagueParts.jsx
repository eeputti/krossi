// LeagueParts — building blocks of the league page: standings table, fixture scoreboard card,
// member list, the admin card ("olet tämän liigan ylläpitäjä") and the locked teaser for unpaid users.
import { firstName, formatDayMonth } from '../../lib/format.js';
import { Avatar, Button, Chip, Icon, ListRow } from '../../ui/index.js';
import {
  POINTS_PER_DRAW, POINTS_PER_WIN, boardSides, isHallisarja, isMyFixture, isTimed, levelLabel, movesFor, shortName,
} from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Sarjataulukko for one group. rows = computeStandings(...) / groupStandings(...)
 *   league: format decides the columns (hallisarja: V–T–H, geimiero)
 *   zones: { up: boolean, down: boolean } — mark who moves up / down (hallisarja, not the top / bottom group)
 */
export function StandingsTable({ rows, meId, onPlayer, league, zones = null }) {
  const hall = isHallisarja(league);
  const leaderHasPoints = rows[0]?.points > 0;
  const moves = movesFor(rows.length);
  const zoneOf = (i) => {
    if (!zones || rows.length < 3) return null;
    if (zones.up && i < moves) return 'up';
    if (zones.down && i >= rows.length - moves) return 'down';
    return null;
  };
  const nameOf = (p) => (p.id === meId ? 'Sinä' : hall ? shortName(p.name) : firstName(p.name));
  return (
    <div className="leagues-table-wrap">
      <table className={cx('leagues-table', hall && 'is-hall')}>
        <thead>
          <tr>
            <th scope="col" className="leagues-col-rank">#</th>
            <th scope="col" className="leagues-col-name">Pelaaja</th>
            <th scope="col" className="leagues-col-num"><abbr title="Pelatut ottelut">Pel</abbr></th>
            {hall
              ? <th scope="col" className="leagues-col-wdl"><abbr title="Voitot–tasapelit–häviöt">V–T–H</abbr></th>
              : <th scope="col" className="leagues-col-wl"><abbr title="Voitot–häviöt">V–H</abbr></th>}
            {hall
              ? <th scope="col" className="leagues-col-sets"><abbr title="Geimiero">Geim</abbr></th>
              : <th scope="col" className="leagues-col-sets">Erät</th>}
            <th scope="col" className="leagues-col-pts"><abbr title="Pisteet">Pist</abbr></th>
          </tr>
        </thead>
        <tbody className="stagger">
          {rows.map((r, i) => {
            const me = r.player.id === meId;
            const leader = i === 0 && leaderHasPoints && !zones?.up;
            const zone = zoneOf(i);
            return (
              <tr key={r.player.id} className={cx(me && 'is-me', leader && 'is-leader', zone && `is-${zone}`)} style={{ '--i': i }}>
                <td className="leagues-col-rank">
                  {leader
                    ? <span className="leagues-crown" aria-label="Kärjessä"><Icon name="crown" size={16} strokeWidth={2.2} /></span>
                    : zone
                      ? <span className={cx('leagues-zone', `is-${zone}`)} aria-label={zone === 'up' ? `${i + 1}., nousee` : `${i + 1}., putoaa`}>
                        <Icon name={zone === 'up' ? 'chevron-up' : 'chevron-down'} size={13} strokeWidth={3} /><span className="t-num">{i + 1}</span>
                      </span>
                      : <span className="t-num">{i + 1}</span>}
                </td>
                <td className="leagues-col-name">
                  {onPlayer ? (
                    <button type="button" className="leagues-table-player" onClick={() => onPlayer(r.player)}>
                      <Avatar person={r.player} size={30} />
                      <span className="leagues-table-name truncate">{nameOf(r.player)}</span>
                    </button>
                  ) : (
                    <span className="leagues-table-player is-static">
                      <Avatar person={r.player} size={30} />
                      <span className="leagues-table-name truncate">{nameOf(r.player)}</span>
                    </span>
                  )}
                </td>
                <td className="leagues-col-num t-num">{r.played}</td>
                {hall
                  ? <td className="leagues-col-wdl t-num">{r.wins}–{r.draws}–{r.losses}</td>
                  : <td className="leagues-col-wl t-num">{r.wins}–{r.losses}</td>}
                {hall
                  ? <td className="leagues-col-sets t-num" title={`Geimit ${r.gamesWon}–${r.gamesLost}`}>{signed(r.gamesWon - r.gamesLost)}</td>
                  : <td className="leagues-col-sets t-num" title={`Erät ${r.setsWon}–${r.setsLost}`}>{signed(r.setsWon - r.setsLost)}</td>}
                <td className="leagues-col-pts t-num">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="leagues-table-legend">
        {hall
          ? <>Voitto {POINTS_PER_WIN}, tasapeli {POINTS_PER_DRAW}, häviö 0 pistettä. Tasapisteissä ratkaisee geimiero, sitten keskinäinen ottelu ja voitetut geimit.{zones && (zones.up || zones.down) ? ' Nuolet: nousee tai putoaa seuraavalla kierroksella.' : ''}</>
          : <>Voitto = {POINTS_PER_WIN} pistettä. Tasapisteissä ratkaisee eräero, sitten peliero. Vain vahvistetut tulokset lasketaan.</>}
      </p>
    </div>
  );
}

/**
 * FixtureCard — tennis scoreboard for one fixture + its actions.
 *   state: fixtureState(); active: results can be reported (actions enabled)
 *   onAdmin: the league admin's "Kirjaa tulos" (shown on fixtures that aren't mine)
 */
export function FixtureCard({ fixture, meId, state, active, compact, busy, onReport, onConfirm, onChat, onAdmin, league, index = 0 }) {
  const sides = boardSides(fixture, meId);
  const mine = isMyFixture(fixture, meId);
  const played = Boolean(fixture.result);
  const draw = played && !fixture.result.winnerId;
  const opp = mine ? sides[1].player : null;
  const hall = isHallisarja(league);
  const nameOf = (p) => (p.id === meId ? 'Sinä' : hall ? shortName(p.name) : firstName(p.name));
  return (
    <article
      className={cx('leagues-fx', compact && 'is-compact', `is-${state}`, mine && 'is-mine', draw && 'is-draw')}
      style={{ '--i': index }}
    >
      <div className="leagues-fx-board">
        {sides.map((side) => (
          <div key={side.player.id} className={cx('leagues-fx-row', played && !draw && side.won && 'is-winner', played && !draw && !side.won && 'is-loser')}>
            <Avatar person={side.player} size={compact ? 26 : 32} />
            <span className="leagues-fx-name truncate">{nameOf(side.player)}</span>
            {played && side.won && <Icon name="check" size={15} strokeWidth={3} className="leagues-fx-check" />}
            <span className="leagues-fx-games t-num" aria-label={played ? `${isTimed(league) ? 'Geimit' : 'Erien pelit'} ${side.games.join(', ')}` : 'Ei tulosta'}>
              {played
                ? side.games.map((g, i) => <span key={i} className={cx('leagues-fx-set', g > sides.find((s) => s !== side).games[i] && 'is-set-won')}>{g}</span>)
                : <span className="leagues-fx-set is-empty">–</span>}
            </span>
          </div>
        ))}
        {(fixture.result?.walkover || draw) && (
          <div className="leagues-fx-tags">
            {fixture.result.walkover && <Chip tone="warn" size="sm" icon="flag">Luovutus</Chip>}
            {draw && <Chip tone="neutral" size="sm">Tasapeli</Chip>}
          </div>
        )}
      </div>

      {onAdmin && !mine ? (
        <AdminFoot fixture={fixture} state={state} active={active} onAdmin={onAdmin} />
      ) : (
        <FixtureFoot
          state={state} active={active} fixture={fixture} opp={opp} busy={busy}
          onReport={onReport} onConfirm={onConfirm} onChat={onChat}
        />
      )}
    </article>
  );
}

function AdminFoot({ fixture, state, active, onAdmin }) {
  const label = state === 'done' ? 'Korjaa' : state === 'pending' ? 'Tarkista' : 'Kirjaa tulos';
  const text = state === 'done'
    ? `Vahvistettu${fixture.result.confirmedAt ? ` ${formatDayMonth(fixture.result.confirmedAt)}` : ''}${fixture.result.setByAdmin ? ' · ylläpito' : ''}`
    : state === 'pending' ? 'Odottaa vahvistusta' : active ? 'Ei vielä pelattu' : 'Jäi pelaamatta';
  return (
    <div className="leagues-fx-foot is-admin">
      <span className={cx('leagues-fx-admin-text', state === 'done' && 'is-done')}>
        <Icon name={state === 'done' ? 'check-circle' : 'clock'} size={15} />{text}
      </span>
      <Button variant={state === 'pending' ? 'lime' : 'ghost'} size="sm" icon="edit" onClick={onAdmin}>{label}</Button>
    </div>
  );
}

function FixtureFoot({ state, active, fixture, opp, busy, onReport, onConfirm, onChat }) {
  const oppName = firstName(opp?.name);
  if (state === 'done') {
    return (
      <div className="leagues-fx-foot is-status">
        <Icon name="check-circle" size={15} />
        <span>
          Vahvistettu{fixture.result.confirmedAt ? ` ${formatDayMonth(fixture.result.confirmedAt)}` : ''}
          {fixture.result.setByAdmin ? ' · ylläpitäjä kirjasi' : ''}
        </span>
      </div>
    );
  }
  if (state === 'pending') {
    return <div className="leagues-fx-foot is-status is-muted"><Icon name="clock" size={15} /><span>Odottaa vahvistusta</span></div>;
  }
  if (state === 'waiting') {
    return (
      <div className="leagues-fx-foot">
        <Chip tone="warn" size="sm" icon="clock">Odottaa vastustajan vahvistusta</Chip>
      </div>
    );
  }
  if (state === 'confirm') {
    return (
      <div className="leagues-fx-foot is-callout">
        <p className="leagues-fx-callout"><strong>{oppName}</strong> ilmoitti tuloksen. Täsmääkö?</p>
        <div className="leagues-fx-actions">
          <Button variant="ghost" size="sm" icon="chat" onClick={onChat}>Ei täsmää</Button>
          <Button variant="lime" size="sm" icon="check" loading={busy} onClick={onConfirm}>Vahvista tulos</Button>
        </div>
      </div>
    );
  }
  // open
  if (!opp) return <div className="leagues-fx-foot is-status is-muted"><span>Ei vielä pelattu</span></div>;
  if (!active) return <div className="leagues-fx-foot is-status is-muted"><span>Jäi pelaamatta</span></div>;
  return (
    <div className="leagues-fx-foot">
      <div className="leagues-fx-actions is-split">
        <Button variant="soft" size="sm" icon="chat" loading={busy} onClick={onChat}>Sovi peli</Button>
        <Button variant="dark" size="sm" icon="trophy" onClick={onReport}>Ilmoita tulos</Button>
      </div>
    </div>
  );
}

/** Member list (sign-up, or a hallisarja's players). */
export function MemberList({ members, meId, createdBy, onPlayer, hall }) {
  return (
    <div className="list-group leagues-members stagger">
      {members.map((m, i) => {
        const me = m.id === meId;
        const tags = [];
        if (m.id === createdBy) tags.push(<Chip key="admin" tone="lime" size="sm" icon="crown">Ylläpitäjä</Chip>);
        if (hall && m.continues === false) tags.push(<Chip key="stop" tone="neutral" size="sm">Ei jatka</Chip>);
        return (
          <ListRow
            key={m.id}
            style={{ '--i': i }}
            leading={<Avatar person={m} size={40} />}
            title={me ? `${m.name} (sinä)` : m.name}
            subtitle={m.skillLevel ? levelLabel(m.skillLevel) : 'Taso ei tiedossa'}
            onClick={onPlayer ? () => onPlayer(m) : undefined}
            chevron={Boolean(onPlayer)}
            right={tags.length ? <span className="leagues-member-tags">{tags}</span> : undefined}
          />
        );
      })}
    </div>
  );
}

/**
 * AdminCard — tells the creator they run the league (and who may delete it), plus the next
 * admin step. children = the phase's main action button(s).
 */
export function AdminCard({ league, meId, onOpenAdmin, children }) {
  const iCreated = league.createdBy === meId;
  const kind = isHallisarja(league) ? 'sarjan' : 'liigan';
  return (
    <section className="leagues-admin rise" aria-labelledby="league-admin-title">
      <div className="leagues-admin-head">
        <span className="leagues-admin-badge" aria-hidden="true"><Icon name="shield" size={20} /></span>
        <div className="leagues-admin-headtext">
          <h2 id="league-admin-title" className="leagues-admin-title">
            {iCreated ? `Olet tämän ${kind} ylläpitäjä` : 'Moderaattorina hallitset tätä liigaa'}
          </h2>
          <p className="leagues-admin-text">
            {iCreated
              ? `Perustit ${kind}, joten olet sen ylläpitäjä. Vain sinä tai Krossin moderaattori voi poistaa sen.`
              : `${firstName(league.organizer?.name) || 'Perustaja'} on ${kind} ylläpitäjä. Krossin moderaattorina voit muokata ja poistaa sen.`}
          </p>
        </div>
      </div>
      <div className="leagues-admin-actions">
        {children}
        <Button variant="soft" icon="settings" onClick={onOpenAdmin}>Ylläpito</Button>
      </div>
    </section>
  );
}

const FAKE = [
  { name: 'Mikko', avatarColor: 'blue', w: 3, l: 0 },
  { name: 'Laura', avatarColor: 'red', w: 2, l: 1 },
  { name: 'Ville', avatarColor: 'green', w: 2, l: 2 },
  { name: 'Emilia', avatarColor: 'yellow', w: 1, l: 2 },
  { name: 'Henna', avatarColor: 'blue', w: 0, l: 3 },
];

/** Static, made-up table under the paywall blur (no real names are rendered). */
export function FakeStandings() {
  return (
    <div className="leagues-fake">
      {FAKE.map((f, i) => (
        <div key={f.name} className="leagues-fake-row">
          <span className="t-num leagues-fake-rank">{i + 1}</span>
          <Avatar name={f.name} color={f.avatarColor} size={30} />
          <span className="leagues-fake-name">{f.name}</span>
          <span className="t-num">{f.w}–{f.l}</span>
          <span className="t-num leagues-fake-pts">{f.w * POINTS_PER_WIN}</span>
        </div>
      ))}
    </div>
  );
}
