// MoreSheet (player) — the phone tab bar's "Lisää" drawer, built like the coach's: the places
// that have no tab of their own. Laskut (once a coach has sent one), Ryhmäsi (the group mates and the week's theme), Liity ryhmään
// (JoinGroupSheet: one more group with a code), Harjoitteet ja videot, Ilmoitukset (with the unread
// count), Profiili and Anna palautetta. A computer has these in the side nav, the bell on the profile card at its foot.
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, ListRow, Sheet } from '../ui/index.js';
import { koutsiGroupsForStudent } from '../domain/core.js';
import { DRILL_COUNT } from '../shared/drills/useLibrary.js';

export function groupsSubtitle(groups) {
  if (!groups.length) return 'Liity ryhmään valmentajan koodilla';
  const names = [...new Set(groups.map((g) => g.name))];
  // two groups may share a name (Ti and To); the count is the groups, the names are said once
  return groups.length === 1 ? names[0] : `${groups.length} ryhmää · ${names.join(', ')}`;
}

export function MoreSheet({ open, onClose, unread, onNotifications, onFeedback, onJoin, invoices = null }) {
  const { state } = useData();
  const me = state.students[0];
  const groups = koutsiGroupsForStudent(state, me.id);
  const go = (to) => { onClose(); navigate(to); };
  return (
    <Sheet open={open} onClose={onClose} title="Lisää" size="sm" className="more-sheet">
      <div className="list-group more-list">
        {invoices && (
          <ListRow icon="euro" title="Laskut" subtitle={invoices.unpaid ? `${invoices.unpaid} maksamatta` : 'Kaikki maksettu'}
            right={invoices.unpaid ? <span className="more-badge t-num">{invoices.unpaid}</span> : undefined}
            onClick={() => go('/pelaaja/laskut')} />
        )}
        <ListRow icon="users" title="Ryhmäsi" subtitle={groupsSubtitle(groups)} onClick={() => go('/pelaaja/ryhma')} />
        <ListRow icon="plus" title="Liity ryhmään" subtitle={groups.length ? 'Liittymiskoodilla uuteen ryhmään' : 'Valmentajan antamalla liittymiskoodilla'} onClick={() => { onClose(); onJoin(); }} />
        <ListRow icon="play" title="Harjoitteet ja videot" subtitle={`${DRILL_COUNT} harjoitetta, valmentajan videot ja omat videosi`} onClick={() => go('/pelaaja/harjoitteet')} />
        <ListRow icon="bell" title="Ilmoitukset" subtitle={unread ? `${unread} ${unread === 1 ? 'uusi' : 'uutta'}` : 'Ei uusia'}
          right={unread ? <span className="more-badge t-num">{unread > 9 ? '9+' : unread}</span> : undefined}
          onClick={() => { onClose(); onNotifications(); }} />
        <ListRow leading={<Avatar person={me} size={32} />} title="Profiili" subtitle="Omat tiedot, kommentti valmentajalle, ilmoitukset, tili"
          onClick={() => go('/pelaaja/profiili')} />
        <ListRow icon="chat" title="Anna palautetta" subtitle="Kerro, mikä toimii ja mikä ei" onClick={() => { onClose(); onFeedback(); }} />
      </div>
    </Sheet>
  );
}
