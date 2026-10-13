// ExercisesScreen (player) — the coach's drill bank first (with the coach's videos, which the
// old app never showed), then the player's own clips and links.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, ChipSelect, Icon, IconButton, Input, Page, Sheet, TopBar, useConfirm } from '../ui/index.js';
import { Block, Quiet } from '../shared/bits.jsx';
import { KOUTSI_TAGS, KOUTSI_TAG_LABELS, koutsiFmtShortDate } from '../domain/core.js';
import { usePlayerActions } from './PlayerApp.jsx';

export function ExercisesScreen() {
  const { state, run } = useData();
  const actions = usePlayerActions();
  const confirm = useConfirm();
  const me = state.students[0];
  const [tag, setTag] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const list = useMemo(() => state.exercises.filter((e) => (!tag || (e.tags || []).includes(tag))
    && (!query.trim() || `${e.name} ${e.goal}`.toLocaleLowerCase('fi').includes(query.trim().toLocaleLowerCase('fi'))))
    .sort((a, b) => Number(Boolean(b.video)) - Number(Boolean(a.video)) || a.name.localeCompare(b.name, 'fi')), [state.exercises, tag, query]);
  const own = (me.videos || []).filter((v) => v.addedBy === 'player');
  const fromCoach = (me.videos || []).filter((v) => v.addedBy !== 'player');
  const removeOwn = async (v) => {
    if (await confirm({ title: 'Poista video?', message: `${v.title} poistetaan pysyvästi.`, confirmLabel: 'Poista', danger: true })) await run(() => api.videos.remove(v.id), 'Video poistettu.');
  };
  return (
    <>
      <TopBar title="Harjoitteet ja videot" back="/pelaaja/kehitys" />
      <Page className="stack-6 k-page-pad">
        <Block eyebrow="Valmentajalta" title="Harjoitepankki">
          {state.exercises.length === 0 ? <Quiet icon="racket">Valmentajasi harjoitteet näkyvät täällä.</Quiet> : (
            <div className="stack-3">
              {state.exercises.length > 8 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae harjoitetta" aria-label="Hae harjoitetta" />}
              <ChipSelect layout="scroll" size="sm" allowEmpty options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={tag} onChange={setTag} ariaLabel="Aihe" />
              <div className="k-list">
                {list.map((e) => (
                  <button key={e.id} type="button" className="k-row" onClick={() => setOpen(e)}>
                    <span className="k-ex-icon">{e.video ? <Icon name="play" size={16} /> : <Icon name="racket" size={16} />}</span>
                    <span className="k-row-main">
                      <span className="k-row-title truncate">{e.name}</span>
                      <span className="k-row-sub truncate">{[e.players && `${e.players} pel.`, e.duration, ...(e.tags || []).map((t) => KOUTSI_TAG_LABELS[t])].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Icon name="chevron-right" size={18} className="k-chevron" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </Block>
        {fromCoach.length > 0 && (
          <Block eyebrow="Valmentajalta" title="Jaetut videot">
            <div className="k-list">
              {fromCoach.map((v) => (
                <button key={v.id} type="button" className="k-row" onClick={() => actions.playVideo(v)}>
                  <span className="k-video-thumb" style={{ '--h': v.hue }}><Icon name="play" size={14} /></span>
                  <span className="k-row-main"><span className="k-row-title truncate">{v.title}</span><span className="k-row-sub">{koutsiFmtShortDate(v.date)}</span></span>
                </button>
              ))}
            </div>
          </Block>
        )}
        <Block eyebrow="Omat" title="Omat videot ja linkit" action={<Button variant="outline" size="sm" icon="plus" onClick={() => actions.openVideo()}>Lisää</Button>}>
          {own.length === 0 ? <Quiet icon="play">Tallenna omia klippejä tai hyviä opetusvideoita vertailuun. Ne näkyvät myös valmentajallesi.</Quiet> : (
            <div className="k-list">
              {own.map((v) => (
                <div key={v.id} className="k-note-row">
                  <button type="button" className="k-video-thumb" style={{ '--h': v.hue }} onClick={() => actions.playVideo(v)} aria-label={`Katso ${v.title}`}><Icon name="play" size={14} /></button>
                  <div className="grow"><p className="k-note-text">{v.title}</p><span className="k-faint">{koutsiFmtShortDate(v.date)}</span></div>
                  <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeOwn(v)} />
                </div>
              ))}
            </div>
          )}
        </Block>
      </Page>
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name} size="md">
        {open && (
          <div className="stack-4">
            <div className="row wrap">
              {open.players && <span className="chip chip-md chip-neutral"><Icon name="users" size={14} />{open.players}</span>}
              {open.duration && <span className="chip chip-md chip-neutral"><Icon name="clock" size={14} />{open.duration}</span>}
              {open.level && <span className="chip chip-md chip-neutral">{open.level}</span>}
            </div>
            {open.goal && <p className="k-body-text">{open.goal}</p>}
            {open.video && <Button variant="dark" icon="play" onClick={() => { const v = open.video; setOpen(null); actions.playVideo({ ...v, title: v.title || open.name }); }}>Katso video</Button>}
          </div>
        )}
      </Sheet>
    </>
  );
}
