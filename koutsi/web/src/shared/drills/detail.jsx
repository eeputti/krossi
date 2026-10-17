// detail.jsx — one drill: the court picture on a dark card, the key facts, the goal, the steps,
// what to watch and an easier/harder version. The coach's page and the player's sheet both use it.
import { Icon, Skeleton } from '../../ui/index.js';
import { CATEGORY, GEAR, playersLabel, levelLabel, selfGuided } from '../../domain/drills/index.js';
import { CourtDiagram, DiagramLegend, DrillIcon } from './art.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * DrillDetail
 *   item      — a buildDrillList item
 *   role      — 'coach' | 'player' (wording of the source line)
 *   actions   — node under the facts (save button, video…)
 *   compact   — inside a sheet: no big title (the sheet has it)
 */
export function DrillDetail({ item, role = 'coach', actions, children, compact }) {
  const topic = CATEGORY[item.cat];
  const source = item.own
    ? (role === 'coach' ? (item.lib ? 'Omissa harjoitteissa' : 'Oma harjoite') : 'Valmentajaltasi')
    : 'Krossin harjoitekirjasto';
  const gear = (item.gear || []).map((g) => GEAR[g]).filter(Boolean);
  return (
    <article className={cx('dd', compact && 'is-compact')}>
      <div className={cx('dd-hero', !item.diagram && 'is-plain')}>
        <div className="dd-hero-top">
          <span className="dd-topic"><DrillIcon cat={item.cat} size={16} />{topic?.label || 'Oma harjoite'}</span>
          <span className="dd-source">{source}</span>
        </div>
        {item.diagram ? (
          <>
            <CourtDiagram diagram={item.diagram} label={`Kenttäkuva: ${item.name}`} className="dd-court" />
            <DiagramLegend diagram={item.diagram} />
          </>
        ) : (
          <div className="dd-art" aria-hidden="true"><DrillIcon cat={item.cat} size={56} strokeWidth={1.6} /></div>
        )}
      </div>

      {!compact && <h1 className="dd-title">{item.name}</h1>}

      <dl className="dd-facts">
        <div className="dd-fact"><dt>Pelaajia</dt><dd className="t-num">{playersLabel(item.players)}</dd></div>
        <div className="dd-fact"><dt>Kesto</dt><dd>{item.minutes ? `${item.minutes} min` : '—'}</dd></div>
        <div className="dd-fact"><dt>Taso</dt><dd>{levelLabel(item.levels)}</dd></div>
      </dl>
      {(gear.length > 0 || selfGuided(item)) && (
        <div className="dd-tags">
          {selfGuided(item) && <span className="dd-tag is-solo"><Icon name="user" size={13} />Omatoiminen</span>}
          {gear.map((g) => <span key={g} className="dd-tag">{g}</span>)}
        </div>
      )}

      {actions}

      {item.ownGoal && (
        <section className="dd-sec">
          <h2 className="dd-h">{role === 'coach' ? 'Omat ohjeesi' : 'Valmentajan ohje'}</h2>
          <p className="dd-text">{item.goal}</p>
        </section>
      )}
      {!item.ownGoal && item.goal && <p className="dd-goal">{item.goal}</p>}
      {item.ownGoal && item.lib && <p className="dd-goal is-lib">{item.lib.goal}</p>}

      {item.steps.length > 0 && (
        <section className="dd-sec">
          <h2 className="dd-h">Näin teet</h2>
          <ol className="dd-steps">
            {item.steps.map((s, i) => <li key={i}><span className="dd-step-n t-num" aria-hidden="true">{i + 1}</span><span>{s}</span></li>)}
          </ol>
        </section>
      )}
      {item.cues.length > 0 && (
        <section className="dd-sec">
          <h2 className="dd-h">Kiinnitä huomiota</h2>
          <ul className="dd-cues">
            {item.cues.map((s, i) => <li key={i}><Icon name="eye" size={15} /><span>{s}</span></li>)}
          </ul>
        </section>
      )}
      {(item.easier || item.harder) && (
        <div className="dd-vars">
          {item.easier && <div className="dd-var"><span className="dd-var-label"><Icon name="chevron-down" size={14} strokeWidth={2.6} />Helpompi</span><p>{item.easier}</p></div>}
          {item.harder && <div className="dd-var is-harder"><span className="dd-var-label"><Icon name="chevron-up" size={14} strokeWidth={2.6} />Vaikeampi</span><p>{item.harder}</p></div>}
        </div>
      )}
      {children}
    </article>
  );
}

/** While the library loads: the shape of a drill page. */
export function DrillDetailSkeleton() {
  return (
    <div className="dd" aria-busy="true" aria-label="Ladataan harjoitetta">
      <Skeleton h={210} r={14} />
      <Skeleton w="72%" h={30} />
      <div className="dd-facts">{[0, 1, 2].map((i) => <Skeleton key={i} h={58} r={12} />)}</div>
      <Skeleton h={14} />
      <Skeleton w="84%" h={14} />
    </div>
  );
}
