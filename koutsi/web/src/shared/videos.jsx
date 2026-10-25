// videos.jsx — sharing a video (file up to 50 MB or a link) and playing one. Used by the coach
// (to one or many players) and by the player (to their own bank).
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { Button, ChipSelect, Disclosure, Field, Input, ProgressBar, Segmented, Sheet, Spinner } from '../ui/index.js';
import { koutsiTodayStr, koutsiRandomUuid, koutsiFmtShortDate, KOUTSI_TAGS, KOUTSI_TAG_LABELS } from '../domain/core.js';
import { VIDEO_MAX_BYTES } from '../lib/constants.js';
import { RecipientPicker } from './recipients.jsx';
import { sameIds, ScopeLine } from './scope.jsx';

/**
 * VideoShareSheet
 *   recipients: [{ id, name, … }] to pick from (coach) — omit for "own video" (player)
 *   initialIds: preselected recipients     groups: for the one-tap group picks
 *   The date (today) and topics are tucked under "Lisätiedot": they are rarely changed. Who it's
 *   for comes last, so the long player list never pushes the other fields out of sight.
 *   onSave({ shareId, title, date, tags, studentIds, file, externalUrl, onProgress }) → Promise
 */
/** scope: opened from a session or a group, which one — shown on top while those players are picked (scope.jsx) */
export function VideoShareSheet({ open, onClose, recipients, initialIds = [], groups = [], onSave, title: sheetTitle = 'Jaa video', scope = null }) {
  const [shareId, setShareId] = useState(() => koutsiRandomUuid());
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(koutsiTodayStr());
  const [tags, setTags] = useState([]);
  const [ids, setIds] = useState(initialIds);
  const [source, setSource] = useState('link');
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setShareId(koutsiRandomUuid()); setTitle(''); setDate(koutsiTodayStr()); setTags([]); setIds(initialIds);
    setSource('link'); setFile(null); setUrl(''); setBusy(false); setProgress(0); setError('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (f) => {
    setError('');
    if (!f) return;
    if (f.size > VIDEO_MAX_BYTES) {
      setFile(null); setSource('link');
      setError(`${Math.round(f.size / 1048576)} Mt on suoraksi lataukseksi liian suuri. Lataa video YouTubeen tai Driveen rajatulla näkyvyydellä ja liitä linkki.`);
      return;
    }
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };
  const hasSource = source === 'file' ? Boolean(file) : /^https?:\/\//i.test(url.trim());
  const ready = title.trim() && date && hasSource && (!recipients || ids.length > 0) && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true); setProgress(0); setError('');
    try {
      await onSave({ shareId, title: title.trim(), date, tags, studentIds: ids, file: source === 'file' ? file : null, externalUrl: source === 'link' ? url.trim() : null, onProgress: setProgress });
      onClose();
    } catch (err) {
      setError(err.userMessage || 'Videon tallennus epäonnistui.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={sheetTitle} size="md" dismissible={!busy}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={submit}>{busy && source === 'file' ? `Ladataan ${progress} %` : recipients ? (ids.length > 1 ? `Jaa ${ids.length} pelaajalle` : 'Jaa') : 'Tallenna'}</Button></div>}>
      <div className="stack-4">
        {scope && sameIds(ids, initialIds) && <ScopeLine scope={scope} />}
        <Segmented options={[{ value: 'link', label: 'Linkki', icon: 'link' }, { value: 'file', label: 'Tiedosto', icon: 'play' }]} value={source} onChange={setSource} ariaLabel="Videon lähde" />
        {source === 'link' ? (
          <Field label="Videon osoite" htmlFor="v-url" hint="YouTube, Google Drive tai muu linkki. Käytä rajattua näkyvyyttä.">
            <Input id="v-url" icon="link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" inputMode="url" />
          </Field>
        ) : (
          <Field label="Videotiedosto" hint="Enintään 50 Mt. Pidemmän videon voi jakaa linkkinä.">
            <div className="row">
              <Button variant="outline" icon="play" onClick={() => fileRef.current?.click()}>{file ? 'Vaihda tiedosto' : 'Valitse video'}</Button>
              {file && <span className="truncate k-faint">{file.name}</span>}
            </div>
            <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
          </Field>
        )}
        {busy && source === 'file' && <ProgressBar value={progress / 100} label="Latauksen eteneminen" />}
        {error && <p className="field-msg field-msg-error" role="alert">{error}</p>}
        <Field label="Otsikko" htmlFor="v-title"><Input id="v-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Syöttöanalyysi" maxLength={120} /></Field>
        <Disclosure title="Lisätiedot" summary={`${date === koutsiTodayStr() ? 'Tänään' : koutsiFmtShortDate(date)}${tags.length ? ` · ${tags.map((t) => KOUTSI_TAG_LABELS[t]).join(', ')}` : ''}`} icon="sliders">
          <div className="stack-4">
            <Field label="Päivä" htmlFor="v-date"><Input id="v-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Aiheet" optional>
              <ChipSelect multiple size="sm" options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={tags} onChange={setTags} ariaLabel="Aiheet" />
            </Field>
          </div>
        </Disclosure>
        {recipients && (
          <Field label={`Kenelle (${ids.length} valittu)`}>
            <RecipientPicker students={recipients} groups={groups} value={ids} onChange={setIds} open={open} />
          </Field>
        )}
      </div>
    </Sheet>
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
        <video className="k-video" src={src} controls playsInline preload="metadata" />
      ) : <div className="center k-video-loading"><Spinner /></div>}
    </Sheet>
  );
}
