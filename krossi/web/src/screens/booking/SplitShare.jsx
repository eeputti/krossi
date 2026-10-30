// SplitShare — "Jaa maksu kavereiden kesken" on my paid booking: kaksin- or nelinpeli, what one
// friend pays, and "Lähetä maksulinkki" (the phone's share sheet, or the clipboard). Friends pay
// their parts at the link without an account; each paid part goes back to my payment method.
// Once the link exists: who has paid, the link again, and the payment page as the friends see it.
// The booking sheet's done view and a booking's own sheet (Omat varaukset) show it.
//
//   <SplitShare venue booking onChanged={(booking) => …} />
import { useState } from 'react';
import { api } from '../../api/index.js';
import { appUrl, navigate } from '../../app/router.js';
import { WEEKDAYS_SHORT, firstName, formatDayMonth, formatTime } from '../../lib/format.js';
import { backToBooker, centsLabel, splitBlocker, splitCents, splitCounts } from '../../features/booking.js';
import { Avatar, Button, Icon, Segmented, useShare, useToast } from '../../ui/index.js';

const PARTS = [{ value: 2, label: 'Kaksinpeli' }, { value: 4, label: 'Nelinpeli' }];
const LINE_TEXT = { open: 'Odottaa', pending: 'Maksaa parhaillaan', paid: 'Maksettu', refunded: 'Palautettu' };

/** What the share sheet says before the link (the link itself goes as its url). */
export function splitShareText(booking) {
  const when = `${WEEKDAYS_SHORT[new Date(booking.startsAt).getDay()]} ${formatDayMonth(booking.startsAt)} klo ${formatTime(booking.startsAt)}–${formatTime(booking.endsAt)}`;
  return `Varasin meille kentän: ${booking.courtName}, ${booking.locationName}, ${when}. Osuutesi on ${centsLabel(booking.split.perCents)} — maksa se tästä:`;
}

const payPagePath = (token) => `/pelaa/maksa/${encodeURIComponent(token)}`;
const lineName = (line) => (line.person ? firstName(line.person.name) : line.name || (line.status === 'open' ? 'Vapaa osuus' : 'Kaveri'));

/** '15 € palautettu sinulle' | '10 € saldoosi' | '10 € saldoosi ja 5 € kortillesi'. */
function backLine(split) {
  const sum = (to) => split.lines.filter((l) => l.kind === 'friend' && l.backTo === to).reduce((n, l) => n + l.cents, 0);
  const saldo = sum('saldo');
  const card = backToBooker(split) - saldo;
  if (!saldo) return `${centsLabel(card)} palautettu sinulle.`;
  return card > 0 ? `${centsLabel(saldo)} saldoosi ja ${centsLabel(card)} kortillesi.` : `${centsLabel(saldo)} lisätty saldoosi.`;
}

export function SplitShare({ venue, booking, onChanged }) {
  const toast = useToast();
  const shareLink = useShare();
  const [parts, setParts] = useState(2);
  const [busy, setBusy] = useState(null); // 'make' | 'undo'
  if (!venue?.splitPay || !booking) return null;
  const split = booking.split;
  const send = (b) => shareLink({ title: 'Maksa osuutesi', text: splitShareText(b), url: appUrl(payPagePath(b.split.token)) });

  if (!split) {
    // Paid with a series card (or the saldo on a server before it), on sale, started: nothing to share.
    const rules = { saldo: venue.saldo === true };
    if (splitBlocker(booking, 2, Date.now(), rules)) return null;
    const per = splitCents(booking.priceCents, parts).friendCents;
    const tooSmall = splitBlocker(booking, parts, Date.now(), rules);
    const toSaldo = venue.saldo === true && booking.credit?.kind === 'gift';
    const make = async () => {
      setBusy('make');
      try {
        const next = await api.booking.split(booking.id, parts);
        onChanged?.(next);
        await send(next);
      } catch (err) {
        toast(err);
      } finally {
        setBusy(null);
      }
    };
    return (
      <section className="bk-splitcard" aria-label="Jaa maksu kavereiden kesken">
        <h3 className="bk-splitcard-title">Jaa maksu kavereiden kesken</h3>
        <Segmented ariaLabel="Pelaajia" options={PARTS} value={parts} onChange={setParts} size="sm" className="bk-splitcard-parts" />
        <p className="bk-splitcard-each"><b className="t-num">{centsLabel(per)}</b> / pelaaja</p>
        {tooSmall
          ? <p className="bk-note"><Icon name="info" size={16} />{tooSmall}</p>
          : <Button variant="dark" icon="share" block loading={busy === 'make'} onClick={make}>Lähetä maksulinkki</Button>}
        <p className="bk-fine">
          Kaverit maksavat linkistä ilman tiliä. Jokainen maksettu osuus palautuu sinulle automaattisesti{toSaldo ? ' — saldolla maksetusta osasta saldoosi' : ''}.
        </p>
      </section>
    );
  }

  const counts = splitCounts(split);
  const back = backToBooker(split);
  const friends = split.lines.filter((l) => l.kind === 'friend');
  const live = booking.status === 'confirmed' && Date.parse(booking.startsAt) > Date.now();
  const undo = async () => {
    setBusy('undo');
    try {
      onChanged?.(await api.booking.split(booking.id, 1));
    } catch (err) {
      toast(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bk-splitcard" aria-label="Jaettu maksu">
      <div className="bk-splitcard-head">
        <h3 className="bk-splitcard-title">{split.parts === 4 ? 'Nelinpeli' : 'Kaksinpeli'}, {centsLabel(split.perCents)} / pelaaja</h3>
        <span className="bk-splitcard-count t-num">{counts.paid}/{counts.total} maksanut</span>
      </div>
      <ul className="bk-splitlist">
        {friends.map((line, i) => (
          <li key={line.id || i} className={`bk-splitrow is-${line.status}`}>
            {line.person
              ? <Avatar person={line.person} size={28} />
              : <span className="bk-splitrow-dot" aria-hidden="true"><Icon name={line.status === 'open' ? 'clock' : 'user'} size={14} /></span>}
            <span className="bk-splitrow-name truncate">{lineName(line)}</span>
            <span className="bk-splitrow-state">{line.status === 'paid' && <Icon name="check" size={13} strokeWidth={2.8} />}{LINE_TEXT[line.status]}</span>
          </li>
        ))}
      </ul>
      {back > 0 && <p className="bk-fine">{backLine(split)}</p>}
      {live && split.token && counts.open > 0 && (
        <div className="bk-splitcard-actions">
          <Button variant="dark" icon="share" block onClick={() => send(booking)}>Lähetä maksulinkki</Button>
          <Button variant="ghost" block onClick={() => navigate(payPagePath(split.token))}>Katso maksusivu</Button>
        </div>
      )}
      {live && counts.paid === 0 && friends.every((l) => l.status === 'open') && (
        <button type="button" className="bk-splitcard-undo" disabled={busy === 'undo'} onClick={undo}>Peru jako</button>
      )}
    </section>
  );
}
