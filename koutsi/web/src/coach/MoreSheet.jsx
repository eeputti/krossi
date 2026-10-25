// MoreSheet — the phone tab bar's "Lisää" drawer: the places that have no tab of their own on a
// phone. Viestit first when it is on (who waits for an answer, the unread count; Tiedote then lives
// inside Viestit and in Merkitse), Harjoitepankki, Suunnittele, Ryhmät, Ilmoitukset (with the unread
// count), Tiedote pelaajille (while Viestit is off), Profiili, Anna palautetta, and Ylläpito for admins.
// (A computer has these in the side nav, the bell on Koti and the avatar.)
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, ListRow, Sheet } from '../ui/index.js';
import { bankSummary } from './ExercisesScreen.jsx';
import { track } from './usage.js';

export function MoreSheet({ open, onClose, unread, onNotifications, onNotice, onFeedback, isAdmin, acting, messages = null }) {
  const { state } = useData();
  const go = (to, event) => { track(`lisaa.${event}`); onClose(); navigate(to); };
  const noticesReady = state.announcementsReady !== false;
  return (
    <Sheet open={open} onClose={onClose} title="Lisää" size="sm" className="more-sheet">
      <div className="list-group more-list">
        {messages && (
          <ListRow icon="chat" title="Viestit"
            subtitle={messages.waiting || (messages.on ? (messages.unread ? `${messages.unread} uutta` : 'Ei uusia viestejä') : 'Ota käyttöön aikuisille pelaajille')}
            right={messages.unread ? <span className="more-badge t-num">{messages.unread > 9 ? '9+' : messages.unread}</span> : undefined}
            onClick={() => go(messages.on ? '/valmentaja/viestit' : '/valmentaja/viestit?kayttoon=1', 'viestit')} />
        )}
        <ListRow icon="list" title="Harjoitepankki" subtitle={bankSummary(state.exercises.length)} onClick={() => go('/valmentaja/harjoitteet', 'harjoitteet')} />
        <ListRow icon="grid" title="Suunnittele" subtitle="Teemat monelle viikolle, poissaolot, kausi" onClick={() => go('/valmentaja/suunnittele', 'suunnittele')} />
        <ListRow icon="users" title="Ryhmät" subtitle={`${state.groups.length} ryhmää listana`} onClick={() => go('/valmentaja/ryhmalista', 'ryhmat')} />
        {!acting && (
          <ListRow icon="bell" title="Ilmoitukset" subtitle={unread ? `${unread} ${unread === 1 ? 'uusi' : 'uutta'}` : 'Ei uusia'}
            right={unread ? <span className="more-badge t-num">{unread > 9 ? '9+' : unread}</span> : undefined}
            onClick={() => { track('lisaa.ilmoitukset'); onClose(); onNotifications(); }} />
        )}
        {noticesReady && !messages && (
          <ListRow icon="send" title="Tiedote pelaajille" subtitle="Viesti ryhmille tai pelaajille: näkyy heidän Kodissaan ja sähköpostissa"
            onClick={() => { track('lisaa.tiedote'); onClose(); onNotice(); }} />
        )}
        {!acting && (
          <ListRow leading={<Avatar person={state.coach} size={32} />} title="Profiili" subtitle="Omat tiedot, ilmoitusasetukset, tili"
            onClick={() => go('/valmentaja/profiili', 'profiili')} />
        )}
        {!acting && (
          <ListRow icon="chat" title="Anna palautetta" subtitle="Kerro, mikä toimii ja mikä ei"
            onClick={() => { track('lisaa.palaute'); onClose(); onFeedback(); }} />
        )}
        {isAdmin && !acting && <ListRow icon="shield" title="Ylläpito" subtitle="Käyttäjät, palaute, käyttö" onClick={() => go('/valmentaja/yllapito', 'yllapito')} />}
      </div>
    </Sheet>
  );
}
