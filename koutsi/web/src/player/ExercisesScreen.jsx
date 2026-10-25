// ExercisesScreen (player) — two tabs: the drill bank (Krossi's library plus the coach's own
// drills and their videos) and the videos (shared by the coach, and the player's own clips).
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Icon, IconButton, Page, PageHeader, Segmented, Sheet, useConfirm } from '../ui/index.js';
import { Block, Quiet } from '../shared/bits.jsx';
import { koutsiFmtShortDate } from '../domain/core.js';
import { buildDrillList } from '../domain/drills/index.js';
import { DrillBrowser } from '../shared/drills/browser.jsx';
import { DrillDetail } from '../shared/drills/detail.jsx';
import { useDrillLibrary } from '../shared/drills/useLibrary.js';
import { usePlayerActions } from './PlayerApp.jsx';

let lastTab = 'drills';

export function ExercisesScreen() {
  const { state, run } = useData();
  const actions = usePlayerActions();
  const confirm = useConfirm();
  const me = state.students[0];
  const [tab, setTab] = useState(lastTab);
  const [open, setOpen] = useState(null);
  const { library, failed, retry } = useDrillLibrary();
  // A player with two coaches sees each starter drill once (the one with a video wins).
  const items = useMemo(() => buildDrillList(state.exercises, { library: library || [], dedupe: true }), [state.exercises, library]);
  const own = (me.videos || []).filter((v) => v.addedBy === 'player');
  const fromCoach = (me.videos || []).filter((v) => v.addedBy !== 'player');
  const removeOwn = async (v) => {
    if (await confirm({ title: 'Poista video?', message: `${v.title} poistetaan pysyvästi.`, confirmLabel: 'Poista', danger: true })) await run(() => api.videos.remove(v.id), 'Video poistettu.');
  };
  const pickTab = (v) => { lastTab = v; setTab(v); };
  const videoCount = own.length + fromCoach.length;
  return (
    <>
      <Page className="stack-5">
        <PageHeader title="Harjoitteet ja videot" />
        <Segmented ariaLabel="Näytä" value={tab} onChange={pickTab}
          options={[{ value: 'drills', label: 'Harjoitteet' }, { value: 'videos', label: 'Videot', badge: videoCount || null }]} />
        {tab === 'drills' ? (
          <DrillBrowser items={items} role="player" onOpen={setOpen} loading={!library && !failed} failed={failed} onRetry={retry} />
        ) : (
          <div className="stack-6">
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
          </div>
        )}
      </Page>
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title={open?.name} size="lg">
        {open && (
          <DrillDetail item={open} role="player" compact
            actions={open.video ? (
              <div className="dd-actions">
                <Button variant="dark" icon="play" onClick={() => { const v = open.video; setOpen(null); actions.playVideo({ ...v, title: v.title || open.name }); }}>Katso valmentajan video</Button>
              </div>
            ) : null} />
        )}
      </Sheet>
    </>
  );
}
