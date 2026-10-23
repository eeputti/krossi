// ArchiveSheet — "Arkisto": what the player moved off their Kehitys timeline. Only the player sees
// it. Each item can come back ("Palauta") or go for good ("Poista"): the player's own things are
// deleted; the coach's (notes, homework, sessions) leave the archive and stay out of the player's
// view, while the coach keeps their own record. Rules in domain/archive.js.
import { useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, EmptyState, Icon, Sheet, useConfirm } from '../ui/index.js';
import { KOUTSI_TL_KINDS, koutsiFmtEventDate } from '../domain/timeline.js';
import { archivedEvents, deletePlan, playerOwnsEvent } from '../domain/archive.js';

const DELETE = {
  mood: (id) => api.player.deleteMood(id),
  match: (id) => api.player.deleteMatchNote(id),
  entry: (id) => api.player.deleteEntry(id),
  history: (id) => api.player.deleteHistory(id),
  training: (id) => api.player.deleteSelfTraining(id),
  video: (id) => api.videos.remove(id),
};

export function ArchiveSheet({ open, onClose, events, archive }) {
  const { run, ownerId } = useData();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(null);
  const list = archivedEvents(archive, events);
  const restore = async (e) => {
    setBusy(e.id);
    await run(() => api.player.unarchiveItem(ownerId, e.id), 'Palautettu kehitykseen.');
    setBusy(null);
  };
  const remove = async (e) => {
    const own = playerOwnsEvent(e);
    const ok = await confirm({
      title: own ? 'Poistetaanko pysyvästi?' : 'Poistetaanko arkistosta?',
      message: own ? `${e.title} poistetaan, eikä sitä saa takaisin.` : `${e.title} poistuu näkyvistäsi. Valmentajasi oma merkintä säilyy hänellä.`,
      confirmLabel: 'Poista', danger: true,
    });
    if (!ok) return;
    const plan = deletePlan(e);
    setBusy(e.id);
    await run(async () => {
      if (plan.action === 'forget') { await api.player.forgetArchived(ownerId, e.id); return; }
      await DELETE[plan.action](plan.id);
      await api.player.unarchiveItem(ownerId, e.id);
    }, own ? 'Poistettu.' : 'Poistettu arkistosta.');
    setBusy(null);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Arkisto" subtitle="Vain sinä näet nämä. Palauta takaisin kehitykseen tai poista." size="md">
      {list.length === 0 ? (
        <EmptyState compact art="mail" title="Arkisto on tyhjä" text="Kehityksen Muokkaa-tilassa voit piilottaa minkä tahansa merkinnän. Se siirtyy tänne." />
      ) : (
        <ul className="arc-list">
          {list.map((e) => (
            <li key={e.id} className="arc-row">
              <div className="arc-main">
                <span className="arc-meta"><Icon name="archive" size={12} /> {KOUTSI_TL_KINDS[e.kind]?.short || ''} · {koutsiFmtEventDate(e.at)}</span>
                <span className="arc-title">{e.title}</span>
                {e.body && <span className="arc-body">{e.body}</span>}
              </div>
              <div className="arc-actions">
                <Button variant="outline" size="sm" icon="undo" disabled={busy === e.id} onClick={() => restore(e)}>Palauta</Button>
                <Button variant="ghost" size="sm" icon="trash" disabled={busy === e.id} onClick={() => remove(e)}>Poista</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
