// InvitesSheet — "Kutsu pelaajat": the same picker and codes as Liittymiskoodini (JoinCodes), plus
// Henkilökohtaiset: each not-yet-joined player's own link (the way minors must join, and the way a
// placeholder's history follows the player). ?tapa=henk opens on the personal links.
import { useState } from 'react';
import { goBack } from '../app/router.js';
import { Sheet } from '../ui/index.js';
import { JoinCodes } from './JoinCodesSheet.jsx';

export { CoachCode } from './JoinCodesSheet.jsx';

export function InvitesSheet({ query = {} }) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} onClosed={() => goBack('/valmentaja/pelaajat')} size="md"
      title="Kutsu pelaajat" subtitle="Valitse ensin, miten pelaaja liittyy.">
      <JoinCodes open={open} onClose={() => setOpen(false)} withPersonal startTab={query.tapa === 'henk' ? 'henk' : null} />
    </Sheet>
  );
}
