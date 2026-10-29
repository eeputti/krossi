// MoreSheet — the phone tab bar's "Lisää" drawer: the places that have no tab of their own on a
// phone. Liittymiskoodini (JoinCodesSheet), Lähetetyt and Harjoitteet ja videot (Harjoitepankki until the
// database has Lähetetyt), Laskutus (while it is on), Suunnittele, Ryhmät, Ilmoitukset (with the unread
// count), Tiedote pelaajille (Merkitse's notice: a message to groups or players, on their Koti and by e-mail),
// Profiili, Anna palautetta, and Ylläpito for admins. (A computer has these in the side nav; the bell sits on the profile card at its foot.)
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, ListRow, Sheet } from '../ui/index.js';
import { bankSummary } from './ExercisesScreen.jsx';
import { track } from './usage.js';

export function MoreSheet({ open, onClose, unread, onNotifications, onNotice, onFeedback, onCodes, isAdmin, acting, billing = null }) {
  const { state } = useData();
  const go = (to, event) => { track(`lisaa.${event}`); onClose(); navigate(to); };
  const noticesReady = state.announcementsReady !== false;
  return (
    <Sheet open={open} onClose={onClose} title="Lisää" size="sm" className="more-sheet">
      <div className="list-group more-list">
        {billing && (
          <ListRow icon="euro" title="Laskutus"
            subtitle={billing.overdue ? `${billing.overdue} erääntynyt` : billing.open ? `${billing.open} avoinna` : 'Laskut läsnäoloista'}
            onClick={() => go('/valmentaja/laskutus', 'laskutus')} />
        )}
        {!acting && (
          <ListRow icon="link" title="Liittymiskoodini" subtitle="Ryhmien koodit ja oma koodisi pelaajille"
            onClick={() => { track('lisaa.liittymiskoodit'); onClose(); onCodes(); }} />
        )}
        {state.sendsReady ? (
          <>
            <ListRow icon="send" title="Lähetetyt" subtitle="Videot, kotiläksyt, huomiot ja tiedotteet: kenelle ja milloin" onClick={() => go('/valmentaja/lahetetyt', 'lahetetyt')} />
            <ListRow icon="list" title="Harjoitteet ja videot" subtitle={`${bankSummary(state.exercises.length)} · ${(state.videoLibrary || []).length} videota`} onClick={() => go('/valmentaja/harjoitteet', 'harjoitteet')} />
          </>
        ) : (
          <ListRow icon="list" title="Harjoitepankki" subtitle={bankSummary(state.exercises.length)} onClick={() => go('/valmentaja/harjoitteet', 'harjoitteet')} />
        )}
        <ListRow icon="grid" title="Suunnittele" subtitle="Teemat monelle viikolle, poissaolot, kausi" onClick={() => go('/valmentaja/suunnittele', 'suunnittele')} />
        <ListRow icon="users" title="Ryhmät" subtitle={`${state.groups.length} ryhmää listana`} onClick={() => go('/valmentaja/ryhmalista', 'ryhmat')} />
        {!acting && (
          <ListRow icon="bell" title="Ilmoitukset" subtitle={unread ? `${unread} ${unread === 1 ? 'uusi' : 'uutta'}` : 'Ei uusia'}
            right={unread ? <span className="more-badge t-num">{unread > 9 ? '9+' : unread}</span> : undefined}
            onClick={() => { track('lisaa.ilmoitukset'); onClose(); onNotifications(); }} />
        )}
        {noticesReady && (
          <ListRow icon="send" title="Tiedote pelaajille" subtitle="Viesti ryhmille tai pelaajille: näkyy heidän Kodissaan"
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
