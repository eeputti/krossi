// InviteToGameSheet — pick pelikaverit and same-city players and send game invites.
//   <InviteToGameSheet open onClose gameId city excludeIds={[…]} preselectIds={[…]} onInvited={(result) => …} />
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { appUrl } from '../../app/router.js';
import { useAsync, useBusy } from '../../app/hooks.js';
import { useSession } from '../../app/session.jsx';
import {
  Avatar, Button, EmptyState, ErrorState, Icon, Input, Sheet, SkeletonList, useShare, useToast,
} from '../../ui/index.js';
import { SKILL_LEVELS, labelOf } from '../../lib/constants.js';
import { firstName } from '../../lib/format.js';

const cx = (...c) => c.filter(Boolean).join(' ');

function namesOf(ids, people) {
  const names = ids.map((id) => firstName(people.get(id)?.name)).filter(Boolean);
  if (names.length <= 2) return names.join(' ja ');
  return `${names.slice(0, 2).join(', ')} ja ${names.length - 2} muuta`;
}

function PickRow({ person, sub, checked, onToggle, index }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={cx('games-pick', checked && 'is-on')} onClick={onToggle} style={{ '--i': index }}>
      <Avatar person={person} size={42} />
      <span className="games-pick-text">
        <span className="games-pick-name truncate">{person.name}</span>
        {sub && <span className="games-pick-sub truncate">{sub}</span>}
      </span>
      <span className="games-pick-check" aria-hidden="true"><Icon name="check" size={16} strokeWidth={3} /></span>
    </button>
  );
}

export function InviteToGameSheet({ open, onClose, gameId, city, excludeIds = [], preselectIds = [], onInvited, shareText }) {
  const { user, profile } = useSession();
  const toast = useToast();
  const shareLink = useShare();
  const [busy, run] = useBusy();
  const [picked, setPicked] = useState(() => new Set(preselectIds));
  const [q, setQ] = useState('');
  const homeCity = city || profile?.city || '';

  const { data, error, loading, reload } = useAsync(async () => {
    if (!open) return null;
    const [partners, players] = await Promise.all([
      api.players.listPartners(),
      homeCity ? api.players.list({ city: homeCity }) : Promise.resolve([]),
    ]);
    return { partners: partners || [], players: players || [] };
  }, [open, homeCity]);

  useEffect(() => { if (open) { setPicked(new Set(preselectIds)); setQ(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = useMemo(() => new Set([user?.id, ...excludeIds].filter(Boolean)), [user?.id, excludeIds]);
  const lists = useMemo(() => {
    if (!data) return null;
    const needle = q.trim().toLowerCase();
    const match = (p) => !needle || String(p.name || '').toLowerCase().includes(needle);
    const partnerIds = new Set();
    const partners = data.partners
      .filter((pt) => pt.player && !skip.has(pt.player.id))
      .map((pt) => { partnerIds.add(pt.player.id); return pt; })
      .filter((pt) => match(pt.player));
    const others = data.players.filter((p) => !skip.has(p.id) && !partnerIds.has(p.id) && match(p));
    const people = new Map();
    data.partners.forEach((pt) => pt.player && people.set(pt.player.id, pt.player));
    data.players.forEach((p) => people.set(p.id, p));
    return { partners, others, people, total: partnerIds.size + data.players.filter((p) => !skip.has(p.id) && !partnerIds.has(p.id)).length };
  }, [data, q, skip]);

  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const send = () => run(async () => {
    const ids = [...picked];
    try {
      const result = (await api.games.invite(gameId, ids)) || { invited: ids, alreadyInvited: [] };
      const invited = result.invited || [];
      const already = result.alreadyInvited || [];
      const people = lists?.people || new Map();
      if (invited.length) toast(`Kutsu lähti: ${namesOf(invited, people)} 🎾`, { icon: 'send' });
      if (already.length) toast(`${namesOf(already, people)} on jo kutsuttu`, { tone: 'info', icon: 'info' });
      onInvited?.(result);
      onClose?.();
    } catch (err) {
      toast(err);
    }
  });

  const shareGame = () => shareLink({ title: 'Krossi', text: shareText || 'Pelataanko? 🎾', url: appUrl(`/pelaa/peli/${gameId}`) });

  let body;
  if (error) body = <ErrorState compact error={error} onRetry={() => reload()} />;
  else if (loading || !data) body = <SkeletonList count={5} variant="row" />;
  else if (lists.total === 0) {
    body = (
      <EmptyState
        compact
        art="players"
        title="Ei vielä ketään kutsuttavaksi"
        text="Jaa pelin linkki — kaverit pääsevät mukaan sitä kautta."
        action={<Button variant="lime" icon="share" onClick={shareGame}>Jaa linkki</Button>}
      />
    );
  } else {
    let i = 0;
    body = (
      <>
        {lists.total > 8 && (
          <Input icon="search" placeholder="Hae nimellä" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Hae pelaajaa" className="games-pick-search" />
        )}
        {lists.partners.length > 0 && (
          <div className="games-pick-group">
            <div className="eyebrow games-pick-eyebrow">Pelikaverit</div>
            <div className="games-pick-list stagger">
              {lists.partners.map((pt) => (
                <PickRow
                  key={pt.player.id}
                  index={i++}
                  person={pt.player}
                  sub={pt.gamesTogether === 1 ? '1 peli yhdessä' : `${pt.gamesTogether} peliä yhdessä`}
                  checked={picked.has(pt.player.id)}
                  onToggle={() => toggle(pt.player.id)}
                />
              ))}
            </div>
          </div>
        )}
        {lists.others.length > 0 && (
          <div className="games-pick-group">
            <div className="eyebrow games-pick-eyebrow">Muut pelaajat · {homeCity}</div>
            <div className="games-pick-list stagger">
              {lists.others.map((p) => (
                <PickRow
                  key={p.id}
                  index={i++}
                  person={p}
                  sub={[labelOf(SKILL_LEVELS, p.skillLevel), p.playingThisWeek ? 'pelaa tällä viikolla' : null].filter(Boolean).join(' · ')}
                  checked={picked.has(p.id)}
                  onToggle={() => toggle(p.id)}
                />
              ))}
            </div>
          </div>
        )}
        {lists.partners.length + lists.others.length === 0 && <p className="games-pick-none">Ei osumia haulla “{q}”.</p>}
      </>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      title="Kutsu pelikavereita"
      subtitle="Valitut saavat kutsun ja ilmoituksen."
      className="games-invite"
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" icon="share" onClick={shareGame}>Jaa linkki</Button>
          <Button variant="lime" size="lg" icon="send" loading={busy} disabled={picked.size === 0} onClick={send}>
            {picked.size ? `Kutsu (${picked.size})` : 'Kutsu'}
          </Button>
        </div>
      )}
    >
      {body}
    </Sheet>
  );
}
