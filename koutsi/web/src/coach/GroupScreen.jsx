// GroupScreen — one group: schedule, today's session (attendance and Merkitse one tap away),
// a note / homework / video for the whole group, this week's theme (and the next and earlier
// ones), upcoming sessions, members, inviting, and the rarely used things behind "Lisää".
import { useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useNow } from '../app/hooks.js';
import { Avatar, Button, Card, Chip, Disclosure, EmptyState, Icon, IconButton, Page, TopBar, useConfirm } from '../ui/index.js';
import { Block, CopyButton, Quiet, ThemeCard, useShowMore } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiAddIsoWeeks, koutsiGroupThemeForWeek, koutsiThemeShareMessage, koutsiTodayStr,
  koutsiTimeRangeLabel, koutsiFmtShortDate, koutsiTrainingsForGroup, koutsiAddDays,
} from '../domain/core.js';
import { plannerDefaultWeek, themeWeekShort } from '../domain/week.js';
import { playerPath } from './nav.js';
import { groupWhen, SessionRow } from './parts.jsx';
import { GroupThemeSheet } from './GroupThemeSheet.jsx';
import { useRecord } from './merkitse.jsx';
import { GroupSent } from './sent.jsx';
import { GroupTodayCard } from './today.jsx';
import { Link } from '../app/router.js';
import {
  AddMembersSheet, AnnualPlanBlock, ExtendCalendarSheet, GroupFormSheet, GroupInviteSheet, SlotFormSheet, calendarGoal, calendarReaches, lastSessionDate, useGroupDelete,
} from './groupForms.jsx';

function ThemeSection({ group }) {
  const [themeWeek, setThemeWeek] = useState(null); // the week whose theme is being set or changed
  const now = koutsiCurrentIsoWeek();
  const week = plannerDefaultWeek();
  const current = koutsiGroupThemeForWeek(group, week);
  const nextWeek = koutsiAddIsoWeeks(week, 1);
  const next = koutsiGroupThemeForWeek(group, nextWeek);
  const past = group.pastThemes || [];
  const [shown, more] = useShowMore(past, 6);
  return (
    <Block eyebrow="Viikon teema" title={week.week === now.week ? `Tämä viikko, vko ${week.week}` : `Ensi viikko, vko ${week.week}`}
      action={<Button variant="outline" size="sm" icon={current ? 'edit' : 'sparkles'} onClick={() => setThemeWeek(week)}>{current ? 'Vaihda' : 'Aseta'}</Button>}>
      {current ? (
        <div className="stack-3">
          <ThemeCard theme={current} week={week} />
          <CopyButton variant="outline" icon="share" text={koutsiThemeShareMessage(current)} label="Kopioi viesti pelaajille" copiedLabel="Kopioitu — liitä ryhmän WhatsAppiin" />
        </div>
      ) : (
        <Card className="k-empty-theme">
          <p className="k-quiet-text">Tälle viikolle ei ole vielä teemaa{past[0] ? <>. Edellinen: <strong>{themeWeekShort(past[0])} — {past[0].title}</strong></> : ''}.</p>
          <Button variant="dark" size="sm" icon="sparkles" onClick={() => setThemeWeek(week)}>Aseta teema</Button>
        </Card>
      )}
      <p className="k-next-theme">
        <Icon name="arrow-right" size={14} /> Vko {nextWeek.week}: {next ? <strong>{next.title}</strong> : <span className="k-faint">ei vielä teemaa</span>}
        <button type="button" className="k-textlink" onClick={() => setThemeWeek(nextWeek)}>{next ? 'Vaihda' : 'Aseta'}</button>
      </p>
      {past.length > 0 && (
        <Disclosure title="Teemahistoria" summary={past.length === 1 ? '1 viikko' : `${past.length} viikkoa`} icon="clock">
          <ul className="k-history">
            {shown.map((t) => (
              <li key={t.id} className="k-history-row"><span className="k-history-week">{themeWeekShort(t)}</span><span className="grow">{t.title}{t.lead && <span className="k-faint"> — {t.lead}</span>}</span></li>
            ))}
          </ul>
          {more}
        </Disclosure>
      )}
      <GroupThemeSheet open={Boolean(themeWeek)} group={group} week={themeWeek} onClose={() => setThemeWeek(null)} />
    </Block>
  );
}

function Sessions({ state, group }) {
  const today = koutsiTodayStr();
  const all = koutsiTrainingsForGroup(state, group.id);
  const upcoming = all.filter((t) => t.date >= today);
  const recent = all.filter((t) => t.date < today && t.date >= koutsiAddDays(today, -21)).reverse();
  const [shown, more] = useShowMore(upcoming, 4);
  const toItem = (t) => ({ training: t, group, student: null });
  return (
    <Block eyebrow="Treenit" title="Tulevat">
      {upcoming.length === 0 ? <Quiet icon="calendar">Ei tulevia treenejä kalenterissa.</Quiet> : (
        <div className="k-list">{shown.map((t) => <SessionRow key={t.id} item={toItem(t)} showDate />)}</div>
      )}
      {more}
      {recent.length > 0 && (
        <Disclosure title="Viimeisimmät" summary="Läsnäolot" icon="check-circle">
          <div className="k-list">{recent.map((t) => <SessionRow key={t.id} item={toItem(t)} showDate />)}</div>
        </Disclosure>
      )}
    </Block>
  );
}

function Members({ state, group, onAdd, onInvite }) {
  const { run } = useData();
  const confirm = useConfirm();
  const members = group.memberIds.map((id) => state.students.find((s) => s.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const unjoined = members.filter((m) => m.isPlaceholder).length;
  const remove = async (m) => {
    if (!(await confirm({ title: `Poista ${m.name} ryhmästä?`, message: 'Pelaaja pysyy Pelaajat-listallasi, mutta ei enää näe tämän ryhmän treenejä.', confirmLabel: 'Poista ryhmästä', danger: true }))) return;
    await run(() => api.groups.removeMember(group.id, m.id), 'Pelaaja poistettu ryhmästä.');
  };
  return (
    <Block eyebrow="Pelaajat" title={`${members.length} pelaajaa${unjoined ? `, ${unjoined} ei liittynyt` : ''}`}
      action={<div className="row"><Button variant="outline" size="sm" icon="link" onClick={onInvite}>Kutsu</Button><Button variant="dark" size="sm" icon="plus" onClick={onAdd}>Lisää</Button></div>}>
      {members.length === 0 ? <Quiet icon="users">Ryhmässä ei ole vielä pelaajia.</Quiet> : (
        <div className="k-list">
          {members.map((m) => (
            <div key={m.id} className="k-member">
              <Link to={playerPath(m.id)} className="k-member-link">
                <Avatar person={m} size={36} />
                <span className="grow truncate">{m.name}</span>
                {m.isPlaceholder && <Chip tone="warn" size="sm">Ei liittynyt</Chip>}
              </Link>
              <IconButton icon="close" label={`Poista ${m.name} ryhmästä`} size="sm" onClick={() => remove(m)} />
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

export function GroupScreen({ params }) {
  const { state, run } = useData();
  const confirm = useConfirm();
  const deleteGroup = useGroupDelete();
  const record = useRecord();
  const nowMs = useNow(60_000);
  const [sheet, setSheet] = useState(null); // 'edit' | 'slot' | 'members' | 'invite' | 'extend'
  const group = (state.allGroups || state.groups).find((g) => g.id === params.id);
  if (!group) {
    return (
      <>
        <TopBar title="Ryhmä" back="/valmentaja/ryhmat" />
        <Page><EmptyState art="search" title="Ryhmää ei löytynyt" text="Se on ehkä poistettu." /></Page>
      </>
    );
  }
  const memberIds = group.memberIds.filter((id) => state.students.some((s) => s.id === id));
  const scope = { name: group.name, text: memberIds.length === 1 ? 'Koko ryhmä, 1 pelaaja' : `Koko ryhmä, ${memberIds.length} pelaajaa` };
  const last = lastSessionDate(state, group.id);
  const endsSoon = !last || last <= koutsiAddDays(koutsiTodayStr(), 42);
  const removeSlot = async (slot) => {
    if (!(await confirm({ title: 'Poista harjoitusaika?', message: `${slot.day} klo ${koutsiTimeRangeLabel(slot.time, slot.durationMinutes)} ja sen tulevat treenit poistetaan. Menneet treenit säilyvät.`, confirmLabel: 'Poista', danger: true }))) return;
    await run(() => api.groups.deleteSlot(slot.id), 'Harjoitusaika poistettu.');
  };
  return (
    <>
      <TopBar title={group.name} back="/valmentaja/ryhmat" actions={<IconButton icon="edit" label="Muokkaa ryhmää" onClick={() => setSheet('edit')} />} />
      <Page className="stack-6 k-page-pad">
        <header className="k-group-head">
          <h1 className="t-title">{group.name}</h1>
          <p className="k-group-when">{groupWhen(group)}</p>
          {group.place && <p className="k-group-place"><Icon name="pin" size={14} />{group.place}</p>}
          {(group.slots || []).length > 0 && <p className="k-faint">+ {group.slots.map((s) => `${s.day} ${koutsiTimeRangeLabel(s.time, s.durationMinutes)}`).join(', ')}</p>}
          <div className={endsSoon ? 'k-calendar-end is-soon' : 'k-calendar-end'}>
            <Icon name="calendar" size={16} />
            <span className="grow">{last ? `Treenit kalenterissa ${koutsiFmtShortDate(last)} asti` : 'Ei treenejä kalenterissa'}</span>
            {/* only when there is something to continue: a calendar that already reaches the season's end needs no button */}
            {!calendarReaches(last, calendarGoal(state, group)) && <Button variant={endsSoon ? 'dark' : 'ghost'} size="sm" icon="repeat" onClick={() => setSheet('extend')}>Jatka</Button>}
          </div>
        </header>
        <GroupTodayCard state={state} group={group} now={new Date(nowMs)} />
        {memberIds.length > 0 && (
          <div className="k-quick">
            <Button variant="lime" icon="chat" onClick={() => record.open('note', { ids: memberIds, source: 'ryhma', scope })}>Huomio</Button>
            <Button variant="outline" icon="check-circle" onClick={() => record.open('homework', { ids: memberIds, source: 'ryhma', scope })}>Kotiläksy</Button>
            <Button variant="outline" icon="play" onClick={() => record.open('video', { ids: memberIds, source: 'ryhma', scope })}>Video</Button>
          </div>
        )}
        <GroupSent groupId={group.id} />
        <ThemeSection group={group} />
        <Sessions state={state} group={group} />
        <Members state={state} group={group} onAdd={() => setSheet('members')} onInvite={() => setSheet('invite')} />
        <Disclosure title="Lisää" summary="Lisäajat, vuosisuunnitelma, poisto" icon="more">
          <div className="stack-5">
            <div className="stack-2">
              <div className="field-label">Lisäajat</div>
              {(group.slots || []).length === 0 && <p className="field-msg">Ryhmällä on yksi viikoittainen aika. Lisää toinen, jos ryhmä treenaa kahdesti viikossa.</p>}
              {(group.slots || []).map((s) => (
                <div key={s.id} className="k-file-row">
                  <Icon name="clock" size={16} /><span className="grow">{s.day} klo {koutsiTimeRangeLabel(s.time, s.durationMinutes)}</span>
                  <Button variant="ghost" size="sm" onClick={() => removeSlot(s)}>Poista</Button>
                </div>
              ))}
              <Button variant="outline" size="sm" icon="plus" onClick={() => setSheet('slot')}>Lisää harjoitusaika</Button>
            </div>
            <div className="stack-2">
              <div className="field-label">Vuosisuunnitelma</div>
              <AnnualPlanBlock group={group} />
            </div>
            <div className="stack-2">
              <div className="field-label">Ryhmän poisto</div>
              <p className="field-msg">Poistaa ryhmän ja kaikki sen treenit läsnäoloineen. Pelaajat säilyvät Pelaajat-listallasi.</p>
              <Button variant="danger" size="sm" icon="trash" onClick={() => deleteGroup(group)}>Poista ryhmä</Button>
            </div>
          </div>
        </Disclosure>
      </Page>
      <GroupFormSheet open={sheet === 'edit'} editing={group} onClose={() => setSheet(null)} />
      <SlotFormSheet open={sheet === 'slot'} group={group} onClose={() => setSheet(null)} />
      <AddMembersSheet open={sheet === 'members'} group={group} onClose={() => setSheet(null)} />
      <GroupInviteSheet open={sheet === 'invite'} group={group} onClose={() => setSheet(null)} />
      <ExtendCalendarSheet open={sheet === 'extend'} groups={[group]} onClose={() => setSheet(null)} />
    </>
  );
}
