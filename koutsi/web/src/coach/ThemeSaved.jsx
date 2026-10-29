// ThemeSaved — the "Valmis" step after themes are saved, so the coach sees what just happened:
// the theme as the players see it, every group it went to (and what it replaced), the groups that
// kept their own, and the week's coverage with the groups still without a theme. Shared by
// Viikon teemat and "Jatka edellisillä". Read back from the reloaded state, so a group whose theme
// was set elsewhere in the meantime shows as keeping it.
import { Button, Icon } from '../ui/index.js';
import { CopyButton, ThemeCard } from '../shared/bits.jsx';
import { koutsiGroupThemeForWeek, koutsiThemeKey, koutsiThemeShareMessage, koutsiWeekThemeStatus } from '../domain/core.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const groupWord = (n) => (n === 1 ? '1 ryhmä' : `${n} ryhmää`);

/**
 * state, week,
 * items: [{ group, title, lead, previous, already }] — the picked groups and the theme each got
 *   (previous = the theme it replaced, already = it had exactly this theme before),
 * skipped: [{ group, theme }] — picked groups the coach chose to leave with their own theme,
 * onMissing(ids) — set a theme for the groups still without one.
 */
export function ThemeSaved({ state, week, items, skipped = [], onMissing }) {
  const rows = items.map((it) => {
    const group = state.groups.find((g) => g.id === it.group.id) || it.group;
    const current = koutsiGroupThemeForWeek(group, week);
    return { ...it, group, current, ok: Boolean(current) && koutsiThemeKey(current.title) === koutsiThemeKey(it.title) };
  });
  const done = rows.filter((r) => r.ok);
  const kept = [
    ...rows.filter((r) => !r.ok && r.current).map((r) => ({ group: r.group, theme: r.current })),
    ...skipped,
  ];
  const one = new Set(done.map((r) => koutsiThemeKey(r.title))).size === 1;
  const first = done[0];
  const players = new Set(done.flatMap((r) => r.group.memberIds || [])).size;
  const status = koutsiWeekThemeStatus(state.groups, state.trainings, week);
  const { missing, pool, covered } = status;
  const all = pool.length > 0 && missing.length === 0;

  return (
    <div className="ts-done stack-4">
      <div className="ts-head">
        <span className="ts-check pop" aria-hidden="true"><Icon name="check" size={24} strokeWidth={3} /></span>
        <div className="ts-head-text">
          <h3 className="t-h2">{one ? 'Teema tallennettu' : 'Teemat tallennettu'}</h3>
          <p className="ts-sub">Viikko {week.week}, {groupWord(done.length)}{players ? `, ${players} pelaajaa` : ''}</p>
        </div>
      </div>

      {one && first && <ThemeCard theme={{ title: first.title, lead: first.lead }} week={week} />}

      <section aria-label={one ? 'Ryhmät, joille teema meni' : 'Ryhmät ja niiden teemat'}>
        <div className="field-label">{one ? `Meni näille ryhmille (${done.length})` : `Ryhmät ja teemat (${done.length})`}</div>
        <ul className="ts-list">
          {done.map((r) => (
            <li key={r.group.id} className="ts-row">
              <span className="ts-row-check" aria-hidden="true"><Icon name="check" size={12} strokeWidth={3} /></span>
              <span className="ts-when t-num">{r.group.day} {r.group.time}</span>
              <span className="ts-main">
                <span className="ts-name">{r.group.name}</span>
                {(!one || r.previous || r.already) && (
                  <span className="ts-meta">
                    {!one && <strong>{r.title}</strong>}
                    {!one && (r.previous || r.already) && ', '}
                    {r.already ? 'oli jo tämä teema' : r.previous ? `vaihdettu, oli ${r.previous}` : ''}
                  </span>
                )}
              </span>
              <span className="ts-count t-num">{(r.group.memberIds || []).length} pel.</span>
            </li>
          ))}
        </ul>
      </section>

      {kept.length > 0 && (
        <section aria-label="Ryhmät, jotka pitivät oman teemansa">
          <div className="field-label">Pitivät oman teemansa ({kept.length})</div>
          <ul className="ts-list">
            {kept.map((k) => (
              <li key={k.group.id} className="ts-row is-kept">
                <span className="ts-row-check" aria-hidden="true" />
                <span className="ts-when t-num">{k.group.day} {k.group.time}</span>
                <span className="ts-main">
                  <span className="ts-name">{k.group.name}</span>
                  <span className="ts-meta">{k.theme?.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pool.length > 0 && (
        <section className={cx('ts-week', all && 'is-ok')} aria-label={`Viikon ${week.week} tilanne`}>
          <div className="ts-week-title">
            <Icon name={all ? 'check-circle' : 'alert'} size={17} />
            {all ? `Kaikilla ${pool.length} ryhmällä on teema viikolla ${week.week}` : `Viikko ${week.week}: ${covered}/${pool.length} ryhmällä on teema`}
          </div>
          {!all && (
            <>
              <div className="ts-week-missing">
                Puuttuu vielä: {missing.map((g) => `${g.day} ${g.time} ${g.name}`).join(', ')}
              </div>
              {onMissing && (
                <Button variant="dark" size="sm" icon="sparkles" onClick={() => onMissing(missing.map((g) => g.id))}>
                  Aseta teema puuttuville ({missing.length})
                </Button>
              )}
            </>
          )}
        </section>
      )}

      {one && first && (
        <CopyButton variant="outline" size="md" icon="share" text={koutsiThemeShareMessage({ title: first.title, lead: first.lead, week: week.week })}
          label="Kopioi viesti pelaajille" copiedLabel="Kopioitu — liitä ryhmän WhatsAppiin" />
      )}
    </div>
  );
}
