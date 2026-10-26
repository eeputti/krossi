// VideosTab — "Harjoitteet ja videot" → Videot: the coach's own videos (state.videoLibrary). Every
// video the coach shares lands here and stays, also when no player has it any more, so the same
// video can go to another group later without uploading it again. A row says who has it now and
// when it was last sent; a tap opens it: Katso, who has it, where it has gone, Jaa pelaajille
// ("Saanut" for those who have it), Muokkaa (name, topics) and Poista video (from everyone).
// Under them the coach's drills that have a video, which open the drill.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, ChipSelect, EmptyState, Field, Icon, Input, Sheet, useConfirm } from '../ui/index.js';
import { VideoPlayerSheet } from '../shared/videos.jsx';
import { Block } from '../shared/bits.jsx';
import { KOUTSI_TAGS, KOUTSI_TAG_LABELS } from '../domain/core.js';
import { groupsCovering, libraryItems, libraryLine, recipientsLabel, sentWhen } from '../domain/sends.js';
import { SendOnSheet } from './sent.jsx';
import { useRecord } from './merkitse.jsx';
import { exercisePath } from './nav.js';
import { track } from './usage.js';

const players = (n) => (n === 1 ? '1 pelaaja' : `${n} pelaajaa`);

export function VideosTab() {
  const { state } = useData();
  const record = useRecord();
  const [openId, setOpenId] = useState(null);
  const videos = useMemo(() => libraryItems(state), [state]);
  const drillVideos = state.exercises.filter((e) => e.video);
  const add = () => { track('videot.lisaa'); record.open('video', { allowEmpty: true }); };
  return (
    <div className="stack-6">
      {videos.length === 0 ? (
        <EmptyState art="court" compact title="Ei vielä videoita"
          text="Jokainen jakamasi video tallentuu tänne. Voit jakaa saman videon myöhemmin muillekin ryhmille lataamatta sitä uudelleen."
          action={<Button variant="dark" icon="plus" onClick={add}>Lisää video</Button>} />
      ) : (
        <Block eyebrow="Omat videot" title={`${videos.length} ${videos.length === 1 ? 'video' : 'videota'}`}
          action={<Button variant="outline" size="sm" icon="plus" onClick={add}>Lisää video</Button>}>
          <div className="k-list">
            {videos.map((v) => (
              <button key={v.id} type="button" className="k-row" onClick={() => { track('videot.avaa'); setOpenId(v.id); }}>
                <span className="k-video-thumb" style={{ '--h': v.hue }} aria-hidden="true"><Icon name="play" size={14} /></span>
                <span className="k-row-main">
                  <span className="k-row-title truncate">{v.title}</span>
                  <span className="k-row-sub truncate">{libraryLine(state, v)}</span>
                </span>
              </button>
            ))}
          </div>
        </Block>
      )}
      {drillVideos.length > 0 && (
        <Block eyebrow="Harjoitteiden videot" title={`${drillVideos.length} ${drillVideos.length === 1 ? 'harjoite' : 'harjoitetta'}`}>
          <div className="k-list">
            {drillVideos.map((e) => (
              <button key={e.id} type="button" className="k-row" onClick={() => navigate(exercisePath(e.id))}>
                <span className="k-video-thumb" style={{ '--h': 150 }} aria-hidden="true"><Icon name="play" size={14} /></span>
                <span className="k-row-main">
                  <span className="k-row-title truncate">{e.video.title || e.name}</span>
                  <span className="k-row-sub truncate">Harjoite: {e.name} · pelaajasi näkevät sen pankissa</span>
                </span>
              </button>
            ))}
          </div>
        </Block>
      )}
      <VideoSheet videoId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** One of the coach's videos, opened. */
function VideoSheet({ videoId, onClose }) {
  const { state, run } = useData();
  const confirm = useConfirm();
  const live = useMemo(() => (videoId ? libraryItems(state).find((v) => v.id === videoId) || null : null), [state, videoId]);
  const [shown, setShown] = useState(null);
  useEffect(() => { if (live) setShown(live); }, [live]);
  const video = live || shown;
  const [playing, setPlaying] = useState(null);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEditing(false); setSharing(false); }, [videoId]);
  useEffect(() => { if (videoId && !live && shown) onClose(); }, [videoId, live]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!video) return null;

  const holders = video.holderIds.map((id) => state.students.find((s) => s.id === id)).filter(Boolean);
  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    const res = await run(() => api.videos.updateSaved(video.id, { title, tags }), 'Video päivitetty.');
    setBusy(false);
    if (res.ok) setEditing(false);
  };
  const remove = async () => {
    const ok = await confirm({
      title: 'Poista video?',
      message: holders.length ? `${video.title} poistuu omista videoistasi ja ${holders.length === 1 ? '1 pelaajalta' : `${holders.length} pelaajalta`}.` : `${video.title} poistuu omista videoistasi.`,
      confirmLabel: 'Poista', danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const res = await run(() => api.videos.removeSaved(video.id), 'Video poistettu.');
    setBusy(false);
    if (res.ok) { track('videot.poista'); onClose(); }
  };

  const footer = editing ? (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={() => setEditing(false)} disabled={busy}>Peruuta</Button>
      <Button variant="dark" size="lg" loading={busy} missing={!title.trim() ? 'Anna videolle nimi.' : null} onClick={save}>Tallenna</Button>
    </div>
  ) : (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={() => { setTitle(video.title); setTags(video.tags || []); setEditing(true); }}>Muokkaa</Button>
      <Button variant="dark" size="lg" icon="send" onClick={() => { track('videot.jaa'); setSharing(true); }}>Jaa pelaajille</Button>
    </div>
  );
  return (
    <>
      <Sheet open={Boolean(videoId)} onClose={() => !busy && onClose()} title={editing ? 'Muokkaa videota' : video.title}
        subtitle={editing ? null : `Tallennettu ${sentWhen(video.at)}`} size="md" footer={footer}>
        {editing ? (
          <div className="stack-4">
            <Field label="Nimi" htmlFor="vl-title"><Input id="vl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
            <Field label="Aiheet" optional>
              <ChipSelect multiple size="sm" options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={tags} onChange={setTags} ariaLabel="Aiheet" />
            </Field>
            <p className="k-faint">Uusi nimi näkyy myös pelaajille, joilla video on.</p>
          </div>
        ) : (
          <div className="stack-5">
            <button type="button" className="sent-video" onClick={() => setPlaying(video)}>
              <span className="k-video-thumb" style={{ '--h': video.hue }}><Icon name="play" size={16} /></span>
              <span className="grow sent-video-title">{video.externalUrl ? 'Avaa linkki' : 'Katso video'}</span>
              {(video.tags || []).length > 0 && <span className="k-faint">{video.tags.map((t) => KOUTSI_TAG_LABELS[t]).join(', ')}</span>}
            </button>
            <section className="stack-2" aria-label="Kuka näkee">
              <div className="sent-section-head">
                <span className="field-label">Kuka näkee nyt</span>
                <span className="k-faint">{players(holders.length)}</span>
              </div>
              {holders.length ? (
                <p className="sent-who">{recipientsLabel(state, { groupIds: groupsCovering(state.groups, video.holderIds), studentIds: video.holderIds })}</p>
              ) : <p className="k-quiet">Ei kukaan. Jaa video pelaajille, kun haluat.</p>}
            </section>
            {video.sends.length > 0 && (
              <section className="stack-2" aria-label="Jaettu">
                <span className="field-label">Jaettu</span>
                <div className="sent-related">
                  {video.sends.map((x) => (
                    <div key={x.id} className="sent-related-row">
                      <span className="k-faint">{sentWhen(x.at)}</span>
                      <span className="grow truncate">{recipientsLabel(state, x)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <button type="button" className="k-textlink is-danger sent-remove" onClick={remove} disabled={busy}>Poista video</button>
          </div>
        )}
      </Sheet>
      <SendOnSheet open={sharing} item={{ kind: 'video', videoId: video.id, title: video.title }} onClose={() => setSharing(false)} />
      <VideoPlayerSheet video={playing} onClose={() => setPlaying(null)} />
    </>
  );
}
