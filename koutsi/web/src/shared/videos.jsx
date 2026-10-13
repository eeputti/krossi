// videos.jsx — sharing a video (file up to 50 MB or a link) and playing one. Used by the coach
// (to one or many players) and by the player (to their own bank).
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { Avatar, Button, ChipSelect, Field, Input, ProgressBar, Segmented, Sheet, Spinner } from '../ui/index.js';
import { koutsiTodayStr, koutsiRandomUuid, KOUTSI_TAGS, KOUTSI_TAG_LABELS } from '../domain/core.js';
import { matchStudents } from '../domain/roster.js';
import { VIDEO_MAX_BYTES } from '../lib/constants.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * VideoShareSheet
 *   recipients: [{ id, name, … }] to pick from (coach) — omit for "own video" (player)
 *   initialIds: preselected recipients     groups: for "+ group" quick picks
 *   onSave({ shareId, title, date, tags, studentIds, file, externalUrl, onProgress }) → Promise
 */
export function VideoShareSheet({ open, onClose, recipients, initialIds = [], groups = [], onSave, title: sheetTitle = 'Jaa video' }) {
  const [shareId, setShareId] = useState(() => koutsiRandomUuid());
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(koutsiTodayStr());
  const [tags, setTags] = useState([]);
  const [ids, setIds] = useState(initialIds);
  const [query, setQuery] = useState('');
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
    setQuery(''); setSource('link'); setFile(null); setUrl(''); setBusy(false); setProgress(0); setError('');
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
  const list = useMemo(() => (recipients ? (query.trim() ? matchStudents(recipients, query, { limit: 60 }) : recipients) : []), [recipients, query]);
  const toggle = (id) => setIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={sheetTitle} size="md" dismissible={!busy}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={submit}>{busy && source === 'file' ? `Ladataan ${progress} %` : 'Tallenna'}</Button></div>}>
      <div className="stack-4">
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
        <Field label="Päivä" htmlFor="v-date"><Input id="v-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Aiheet" optional>
          <ChipSelect multiple size="sm" options={KOUTSI_TAGS.map((t) => ({ value: t, label: KOUTSI_TAG_LABELS[t] }))} value={tags} onChange={setTags} ariaLabel="Aiheet" />
        </Field>
        {recipients && (
          <Field label={`Kenelle (${ids.length} valittu)`}>
            {groups.length > 0 && (
              <div className="row wrap k-group-picks">
                {groups.map((g) => (
                  <button key={g.id} type="button" className="planner-chip" onClick={() => setIds((p) => [...new Set([...p, ...g.memberIds.filter((id) => recipients.some((r) => r.id === id))])])}>
                    + {g.day} {g.time} {g.name}
                  </button>
                ))}
              </div>
            )}
            {recipients.length > 8 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä" aria-label="Hae pelaajaa" />}
            <div className="k-pick-list">
              {list.map((s) => (
                <label key={s.id} className={cx('k-pick', ids.includes(s.id) && 'is-on')}>
                  <input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} />
                  <Avatar person={s} size={28} /><span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
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
