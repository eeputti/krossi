// InvitesSheet — "Kutsu pelaajat" (Pelaajat → Kutsu, Lähetä kutsut): the same picker and codes as
// Liittymiskoodini (JoinCodes): Pelaajille (each player's own code), Ryhmille, Kaikille.
// ?tapa=henk (Lähetä kutsut) opens on Pelaajille with only the not-yet-joined players listed.
import { useState } from 'react';
import { goBack } from '../app/router.js';
import { Sheet } from '../ui/index.js';
import { JoinCodes } from './JoinCodesSheet.jsx';

export { CoachCode } from './JoinCodesSheet.jsx';

export function InvitesSheet({ query = {} }) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} onClosed={() => goBack('/valmentaja/pelaajat')} size="md"
      title="Kutsu pelaajat" subtitle="Valitse ensin, kenelle koodi on.">
      <JoinCodes open={open} onClose={() => setOpen(false)} startTab={query.tapa === 'henk' ? 'henk' : null} unjoinedFirst={query.tapa === 'henk'} />
    </Sheet>
  );
}
