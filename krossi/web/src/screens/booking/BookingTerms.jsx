// BookingTerms — "Varausehdot": the court booking rules in a few short lines, in a sheet (from the
// booking page's link and the booking sheet's "Maksamalla hyväksyt varausehdot"). Every rule is one
// the app itself follows, with the hall's own numbers (hold time, cancellation limit) and the 1 €
// peruutuskulu (features/booking.js CANCEL_FEE_CENTS); split payment and resale show only where the
// server has them.
//
//   <BookingTermsSheet open onClose venue />
import { CANCEL_FEE_CENTS, centsLabel } from '../../features/booking.js';
import { SUPPORT_EMAIL } from '../../lib/constants.js';
import { Button, Sheet } from '../../ui/index.js';

/** [title, text] pairs for a venue. */
export function bookingTerms(venue) {
  return [
    ['Varaus', `Vuoro on sinun, kun maksu on mennyt läpi. Aika pidetään sinulle ${venue?.holdMinutes ?? 10} minuuttia maksamisen ajan. Hinnat sisältävät ALV:n.`],
    ['Peruutus', `Voit perua vuoron ${venue?.cancelLimitHours ?? 24} h ennen sen alkua. Peruutuskulu on ${centsLabel(CANCEL_FEE_CENTS)}, ja loput palautuvat maksutavallesi. Sarjakortin tunnit ja lahjakorttisaldo palautuvat kokonaan. Jos halli peruu vuoron, saat kaiken takaisin.`],
    ...(venue?.resale ? [
      ['Et pääsekään?', `Peruutusajan jälkeen voit laittaa vuoron myyntiin. Kun joku varaa sen, saat rahat takaisin peruutuskulua (${centsLabel(CANCEL_FEE_CENTS)}) lukuun ottamatta.`],
    ] : []),
    ...(venue?.splitPay ? [
      ['Jaettu maksu', 'Varaaja maksaa koko vuoron ja voi jakaa kavereille maksulinkin. Kun kaveri maksaa osuutensa, sama summa palautuu varaajalle. Jos vuoro perutaan, jokainen saa maksamansa takaisin.'],
    ] : []),
    ['Hallissa', 'Noudata hallin sääntöjä. Aloita ja lopeta ajallaan — seuraava vuoro odottaa.'],
  ];
}

export function BookingTermsSheet({ open, onClose, venue }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title="Varausehdot"
      subtitle={venue?.name}
      footer={<Button variant="dark" size="lg" block onClick={onClose}>Selvä</Button>}
    >
      <dl className="bk-terms">
        {bookingTerms(venue).map(([title, text]) => (
          <div key={title} className="bk-terms-item">
            <dt>{title}</dt>
            <dd>{text}</dd>
          </div>
        ))}
        <div className="bk-terms-item">
          <dt>Kysyttävää?</dt>
          <dd><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></dd>
        </div>
      </dl>
    </Sheet>
  );
}
