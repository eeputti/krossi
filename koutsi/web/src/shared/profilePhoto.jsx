// profilePhoto.jsx — changing one's own profile picture, the same for coaches and players.
// On a phone a tap on the photo opens the phone's own picker at once (iPhone: Kuvakirjasto / Ota kuva /
// Valitse tiedosto) — a menu of our own before it made the phone ask the same thing twice. "Poista kuva"
// is a link next to the photo (remove). On a computer the tap opens "Valitse kuva" / "Ota uusi kuva"
// (/ "Poista kuva"); the webcam shows in a sheet, which makes the browser ask for the camera first. Every photo then goes through a square crop (drag to
// move, pinch / wheel / slider to zoom) and is saved as a 512 px JPEG, so a big phone photo
// uploads in a moment and always sits nicely in the round avatar.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useOptionalData } from '../app/data.jsx';
import { useSession } from '../app/session.jsx';
import { Button, Icon, ListRow, Sheet, Spinner, useConfirm, useToast } from '../ui/index.js';

const OUT_PX = 512;      // saved photo, square
const SOURCE_MAX = 2048; // larger photos are scaled down before cropping
const MAX_ZOOM = 4;

const isPhone = () => Boolean(window.matchMedia?.('(pointer: coarse)').matches);
const hasWebcam = () => Boolean(navigator.mediaDevices?.getUserMedia);
const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('image')));
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

/** An object URL of the photo, scaled down when it is very large. Throws when it isn't an image the browser can show. */
async function prepareSource(blob) {
  const raw = URL.createObjectURL(blob);
  try {
    const img = await loadImage(raw);
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    if (long <= SOURCE_MAX) return raw;
    const k = SOURCE_MAX / long;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const small = await toBlob(canvas, 0.92);
    if (!small) throw new Error('image');
    URL.revokeObjectURL(raw);
    return URL.createObjectURL(small);
  } catch (err) {
    URL.revokeObjectURL(raw);
    throw err;
  }
}

// ── Crop math: the image covers a size×size box; x/y is its top-left corner in the box ──────
const baseScale = (img, size) => size / Math.min(img.naturalWidth, img.naturalHeight);
function clampView(v, img, size) {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
  const s = baseScale(img, size) * z;
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  return { z, s, x: Math.min(0, Math.max(size - w, v.x)), y: Math.min(0, Math.max(size - h, v.y)) };
}
const centredView = (img, size) => {
  const s = baseScale(img, size);
  return clampView({ z: 1, x: (size - img.naturalWidth * s) / 2, y: (size - img.naturalHeight * s) / 2 }, img, size);
};
/** Zoom to `z`, keeping the image point under (px, py) where it is. */
function zoomAround(v, img, size, z, px, py) {
  const cur = clampView(v, img, size);
  const ix = (px - cur.x) / cur.s;
  const iy = (py - cur.y) / cur.s;
  const nz = Math.min(MAX_ZOOM, Math.max(1, z));
  const s = baseScale(img, size) * nz;
  return clampView({ z: nz, x: px - ix * s, y: py - iy * s }, img, size);
}

function PhotoCropSheet({ open, src, busy, onClose, onClosed, onSave, onPickOther }) {
  const box = useRef(null);
  const [img, setImg] = useState(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState(280);
  const [view, setView] = useState(null);
  const viewRef = useRef(null);
  viewRef.current = view;
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  useEffect(() => {
    if (!src) return undefined;
    let alive = true;
    setImg(null); setFailed(false); setView(null);
    loadImage(src).then((i) => alive && setImg(i)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [src]);

  // The crop box is as wide as the sheet allows, at most 320 px.
  useEffect(() => {
    if (!open) return undefined;
    const measure = () => {
      const w = box.current?.parentElement?.clientWidth || 280;
      setSize(Math.max(200, Math.min(320, Math.floor(w))));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [open, img]);

  useEffect(() => { if (img) setView(centredView(img, size)); }, [img, size]);

  // A mouse wheel zooms around the pointer (needs a non-passive listener to stop the page scrolling).
  useEffect(() => {
    const el = box.current;
    if (!el || !img) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (v) setView(zoomAround(v, img, size, v.z * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [img, size]);

  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const v = viewRef.current;
    if (!v || !pts.length) { gesture.current = null; return; }
    if (pts.length === 1) {
      gesture.current = { kind: 'pan', x0: pts[0].x, y0: pts[0].y, v0: v };
    } else {
      const [a, b] = pts;
      gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, v0: v };
    }
  };
  const onPointerDown = (e) => {
    if (!img || busy) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === 'pan') {
      setView(clampView({ ...g.v0, x: g.v0.x + (e.clientX - g.x0), y: g.v0.y + (e.clientY - g.y0) }, img, size));
    } else {
      const [a, b] = [...pointers.current.values()];
      const r = box.current.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setView(zoomAround(g.v0, img, size, g.v0.z * (d / g.d0), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top));
    }
  };
  const onPointerEnd = (e) => {
    pointers.current.delete(e.pointerId);
    startGesture();
  };

  const save = async () => {
    if (!img || !view || busy) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUT_PX;
    canvas.height = OUT_PX;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // a transparent PNG gets a white background, not a black one
    ctx.fillRect(0, 0, OUT_PX, OUT_PX);
    ctx.imageSmoothingQuality = 'high';
    const { x, y, s } = clampView(view, img, size);
    ctx.drawImage(img, -x / s, -y / s, size / s, size / s, 0, 0, OUT_PX, OUT_PX);
    const blob = await toBlob(canvas, 0.88);
    if (blob) onSave(blob);
  };

  const v = view && img ? clampView(view, img, size) : null;
  return (
    <Sheet open={open} onClose={onClose} onClosed={onClosed} title="Rajaa kuva" size="sm" dismissible={false}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" loading={busy} disabled={!v} onClick={save}>Tallenna kuva</Button>
        </div>
      )}>
      <div className="photo-crop-wrap">
        <div ref={box} className={`photo-crop${v ? ' is-ready' : ''}`} style={{ width: size, height: size }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
          {v && (
            <img src={src} alt="" draggable={false}
              style={{ width: img.naturalWidth, height: img.naturalHeight, transform: `translate(${v.x}px, ${v.y}px) scale(${v.s})` }} />
          )}
          {!v && !failed && <span className="photo-crop-status"><Spinner size={22} /></span>}
          {failed && <span className="photo-crop-status">Kuvaa ei voitu avata. Kokeile toista kuvaa (JPG tai PNG).</span>}
          <span className="photo-crop-ring" aria-hidden="true" />
        </div>
        {v && (
          <label className="photo-crop-zoom">
            <Icon name="image" size={14} />
            <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={v.z} aria-label="Zoomaa kuvaa"
              onChange={(e) => setView(zoomAround(v, img, size, Number(e.target.value), size / 2, size / 2))} />
            <Icon name="image" size={20} />
          </label>
        )}
        <p className="photo-crop-hint">Siirrä kuvaa vetämällä ja zoomaa liukusäätimellä.</p>
        <button type="button" className="photo-crop-other" onClick={onPickOther} disabled={busy}>Valitse toinen kuva</button>
      </div>
    </Sheet>
  );
}

function cameraError(err) {
  const name = err?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Kameran käyttö on estetty. Salli kamera selaimen osoiterivin kuvakkeesta ja yritä uudelleen.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Laitteesta ei löytynyt kameraa.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Kamera on toisen sovelluksen käytössä. Sulje se ja yritä uudelleen.';
  return 'Kamera ei käynnistynyt.';
}

/** The computer's webcam: the browser asks for the camera, then a mirrored preview and "Ota kuva". */
function CameraSheet({ open, onClose, onShot, onPickFile }) {
  const video = useRef(null);
  const stream = useRef(null);
  const [status, setStatus] = useState('asking'); // asking | live | error
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const attach = useCallback((el) => {
    video.current = el;
    if (el && stream.current && el.srcObject !== stream.current) {
      el.srcObject = stream.current;
      el.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setStatus('asking');
    setError('');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => {
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        attach(video.current);
        setStatus('live');
      })
      .catch((err) => { if (alive) { setStatus('error'); setError(cameraError(err)); } });
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = null;
      if (video.current) video.current.srcObject = null;
    };
  }, [open, attempt, attach]);

  const shoot = async () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    // saved as seen: the preview is a mirror, so is the photo
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, 0.92);
    if (blob) onShot(blob);
  };

  return (
    <Sheet open={open} onClose={onClose} title="Ota uusi kuva" size="sm"
      footer={status === 'error' ? (
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onPickFile}>Valitse kuva</Button>
          <Button variant="dark" size="lg" icon="refresh" onClick={() => setAttempt((n) => n + 1)}>Yritä uudelleen</Button>
        </div>
      ) : (
        <Button variant="dark" size="lg" block icon="camera" disabled={status !== 'live'} onClick={shoot}>Ota kuva</Button>
      )}>
      <div className="photo-camera">
        {status !== 'error' && (
          <div className="photo-camera-frame">
            <video ref={attach} className="photo-camera-video" playsInline muted autoPlay />
            <span className="photo-crop-ring" aria-hidden="true" />
            {status === 'asking' && (
              <span className="photo-crop-status"><Spinner size={22} /><span>Salli kameran käyttö selaimen ilmoituksesta.</span></span>
            )}
          </div>
        )}
        {status === 'error' && (
          <div className="photo-camera-error">
            <span className="photo-camera-error-icon"><Icon name="camera" size={22} /></span>
            <p>{error}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function PhotoMenuSheet({ open, onClose, hasPhoto, onChoose, onTake, onRemove }) {
  return (
    <Sheet open={open} onClose={onClose} title="Profiilikuva" size="sm">
      <div className="list-group">
        <ListRow icon="image" title="Valitse kuva" subtitle={isPhone() ? 'Kuvista tai tiedostoista' : 'Tältä tietokoneelta'} onClick={onChoose} chevron={false} />
        <ListRow icon="camera" title="Ota uusi kuva" subtitle="Kameralla" onClick={onTake} chevron={false} />
        {hasPhoto && <ListRow icon="trash" tone="danger" title="Poista kuva" onClick={onRemove} chevron={false} />}
      </div>
    </Sheet>
  );
}

/**
 * useProfilePhoto({ uid, person, onCropped? }) → { open, remove, hasPhoto, sheets, busy }
 *   open(): the phone's own picker (phones) or the menu (computers); call it straight from the tap.
 *   remove(): asks, then removes the photo — show it as "Poista kuva" when hasPhoto.
 *   Render `sheets` once anywhere on the page.
 *   onCropped(blob | null): instead of uploading, hand the cropped JPEG (or null for "Poista kuva")
 *   back — for a profile that does not exist yet (the player's first "Luo profiilisi").
 */
export function useProfilePhoto({ uid, person, onCropped = null }) {
  const data = useOptionalData(); // null on a gate screen: the session's profile is all there is to refresh
  const { refreshProfile } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [menu, setMenu] = useState(false);
  const [camera, setCamera] = useState(false);
  const [crop, setCrop] = useState({ open: false, src: null });
  const [busy, setBusy] = useState(false);
  const pickRef = useRef(null);
  const shootRef = useRef(null);
  const srcRef = useRef(null);
  srcRef.current = crop.src;

  useEffect(() => () => { if (srcRef.current) URL.revokeObjectURL(srcRef.current); }, []);

  const openSource = async (blob) => {
    try {
      const src = await prepareSource(blob);
      setCrop((c) => {
        if (c.src) URL.revokeObjectURL(c.src);
        return { open: true, src };
      });
    } catch {
      toast('Kuvaa ei voitu avata. Kokeile toista kuvaa (JPG tai PNG).');
    }
  };
  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type && !file.type.startsWith('image/')) { toast('Valitse kuvatiedosto.'); return; }
    openSource(file);
  };
  // A file input has to be clicked inside the tap itself, so the inputs live outside the sheets.
  const choose = () => { pickRef.current?.click(); setMenu(false); };
  const take = () => {
    if (isPhone() || !hasWebcam()) { shootRef.current?.click(); setMenu(false); return; }
    setMenu(false);
    setCamera(true);
  };
  const remove = async () => {
    setMenu(false);
    const ok = await confirm({ title: 'Poistetaanko profiilikuva?', message: 'Kuvan tilalla näkyvät nimikirjaimesi.', confirmLabel: 'Poista kuva', danger: true });
    if (!ok) return;
    if (onCropped) { onCropped(null); return; }
    try {
      await api.account.removeAvatar(uid);
      await data?.reload();
      refreshProfile?.();
      toast('Profiilikuva poistettu.');
    } catch (err) { toast(err); }
  };
  const save = async (blob) => {
    if (onCropped) { onCropped(blob); setCrop((c) => ({ ...c, open: false })); return; }
    setBusy(true);
    try {
      await api.account.uploadAvatar(uid, new File([blob], 'profiilikuva.jpg', { type: 'image/jpeg' }));
      await data?.reload();
      refreshProfile?.();
      setCrop((c) => ({ ...c, open: false }));
      toast('Profiilikuva vaihdettu.');
    } catch (err) { toast(err); } finally { setBusy(false); }
  };
  const closedCrop = () => setCrop((c) => {
    if (c.open) return c;
    if (c.src) URL.revokeObjectURL(c.src);
    return { open: false, src: null };
  });

  const sheets = (
    <>
      <input ref={pickRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
      <input ref={shootRef} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
      <PhotoMenuSheet open={menu} onClose={() => setMenu(false)} hasPhoto={Boolean(person?.avatarUrl)} onChoose={choose} onTake={take} onRemove={remove} />
      {hasWebcam() && (
        <CameraSheet open={camera} onClose={() => setCamera(false)}
          onShot={(blob) => { setCamera(false); openSource(blob); }}
          onPickFile={() => { pickRef.current?.click(); setCamera(false); }} />
      )}
      <PhotoCropSheet open={crop.open} src={crop.src} busy={busy}
        onClose={() => !busy && setCrop((c) => ({ ...c, open: false }))} onClosed={closedCrop}
        onSave={save} onPickOther={() => pickRef.current?.click()} />
    </>
  );
  // A file input opens only from inside the tap itself, so this must not wait for anything.
  const open = () => {
    if (busy) return;
    if (isPhone()) pickRef.current?.click();
    else setMenu(true);
  };
  return { open, remove, hasPhoto: Boolean(person?.avatarUrl), sheets, busy };
}
