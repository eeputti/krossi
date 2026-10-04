// LeagueParts — building blocks of the league page: standings table, fixture scoreboard card,
// member list and the locked teaser for unpaid users.
import { firstName, formatDayMonth } from '../../lib/format.js';
import { Avatar, Button, Chip, Icon, ListRow } from '../../ui/index.js';
import { POINTS_PER_WIN, boardSides, isMyFixture, levelLabel } from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/** Sarjataulukko for one group. rows = computeStandings(...) */
export function StandingsTable({ rows, meId, onPlayer }) {
  const leaderHasWins = rows[0]?.wins > 0;
  return (
    <div className="leagues-table-wrap">
      <table className="leagues-table">
        <thead>
          <tr>
            <th scope="col" className="leagues-col-rank">#</th>
            <th scope="col" className="leagues-col-name">Pelaaja</th>
            <th scope="col" className="leagues-col-num"><abbr title="Pelatut ottelut">Pel</abbr></th>
            <th scope="col" className="leagues-col-wl"><abbr title="Voitot–häviöt">V–H</abbr></th>
            <th scope="col" className="leagues-col-sets">Erät</th>
            <th scope="col" className="leagues-col-pts"><abbr title="Pisteet">Pist</abbr></th>
          </tr>
        </thead>
        <tbody className="stagger">
          {rows.map((r, i) => {
            const me = r.player.id === meId;
            const leader = i === 0 && leaderHasWins;
            return (
              <tr key={r.player.id} className={cx(me && 'is-me', leader && 'is-leader')} style={{ '--i': i }}>
                <td className="leagues-col-rank">
                  {leader
                    ? <span className="leagues-crown" aria-label="Kärjessä"><Icon name="crown" size={16} strokeWidth={2.2} /></span>
                    : <span className="t-num">{i + 1}</span>}
                </td>
                <td className="leagues-col-name">
                  <button type="button" className="leagues-table-player" onClick={() => onPlayer(r.player)}>
                    <Avatar person={r.player} size={30} />
                    <span className="leagues-table-name truncate">{me ? 'Sinä' : firstName(r.player.name)}</span>
                  </button>
                </td>
                <td className="leagues-col-num t-num">{r.played}</td>
                <td className="leagues-col-wl t-num">{r.wins}–{r.losses}</td>
                <td className="leagues-col-sets t-num" title={`Erät ${r.setsWon}–${r.setsLost}`}>{signed(r.setsWon - r.setsLost)}</td>
                <td className="leagues-col-pts t-num">{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="leagues-table-legend">
        Voitto = {POINTS_PER_WIN} pistettä. Tasapisteissä ratkaisee eräero, sitten peliero. Vain vahvistetut tulokset lasketaan.
      </p>
    </div>
  );
}

/**
 * FixtureCard — tennis scoreboard for one fixture + its actions.
 *   state: fixtureState(); active: league is running (actions enabled)
 */
export function FixtureCard({ fixture, meId, state, active, compact, busy, onReport, onConfirm, onChat, index = 0 }) {
  const sides = boardSides(fixture, meId);
  const mine = isMyFixture(fixture, meId);
  const played = Boolean(fixture.result);
  const setCount = fixture.result?.sets?.length || 0;
  const opp = mine ? sides[1].player : null;
  return (
    <article
      className={cx('leagues-fx', compact && 'is-compact', `is-${state}`, mine && 'is-mine')}
      style={{ '--i': index }}
    >
      <div className="leagues-fx-board">
        {sides.map((side) => {
          const me = side.player.id === meId;
          return (
            <div key={side.player.id} className={cx('leagues-fx-row', played && side.won && 'is-winner', played && !side.won && 'is-loser')}>
              <Avatar person={side.player} size={compact ? 26 : 32} />
              <span className="leagues-fx-name truncate">{me ? 'Sinä' : firstName(side.player.name)}</span>
              {played && side.won && <Icon name="check" size={15} strokeWidth={3} className="leagues-fx-check" />}
              <span className="leagues-fx-games t-num" aria-label={played ? `Erien pelit ${side.games.join(', ')}` : 'Ei tulosta'}>
                {played
                  ? side.games.map((g, i) => <span key={i} className={cx('leagues-fx-set', g > sides.find((s) => s !== side).games[i] && 'is-set-won')}>{g}</span>)
                  : <span className="leagues-fx-set is-empty">–</span>}
              </span>
            </div>
          );
        })}
      </div>

      <FixtureFoot
        state={state} active={active} fixture={fixture} opp={opp} setCount={setCount} busy={busy}
        onReport={onReport} onConfirm={onConfirm} onChat={onChat}
      />
    </article>
  );
}

function FixtureFoot({ state, active, fixture, opp, busy, onReport, onConfirm, onChat }) {
  const oppName = firstName(opp?.name);
  if (state === 'done') {
    return (
      <div className="leagues-fx-foot is-status">
        <Icon name="check-circle" size={15} />
        <span>Vahvistettu{fixture.result.confirmedAt ? ` ${formatDayMonth(fixture.result.confirmedAt)}` : ''}</span>
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

/** Sign-up phase member list. */
export function MemberList({ members, meId, createdBy, onPlayer }) {
  return (
    <div className="list-group leagues-members stagger">
      {members.map((m, i) => {
        const me = m.id === meId;
        return (
          <ListRow
            key={m.id}
            style={{ '--i': i }}
            leading={<Avatar person={m} size={40} />}
            title={me ? `${m.name} (sinä)` : m.name}
            subtitle={m.skillLevel ? levelLabel(m.skillLevel) : 'Taso ei tiedossa'}
            onClick={() => onPlayer(m)}
            right={m.id === createdBy ? <Chip tone="lime" size="sm" icon="crown">Perustaja</Chip> : undefined}
          />
        );
      })}
    </div>
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
