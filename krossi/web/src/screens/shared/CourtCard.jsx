// CourtCard — SHARED component: one of my court bookings that no game of mine is played on
// (features/booking.js gamesAndCourts). Koti's "Seuraava pelisi" and Pelit → Omat pelit show it
// among my games, in the game list card's shape but plain: court, place, time, nothing playful.
//   <CourtCard booking={Booking} empty />
//     empty — nobody plays on it yet (needsPartner): the foot says "Puuttuu pelikaveri" and offers
//             to open it to others (the create-game sheet with ?varaus=<id>, behind the paywall).
//             Otherwise the foot says it is split.
// A tap on the card opens the booking (/pelaa/omat-varaukset?vuoro=<id>), like Pelataanko?'s "Tulossa".
import { openCreateGame } from '../../app/AppShell.jsx';
import { usePaywall } from '../../app/paywall.jsx';
import { navigate } from '../../app/router.js';
import { formatTime } from '../../lib/format.js';
import { Button, Card, Chip, Icon } from '../../ui/index.js';
import { GameDateTile } from './GameCard.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

export function CourtCard({ booking, empty, className, style }) {
  const { requirePaid } = usePaywall();
  const id = encodeURIComponent(booking.id);
  const openToOthers = () => requirePaid(() => openCreateGame(`?varaus=${id}`), 'Etsi pelikaveri vuoroosi');
  return (
    <Card padding="none" className={cx('ccard', empty && 'is-empty', className)} style={style}>
      <button type="button" className="ccard-main" onClick={() => navigate(`/pelaa/omat-varaukset?vuoro=${id}`)}>
        <GameDateTile iso={booking.startsAt} />
        <span className="ccard-body">
          <span className="ccard-head">
            <span className="ccard-title truncate">{booking.courtName}</span>
            <Chip tone="neutral" size="sm" icon="court">Kenttävaraus</Chip>
          </span>
          <span className="ccard-meta">
            <span className="ccard-time t-num"><Icon name="clock" size={14} />klo {formatTime(booking.startsAt)}–{formatTime(booking.endsAt)}</span>
            <span className="ccard-place truncate"><Icon name="pin" size={14} />{booking.locationName}</span>
          </span>
        </span>
      </button>
      <div className="ccard-foot">
        {empty ? (
          <>
            <span className="ccard-state"><Icon name="users" size={15} />Puuttuu pelikaveri</span>
            <Button variant="dark" size="sm" onClick={openToOthers}>Avaa vuoro muille</Button>
          </>
        ) : (
          <span className="ccard-state"><Icon name="check" size={15} />Jaettu maksu · {booking.split.parts} pelaajaa</span>
        )}
      </div>
    </Card>
  );
}
