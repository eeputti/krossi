// HallCards — Hallin näkymä → Kortit: series cards sold (owner, balance, valid until) and gift cards
// (code, value, buyer, who redeemed it). The search box finds a player or a code at the counter.
// What is for sale (products, gift card amounts) is set in Hallin asetukset.
import { useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { centsLabel } from '../../features/booking.js';
import { dayMonth, hoursLeftLabel } from '../../features/seasons.js';
import { Avatar, Button, ErrorState, Input, Segmented, Skeleton, StatTile } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const PASS_STATES = { active: 'Voimassa', used: 'Käytetty', expired: 'Vanhentunut', pending: 'Maksamatta' };
const GIFT_STATES = { active: 'Lunastamatta', redeemed: 'Lunastettu', expired: 'Vanhentunut', pending: 'Maksamatta' };

export function HallCards({ venue }) {
  const sold = useAsync(() => api.wallet.staffList(venue.id), [venue.id]);
  const [view, setView] = useState('passes');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase().replace(/[\s-]/g, '');

  const passes = useMemo(() => (sold.data?.passes || []).filter((p) => !needle
    || `${p.owner?.name || ''}${p.name}`.toLowerCase().replace(/[\s-]/g, '').includes(needle)), [sold.data, needle]);
  const gifts = useMemo(() => (sold.data?.giftCards || []).filter((g) => !needle
    || `${g.code || ''}${g.buyer?.name || ''}${g.redeemedBy?.name || ''}${g.recipientName || ''}`.toLowerCase().replace(/[\s-]/g, '').includes(needle)), [sold.data, needle]);
  const all = sold.data;
  const activePasses = (all?.passes || []).filter((p) => p.status === 'active');
  const openGifts = (all?.giftCards || []).filter((g) => g.status === 'active');
  const wait = <Skeleton w={44} h={22} r={6} />;

  return (
    <div className="bhall-view">
      <div className="bhall-view-head">
        <div>
          <h2 className="bhall-view-title">Sarja- ja lahjakortit</h2>
          <p className="bhall-view-sub">Krossissa myydyt kortit ja niiden saldot</p>
        </div>
        <Button variant="soft" size="sm" icon="settings" onClick={() => navigate(`/pelaa/halli/${venue.slug}?nakyma=asetukset`)}>Myytävät kortit</Button>
      </div>
      <div className="bhall-stats">
        <StatTile icon="repeat" label="Sarjakortit" value={all ? activePasses.length : wait} sub={all ? `voimassa, ${hoursLeftLabel(activePasses.reduce((s, p) => s + p.minutesLeft, 0))} pelaamatta` : null} />
        <StatTile icon="euro" label="Sarjakorttimyynti" value={all ? centsLabel(all.passes.reduce((s, p) => s + p.priceCents, 0)) : wait} sub={all ? `${all.passes.length} korttia` : null} />
        <StatTile icon="gift" label="Lahjakortit" value={all ? openGifts.length : wait} sub={all ? `lunastamatta, ${centsLabel(openGifts.reduce((s, g) => s + g.amountCents, 0))}` : null} />
        <StatTile icon="euro" label="Lahjakorttimyynti" value={all ? centsLabel(all.giftCards.reduce((s, g) => s + g.amountCents, 0)) : wait} sub={all ? `${all.giftCards.length} korttia` : null} />
      </div>
      <div className="hc-controls">
        <Segmented ariaLabel="Kortit" options={[{ value: 'passes', label: 'Sarjakortit' }, { value: 'gifts', label: 'Lahjakortit' }]} value={view} onChange={setView} />
        <Input icon="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={view === 'passes' ? 'Hae nimellä' : 'Hae koodilla tai nimellä'} aria-label="Hae" />
      </div>

      {sold.loading && !all ? <Skeleton h={220} r={16} /> : sold.error && !all ? (
        <ErrorState error={sold.error} onRetry={() => sold.reload()} compact />
      ) : view === 'passes' ? (
        passes.length === 0 ? <p className="ss-empty">{needle ? 'Ei osumia.' : 'Sarjakortteja ei ole vielä myyty.'}</p> : (
          <ul className="hc-list">
            {passes.map((p) => (
              <li key={p.id} className={cx('hc-row', p.status !== 'active' && 'is-quiet')}>
                <Avatar person={p.owner} name={p.owner?.name} size={34} />
                <span className="hc-main"><b className="truncate">{p.owner?.name}</b><small>{p.name}, ostettu {p.purchasedAt ? dayMonth(p.purchasedAt.slice(0, 10), true) : '—'}</small></span>
                <span className="hc-side t-num"><b>{hoursLeftLabel(p.minutesLeft)}</b><small>{PASS_STATES[p.status]}{p.validUntil && p.status === 'active' ? ` ${dayMonth(p.validUntil, true)} asti` : ''}</small></span>
              </li>
            ))}
          </ul>
        )
      ) : gifts.length === 0 ? <p className="ss-empty">{needle ? 'Ei osumia.' : 'Lahjakortteja ei ole vielä myyty.'}</p> : (
        <ul className="hc-list">
          {gifts.map((g) => (
            <li key={g.id} className={cx('hc-row', g.status !== 'active' && 'is-quiet')}>
              <code className="hc-code">{g.code}</code>
              <span className="hc-main">
                <b>{centsLabel(g.amountCents)}{g.recipientName ? `, ${g.recipientName}` : ''}</b>
                <small>Ostaja {g.buyer?.name || '—'}{g.redeemedBy ? `, lunasti ${g.redeemedBy.name}` : ''}</small>
              </span>
              <span className="hc-side"><b>{GIFT_STATES[g.status]}</b><small>{g.status === 'active' ? `${dayMonth(g.validUntil, true)} asti` : g.redeemedAt ? dayMonth(g.redeemedAt.slice(0, 10), true) : ''}</small></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
