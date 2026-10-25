// JoinGroupSheet (player) — "Liity ryhmään": always reachable from Lisää (phone), the side nav
// (computer) and Ryhmäsi. First the groups the player is already in ("Olet jo näissä ryhmissä",
// a tap opens the group), then the code field for one more: a group's code joins that group, the
// coach's own code puts the player on the coach's list. A group or coach link opened while signed
// in lands here with the code filled in (PlayerRoot). After a join the sheet stays open, says it,
// and the new group shows in the list.
import { useEffect, useState } from 'react';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { ListRow, Sheet, useToast } from '../ui/index.js';
import { koutsiCoachById, koutsiGroupsForStudent, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { DAY_NAMES } from '../domain/week.js';
import { JoinCodeForm } from './PlayerRoot.jsx';

export function JoinGroupSheet({ open, onClose, initialCode = null }) {
  const { state, reload } = useData();
  const toast = useToast();
  const me = state.students[0];
  const groups = koutsiSortGroupsBySchedule(koutsiGroupsForStudent(state, me.id));
  // coaches whose player one is without being in any of their groups yet (joined with the coach's code)
  const groupless = (state.coaches || []).filter((c) => !groups.some((g) => g.coachId === c.id));
  const [formKey, setFormKey] = useState(0);
  const [code, setCode] = useState(initialCode);
  useEffect(() => {
    if (!open) return;
    setCode(initialCode);
    setFormKey((k) => k + 1);
  }, [open, initialCode]);
  const joined = async (r) => {
    toast(r?.group_name ? `Liityit ryhmään ${r.group_name}.` : r?.coach_name ? `Olet nyt valmentajan ${r.coach_name} pelaaja.` : 'Liittyminen onnistui.');
    setCode(null);
    setFormKey((k) => k + 1);
    await reload().catch(() => {});
  };
  const openGroup = (g) => { onClose(); navigate(`/pelaaja/ryhma?ryhma=${encodeURIComponent(g.id)}`); };
  return (
    <Sheet open={open} onClose={onClose} title="Liity ryhmään" size="md">
      <div className="stack-5">
        <section className="stack-2">
          <div className="field-label">{groups.length ? `Olet jo ${groups.length === 1 ? 'tässä ryhmässä' : 'näissä ryhmissä'}` : 'Et ole vielä missään ryhmässä'}</div>
          {(groups.length > 0 || groupless.length > 0) && (
            <div className="list-group">
              {groups.map((g) => {
                const coach = koutsiCoachById(state, g.coachId);
                return (
                  <ListRow key={g.id} icon="users" title={g.name}
                    subtitle={[`${DAY_NAMES[g.day] || g.day || ''} klo ${g.time || ''}`.trim(), coach ? `Valmentaja ${coach.name}` : ''].filter(Boolean).join(' · ')}
                    onClick={() => openGroup(g)} />
                );
              })}
              {groupless.map((c) => (
                <ListRow key={c.id} icon="user" title={`Valmentaja ${c.name}`} subtitle="Olet hänen pelaajansa · ryhmä tulee, kun valmentaja lisää sinut" />
              ))}
            </div>
          )}
        </section>
        <section className="stack-3">
          <div className="stack-1">
            <h3 className="t-h3">Liity uuteen ryhmään</h3>
            <p className="k-faint">Kirjoita valmentajalta saamasi liittymiskoodi. Ryhmän koodilla pääset suoraan ryhmään, valmentajan omalla koodilla hänen pelaajakseen.</p>
          </div>
          <JoinCodeForm key={formKey} inline initialCode={code} onJoined={joined} autoFocus={false} />
        </section>
      </div>
    </Sheet>
  );
}
