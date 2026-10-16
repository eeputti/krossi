// HallItemSheet — one thing on the hall timeline. A booking: who, where, when, price and payment,
// and "Peru varaus" (money back to the player by default when it was paid). A block or league
// evening: what, which courts, when, and "Poista este" — for every court the same block covers at
// once (one api.booking.block call made a row per court) or just this one.
//
//   <HallItemSheet open onClose item venue dayKey items onDone={(message) => …} />
//     onDone  after a successful cancel / unblock: the screen closes the sheet, toasts and reloads

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { centsLabel, durationLabel, findCourt } from '../../features/booking.js';
import { formatTime } from '../../lib/format.js';
import { Avatar, Button, Chip, Icon, Sheet, Toggle, useConfirm, useToast } from '../../ui/index.js';
import { blockGroup, courtsLabel, dayText, itemVariant, paymentInfo } from './hallData.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function HallItemSheet({ open, onClose, item, venue, dayKey, items, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const [refund, setRefund] = useState(true);
  const [allCourts, setAllCourts] = useState(true);

  useEffect(() => {
    if (!open || !item) return;
    setRefund(item.paymentStatus === 'paid');
    setAllCourts(true);
  }, [open, item]);

  const variant = item ? itemVariant(item) : 'booking';
  const own = variant === 'league' || variant === 'block';
  const found = item ? findCourt(venue, item.courtId) : null;
  const group = useMemo(() => (item && own ? blockGroup(items, item) : []), [items, item, own]);
  const groupCourts = useMemo(() => {
    const ids = new Set(group.map((it) => it.courtId));
    return (found?.location.courts || []).filter((c) => ids.has(c.id));
  }, [group, found]);

  if (!item) return <Sheet open={false} onClose={onClose} />;

  const court = found?.court;
  const location = found?.location;
  const range = `${formatTime(item.startsAt)}–${formatTime(item.endsAt)}`;
  const minutes = Math.round((Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000);
  const day = dayText(dayKey);
  const when = `${day} klo ${range}`;
  const whenInSentence = when[0].toLowerCase() + when.slice(1);
  const name = item.bookedBy?.name || 'Pelaaja';
  const price = centsLabel(item.priceCents);
  const paid = item.paymentStatus === 'paid';
  const pay = paymentInfo(item);
  const wholeGroup = own && group.length > 1 && allCourts;

  const cancelBooking = async () => {
    const giveBack = paid && refund;
    const ok = await confirm({
      title: 'Perutaanko varaus?',
      message: `${name} · ${court?.shortName || 'kenttä'} ${whenInSentence}. ${giveBack ? (item.parts ? 'Jokainen maksaja saa osuutensa takaisin.' : `${price} palautetaan pelaajalle.`) : paid ? 'Rahoja ei palauteta.' : 'Aika vapautuu muille.'}`,
      confirmLabel: 'Peru varaus',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      try {
        await api.booking.staffCancel(item.id, { refund: giveBack });
        onDone?.(giveBack ? `Varaus peruttu — ${price} palautetaan.` : 'Varaus peruttu.');
      } catch (err) {
        toast(err);
      }
    });
  };

  const removeBlock = async () => {
    const rows = wholeGroup ? group : [item];
    const where = wholeGroup ? courtsLabel(groupCourts) : court?.shortName || 'kenttä';
    const ok = await confirm({
      title: 'Poistetaanko este?',
      message: `${item.title} · ${where} ${whenInSentence}. Aika vapautuu pelaajien varattavaksi.`,
      confirmLabel: 'Poista este',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      try {
        await Promise.all(rows.map((row) => api.booking.unblock(row.id)));
        onDone?.(rows.length > 1 ? `Este poistettu — ${rows.length} kenttää vapautui.` : `Este poistettu — ${where} vapautui.`);
      } catch (err) {
        toast(err);
        onDone?.(null); // some rows may be gone already: reload to show the truth
      }
    });
  };

  const footer = own
    ? <Button variant="danger" size="lg" block icon="trash" loading={busy} onClick={removeBlock}>{wholeGroup ? `Poista este (${group.length} kenttää)` : 'Poista este'}</Button>
    : <Button variant="danger" size="lg" block icon="trash" loading={busy} onClick={cancelBooking}>Peru varaus</Button>;

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      size="sm"
      title={own ? 'Hallin oma käyttö' : variant === 'held' ? 'Varaus pidossa' : 'Varaus'}
      subtitle={location ? `${location.name} · ${day}` : day}
      footer={footer}
    >
      <div className="bhall-detail">
        {own ? (
          <div className="bhall-who">
            <span className={cx('bhall-kind', `is-${variant}`)} aria-hidden="true">
              <Icon name={variant === 'league' ? 'trophy' : 'lock'} size={22} />
            </span>
            <span className="bhall-who-text">
              <span className="bhall-who-name">{item.title || 'Este'}</span>
              <span className="bhall-who-sub">{variant === 'league' ? 'Liigavuoro' : 'Estetty varauksilta'}</span>
            </span>
          </div>
        ) : (
          <div className="bhall-who">
            <Avatar person={item.bookedBy} name={name} size={48} />
            <span className="bhall-who-text">
              <span className="bhall-who-name truncate">{name}</span>
              <span className="bhall-who-sub">{variant === 'held' ? 'Maksu kesken' : 'Pelaajan varaus'}</span>
            </span>
            <Chip tone={pay.tone} icon={paid ? 'check' : variant === 'held' ? 'clock' : undefined}>{pay.label}</Chip>
          </div>
        )}

        <dl className="bhall-facts">
          <div className="bhall-fact">
            <dt><Icon name="clock" size={16} />Aika</dt>
            <dd className="t-num">klo {range} <span className="bhall-fact-sub">({durationLabel(minutes)})</span></dd>
          </div>
          <div className="bhall-fact">
            <dt><Icon name="court" size={16} />{own && groupCourts.length > 1 ? 'Kentät' : 'Kenttä'}</dt>
            <dd>{own && groupCourts.length > 1 ? courtsLabel(groupCourts) : court?.name || 'Kenttä'}{court?.surface && !(own && groupCourts.length > 1) ? <span className="bhall-fact-sub"> · {court.surface}</span> : null}</dd>
          </div>
          {!own && (
            <div className="bhall-fact">
              <dt><Icon name="euro" size={16} />Hinta</dt>
              <dd className="t-num">{item.paymentStatus === 'free' ? 'Maksuton' : price}</dd>
            </div>
          )}
          {!own && item.parts && (
            <div className="bhall-fact">
              <dt><Icon name="users" size={16} />Jaettu</dt>
              <dd>{item.parts} pelaajalle{item.unpaidCents > 0
                ? <span className="bhall-fact-sub"> · maksamatta <b className="t-num">{centsLabel(item.unpaidCents)}</b></span>
                : <span className="bhall-fact-sub"> · kaikki maksettu</span>}</dd>
            </div>
          )}
          {own && (
            <div className="bhall-fact">
              <dt><Icon name="eye" size={16} />Pelaajille</dt>
              <dd>Näkyy nimellä ”{item.title || 'Este'}”</dd>
            </div>
          )}
        </dl>

        {variant === 'held' && (
          <p className="bhall-note"><Icon name="info" size={16} />Pelaaja on maksamassa. Jos maksu ei valmistu, aika vapautuu itsestään.</p>
        )}
        {item.forSale && (
          <p className="bhall-note"><Icon name="share" size={16} />Pelaaja on laittanut vuoron myyntiin. Vuoro on hänen, kunnes joku varaa sen — sitten se siirtyy uudelle varaajalle.</p>
        )}
        {/* Past the friends' deadline the rest is the booker's: what the card didn't cover is still open. */}
        {!own && item.unpaidCents > 0 && Date.parse(item.startsAt) - Date.now() <= (venue?.shareDeadlineHours ?? 2) * 3_600_000 && (
          <p className="bhall-note"><Icon name="alert" size={16} />Osuuksia on maksamatta {centsLabel(item.unpaidCents)}. Jos pelaajat tulevat tiskille, maksun voi periä siellä.</p>
        )}
        {!own && paid && (
          <Toggle
            icon="undo"
            label="Palauta rahat pelaajalle"
            hint={refund ? (item.parts ? 'Jokaiselle maksajalle oma osuus takaisin.' : `${price} takaisin alkuperäiseen maksutapaan.`) : 'Varaus perutaan ilman hyvitystä.'}
            checked={refund}
            onChange={setRefund}
          />
        )}
        {own && group.length > 1 && (
          <Toggle
            icon="court"
            label={`Poista kaikilta ${group.length} kentältä`}
            hint={allCourts ? courtsLabel(groupCourts) : `Vain ${court?.shortName || 'tämä kenttä'}`}
            checked={allCourts}
            onChange={setAllCourts}
          />
        )}
      </div>
    </Sheet>
  );
}
