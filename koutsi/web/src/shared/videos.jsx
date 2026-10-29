// videos.jsx — sharing a video (file up to 50 MB or a link) and playing one. Used by the coach
// (to one or many players) and by the player (to their own bank).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { Button, ChipSelect, Disclosure, Field, Icon, IconButton, Input, ProgressBar, Sheet, Spinner } from '../ui/index.js';
import { koutsiTodayStr, koutsiRandomUuid, koutsiFmtShortDate, KOUTSI_TAGS, KOUTSI_TAG_LABELS } from '../domain/core.js';
import { VIDEO_MAX_BYTES } from '../lib/constants.js';
import { RecipientPicker } from './recipients.jsx';
import { sameIds, ScopeLine } from './scope.jsx';

/** "www.youtube.com/…" or "youtu.be/…" pasted without https:// still counts as a link. */
export function normalizeVideoUrl(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(t)) return `https://${t}`;
  return t;
}
const isVideoUrl = (u) => /^https?:\/\/[^\s/]+\.[^\s]+/i.test(u);
/** A title when the coach leaves it empty: the file's name, else where the link points. */
export function defaultVideoTitle(file, url) {
  if (file) return file.name.replace(/\.[^.]+$/, '') || 'Video';
  if (/youtu\.?be/i.test(url)) return 'YouTube-video';
  if (/drive\.google|docs\.google/i.test(url)) return 'Drive-video';
  return 'Video';
}
const megabytes = (bytes) => (bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} kt` : `${Math.round(bytes / 1048576)} Mt`);

/**
 * VideoShareSheet
 *   recipients: [{ id, name, … }] to pick from (coach) — omit for "own video" (player)
 *   initialIds: preselected recipients     groups: for the one-tap group picks
 *   One big "Valitse video" (the phone's own picker: a label around the file input, which every
 *   phone opens reliably) or a pasted link. The title is optional (the file's name or "YouTube-video").
 *   The button is never a dead grey: a tap with something missing says what is missing.
 *   The date (today) and topics are tucked under "Lisätiedot": they are rarely changed. Who it's
 *   for comes last, so the long player list never pushes the other fields out of sight.
 *   onSave({ shareId, title, date, tags, studentIds, file, externalUrl, onProgress }) → Promise
 */
/** scope: opened from a session or a group, which one — shown on top while those players are picked (scope.jsx)
 *  library: the coach's own videos (Lähetetyt on): "Omista videoista" picks one instead of a new file,
 *    and players who already have it show as "Saanut"; onSave then gets savedId
 *  allowEmpty: saving with nobody picked keeps the video in the coach's own videos ("Lisää video") */
export function VideoShareSheet({ open, onClose, recipients, initialIds = [], groups = [], onSave, title: sheetTitle = 'Jaa video', scope = null, library = null, allowEmpty = false }) {
  const [shareId, setShareId] = useState(() => koutsiRandomUuid());
  const [savedId, setSavedId] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const saved = savedId ? (library || []).find((v) => v.id === savedId) || null : null;
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(koutsiTodayStr());
  const [tags, setTags] = useState([]);
  const [ids, setIds] = useState(initialIds);
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const errorRef = useRef(null);
  const abortRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setShareId(koutsiRandomUuid()); setTitle(''); setDate(koutsiTodayStr()); setTags([]); setIds(initialIds);
    setFile(null); setUrl(''); setBusy(false); setProgress(0); setError(''); setSavedId(null); setLibraryOpen(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Who already has the picked video: they can't be picked again.
  const received = useMemo(() => {
    if (!saved || !recipients) return null;
    const out = new Map();
    recipients.forEach((st) => { const v = (st.videos || []).find((x) => x.shareId === saved.id); if (v) out.set(st.id, v.at); });
    return out;
  }, [saved, recipients]);
  const pickSaved = (v) => {
    setSavedId(v.id); setLibraryOpen(false); setFile(null); setUrl(''); setError('');
    const have = new Set((recipients || []).filter((st) => (st.videos || []).some((x) => x.shareId === v.id)).map((st) => st.id));
    setIds((prev) => prev.filter((id) => !have.has(id)));
  };
  const pick = (f) => {
    setError('');
    if (!f) return;
    if (f.size > VIDEO_MAX_BYTES) {
      setFile(null);
      setError(`Video on ${megabytes(f.size)}, ja suoraan voi ladata enintään 50 Mt. Lyhennä video puhelimessa (Muokkaa → rajaa alku ja loppu) tai lataa se YouTubeen rajatulla näkyvyydellä ja liitä linkki alle.`);
      return;
    }
    setFile(f); setUrl('');
  };
  const link = normalizeVideoUrl(url);
  const missing = saved ? (recipients && ids.length === 0 ? 'Valitse ainakin yksi pelaaja.' : '')
    : !file && !url.trim() ? (library?.length ? 'Valitse video, liitä linkki tai valitse omista videoista.' : 'Valitse video tai liitä linkki.')
      : !file && !isVideoUrl(link) ? 'Linkki ei näytä videon osoitteelta. Liitä koko osoite, esim. https://youtu.be/…'
        : recipients && ids.length === 0 && !allowEmpty ? 'Valitse ainakin yksi pelaaja.'
          : !date ? 'Valitse päivä.' : '';
  const showError = (text) => {
    setError(text);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  const submit = async () => {
    if (busy) return;
    if (missing) { showError(missing); return; }
    setBusy(true); setProgress(0); setError('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await onSave(saved
        ? { savedId: saved.id, shareId, title: saved.title, date: koutsiTodayStr(), tags: saved.tags || [], studentIds: ids, file: null, externalUrl: null, onProgress: setProgress, signal: ctrl.signal }
        : { shareId, title: title.trim() || defaultVideoTitle(file, link), date, tags, studentIds: ids, file: file || null, externalUrl: file ? null : link, onProgress: setProgress, signal: ctrl.signal });
      if (!ctrl.signal.aborted) onClose();
    } catch (err) {
      if (!ctrl.signal.aborted) showError(err?.userMessage || 'Videon tallennus epäonnistui. Tarkista nettiyhteys ja yritä uudelleen.');
    } finally {
      if (abortRef.current === ctrl) { abortRef.current = null; setBusy(false); }
    }
  };
  // An upload can take minutes on a phone: Peruuta stops it (nothing is shared, the file is removed).
  const cancel = () => {
    if (busy && abortRef.current) { abortRef.current.abort(); abortRef.current = null; setBusy(false); }
    onClose();
  };
  const label = busy && file ? `Ladataan ${progress} %`
    : recipients && !(allowEmpty && ids.length === 0) ? (ids.length > 1 ? `Jaa ${ids.length} pelaajalle` : 'Jaa')
      : allowEmpty ? 'Tallenna videoihin' : 'Tallenna';
  const fileInput = <input type="file" accept="video/*" className="sr-only" tabIndex={-1} disabled={busy} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />;
  return (
    <>
    <Sheet open={open} onClose={() => !busy && onClose()} title={sheetTitle} size="md" dismissible={!busy}
      confirmClose={!busy && Boolean(file || url.trim() || title.trim() || saved)}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={cancel} disabled={busy && !file}>{busy && file ? 'Peru lataus' : 'Peruuta'}</Button><Button variant="dark" size="lg" className={missing ? 'is-incomplete' : undefined} loading={busy} onClick={submit}>{label}</Button></div>}>
      <div className="stack-4">
        {scope && sameIds(ids, initialIds) && <ScopeLine scope={scope} />}
        {saved ? (
          <div className="k-file-picked">
            <span className="k-video-thumb" style={{ '--h': saved.hue }} aria-hidden="true"><Icon name="play" size={14} /></span>
            <span className="grow k-file-picked-text"><strong className="truncate">{saved.title}</strong><span className="k-faint">Omista videoista</span></span>
            {!busy && <Button variant="soft" size="sm" onClick={() => setLibraryOpen(true)}>Vaihda</Button>}
            {!busy && <IconButton icon="close" label="Poista valinta" size="sm" onClick={() => setSavedId(null)} />}
          </div>
        ) : file ? (
          <div className="k-file-picked">
            <span className="k-file-picked-icon" aria-hidden="true"><Icon name="play" size={18} /></span>
            <span className="grow k-file-picked-text"><strong className="truncate">{file.name}</strong><span className="k-faint">{megabytes(file.size)}</span></span>
            {!busy && <Button as="label" variant="soft" size="sm">Vaihda{fileInput}</Button>}
            {!busy && <IconButton icon="close" label="Poista valittu video" size="sm" onClick={() => setFile(null)} />}
          </div>
        ) : (
          <div className="stack-3">
            <Button as="label" variant="outline" size="lg" block icon="play">Valitse video{fileInput}</Button>
            <p className="field-msg k-file-hint">Puhelimen kuvista tai koneelta, enintään 50 Mt.</p>
            {library?.length > 0 && (
              <Button variant="soft" size="lg" block icon="list" onClick={() => setLibraryOpen(true)}>Omista videoista ({library.length})</Button>
            )}
            <Field label="tai liitä linkki" htmlFor="v-url" hint="YouTube, Google Drive tai muu linkki. Käytä rajattua näkyvyyttä.">
              <Input id="v-url" icon="link" value={url} onChange={(e) => { setUrl(e.target.value); setError(''); }} placeholder="https://…" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </Field>
          </div>
        )}
        {busy && file && <ProgressBar value={progress / 100} label="Latauksen eteneminen" />}
        {error && <p ref={errorRef} className="field-msg field-msg-error" role="alert">{error}</p>}
        {!saved && (<>
        <Field label="Otsikko" optional htmlFor="v-title"><Input id="v-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file || link ? defaultVideoTitle(file, link) : 'Esim. Syöttöanalyysi'} maxLength={120} /></Field>
        <Disclosure title="Lisätiedot" summary={`${date === koutsiTodayStr() ? 'Tänään' : koutsiFmtShortDate(date)}${tags.length ? `, ${tags.map((t) => KOUTSI_TAG_LABELS[t]).join(', ')}` : ''}`} icon="sliders">
          <div className="stack-4">
            <Field label="Päivä" htmlFor="v-date"><Input id="v-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Aiheet" optional>
              <ChipSelect multiple size="sm" options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={tags} onChange={setTags} ariaLabel="Aiheet" />
            </Field>
          </div>
        </Disclosure>
        </>)}
        {recipients && (
          <Field label={allowEmpty ? `Jaa pelaajille${ids.length ? ` (${ids.length})` : ''}` : `Kenelle (${ids.length} valittu)`}
            hint={allowEmpty && !ids.length ? 'Voit myös vain tallentaa videon ja jakaa sen myöhemmin.' : undefined}>
            <RecipientPicker students={recipients} groups={groups} value={ids} onChange={(next) => { setIds(next); setError(''); }} open={open} received={received} />
          </Field>
        )}
      </div>
    </Sheet>
    <Sheet open={open && libraryOpen} onClose={() => setLibraryOpen(false)} title="Omat videot" subtitle="Jaa sama video uudelleen — sitä ei tarvitse ladata toista kertaa." size="md">
        <div className="k-list">
          {(library || []).map((v) => (
            <button key={v.id} type="button" className="k-row" onClick={() => pickSaved(v)}>
              <span className="k-video-thumb" style={{ '--h': v.hue }} aria-hidden="true"><Icon name="play" size={14} /></span>
              <span className="k-row-main">
                <span className="k-row-title truncate">{v.title}</span>
                <span className="k-row-sub truncate">{v.line || (v.externalUrl ? 'Linkki' : 'Video')}</span>
              </span>
            </button>
          ))}
        </div>
    </Sheet>
    </>
  );
}

/** Plays a stored video through a signed URL, or opens an external link. */
export function VideoPlayerSheet({ video, onClose }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setSrc(null); setError('');
    if (!video?.storagePath) return undefined;
    let alive = true;
    api.videos.url(video.storagePath).then((u) => { if (alive) setSrc(u); }).catch((err) => { if (alive) setError(err.userMessage); });
    return () => { alive = false; };
  }, [video?.storagePath]);
  return (
    <Sheet open={Boolean(video)} onClose={onClose} title={video?.title || 'Video'} size="lg">
      {video?.externalUrl && !video.storagePath ? (
        <div className="stack-3">
          <p className="k-quiet-text">Video on ulkoisessa palvelussa.</p>
          <Button as="a" href={video.externalUrl} target="_blank" rel="noopener noreferrer" variant="dark" icon="external">Avaa video</Button>
        </div>
      ) : error ? <p className="field-msg field-msg-error">{error}</p> : src ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video className="k-video" src={src} controls playsInline preload="metadata"
          onError={() => setError('Video ei toistu tällä laitteella (esim. iPhonen HEVC-video Androidilla). Avaa se toisella laitteella tai jaa video linkkinä.')} />
      ) : <div className="center k-video-loading"><Spinner /></div>}
    </Sheet>
  );
}
