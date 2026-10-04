// MapView.jsx — the games map (Kartta view) and the pin picker used in CreateGameSheet.
// MapLibre is loaded lazily from the CDN (maplibre.js); both components degrade to a friendly
// fallback with a retry when the script, WebGL or the tiles are unavailable.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Icon, IconButton, Illustration, Spinner } from '../../ui/index.js';
import { dayDiff, formatTime, WEEKDAYS_SHORT } from '../../lib/format.js';
import { GameCard } from '../shared/GameCard.jsx';
import { venueName } from './gameUtils.js';
import { loadMapLibre, MAP_STYLE } from './maplibre.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const STYLE_TIMEOUT_MS = 14_000;

/**
 * useMapLibre(boxRef, center [lat,lng], { zoom, attempt }) — creates one map in boxRef.
 * Returns { status: 'loading'|'ready'|'error', map, ml, painted }. `painted` flips when the
 * style has loaded; if it never does within STYLE_TIMEOUT_MS the status becomes 'error'.
 */
function useMapLibre(box, center, { zoom = 12, attempt = 0 } = {}) {
  const [state, setState] = useState({ status: 'loading', map: null, ml: null, painted: false });
  const start = useRef(center);
  useEffect(() => {
    let alive = true;
    let map = null;
    let timer = null;
    setState({ status: 'loading', map: null, ml: null, painted: false });
    loadMapLibre()
      .then((ml) => {
        if (!alive || !box.current) return;
        try {
          map = new ml.Map({
            container: box.current,
            style: MAP_STYLE,
            center: [start.current[1], start.current[0]],
            zoom,
            attributionControl: { compact: true },
            dragRotate: false,
            pitchWithRotate: false,
          });
        } catch (err) {
          // No WebGL (old device, locked-down browser): show the fallback instead of a blank box.
          setState({ status: 'error', map: null, ml: null, painted: false, error: err });
          return;
        }
        map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
        // Individual tile/glyph errors are retried by MapLibre; the timeout below catches a map
        // that never manages to paint. Listening here keeps those retries out of the console.
        map.on('error', () => undefined);
        timer = setTimeout(() => alive && setState((s) => (s.painted ? s : { ...s, status: 'error' })), STYLE_TIMEOUT_MS);
        map.once('load', () => {
          clearTimeout(timer);
          // Start with the attribution folded into its (i) button — it covers a third of a phone map otherwise.
          box.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
          if (alive) setState((s) => ({ ...s, painted: true }));
        });
        setState({ status: 'ready', map, ml, painted: false });
      })
      .catch((err) => alive && setState({ status: 'error', map: null, ml: null, painted: false, error: err }));
    return () => { alive = false; clearTimeout(timer); map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return state;
}

function groupByPlace(games) {
  const places = new Map();
  for (const g of games) {
    if (g.lat == null || g.lng == null) continue;
    const key = `${Number(g.lat).toFixed(4)},${Number(g.lng).toFixed(4)}`;
    if (!places.has(key)) places.set(key, { key, lat: Number(g.lat), lng: Number(g.lng), name: venueName(g) || g.city || 'Peli', games: [] });
    places.get(key).games.push(g);
  }
  return [...places.values()];
}

function pinLabel(place) {
  if (place.games.length > 1) return `${place.games.length} peliä`;
  const g = place.games[0];
  if (!g.scheduledAt) return 'Aika auki';
  return dayDiff(g.scheduledAt) === 0
    ? `Tänään ${formatTime(g.scheduledAt)}`
    : `${WEEKDAYS_SHORT[new Date(g.scheduledAt).getDay()]} ${formatTime(g.scheduledAt)}`;
}

function MapFallback({ onRetry, onShowList, compact }) {
  return (
    <div className={cx('games-map-fallback', compact && 'is-compact')} role="alert">
      {!compact && <Illustration name="map" size={140} />}
      <h3 className="games-map-fallback-title">Karttaa ei saatu ladattua</h3>
      <p className="games-map-fallback-text">{compact ? 'Voit julkaista pelin ilman karttapistettä.' : 'Yhteys pätkii tai selain ei tue karttaa. Pelit löytyvät myös listasta.'}</p>
      <div className="games-map-fallback-actions">
        <Button variant="outline" size="sm" icon="refresh" onClick={onRetry}>Yritä uudelleen</Button>
        {onShowList && <Button variant="ghost" size="sm" icon="list" onClick={onShowList}>Näytä listana</Button>}
      </div>
    </div>
  );
}

/**
 * GamesMap — pins for every game that has coordinates (one pin per venue), a preview card at
 * the bottom when a pin is tapped.
 *   games, center [lat,lng] (city centre / my position), userPos [lat,lng]|null,
 *   onOpen(game), onShowList()
 */
export function GamesMap({ games, center, userPos, onOpen, onShowList }) {
  const box = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const { status, map, ml, painted } = useMapLibre(box, center, { attempt });
  const places = useMemo(() => groupByPlace(games), [games]);
  const pinned = places.reduce((n, p) => n + p.games.length, 0);
  const unpinned = games.length - pinned;
  const [selectedKey, setSelectedKey] = useState(null);
  const markers = useRef(new Map());
  const selected = places.find((p) => p.key === selectedKey) || null;

  // Pins (rebuilt when the filtered games change) + framing.
  useEffect(() => {
    if (!map || !ml) return undefined;
    const made = new Map();
    for (const place of places) {
      const el = document.createElement('button');
      el.type = 'button';
      const today = place.games.some((g) => g.scheduledAt && dayDiff(g.scheduledAt) === 0);
      el.className = cx('games-pin', today && 'is-today', place.games.length > 1 && 'is-multi');
      el.setAttribute('aria-label', `${place.name}: ${place.games.length === 1 ? '1 peli' : `${place.games.length} peliä`}`);
      const label = document.createElement('span');
      label.className = 'games-pin-label';
      label.textContent = pinLabel(place);
      el.appendChild(label);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setSelectedKey(place.key);
        map.easeTo({ center: [place.lng, place.lat], duration: 420, offset: [0, -60] });
      });
      made.set(place.key, new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([place.lng, place.lat]).addTo(map));
    }
    markers.current = made;
    if (places.length > 1 || (places.length === 1 && userPos)) {
      const bounds = new ml.LngLatBounds();
      places.forEach((p) => bounds.extend([p.lng, p.lat]));
      if (userPos) bounds.extend([userPos[1], userPos[0]]);
      map.fitBounds(bounds, { padding: { top: 80, bottom: 90, left: 48, right: 64 }, maxZoom: 14, duration: 0 });
    } else if (places.length === 1) {
      map.jumpTo({ center: [places[0].lng, places[0].lat], zoom: 13 });
    } else {
      map.jumpTo({ center: [center[1], center[0]], zoom: 12 });
    }
    return () => { made.forEach((m) => m.remove()); markers.current = new Map(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ml, places]);

  useEffect(() => {
    markers.current.forEach((m, key) => m.getElement().classList.toggle('is-selected', key === selectedKey));
  }, [selectedKey, places]);

  useEffect(() => {
    if (!map) return undefined;
    const clear = () => setSelectedKey(null);
    map.on('click', clear);
    return () => map.off('click', clear);
  }, [map]);

  // "You are here" dot.
  useEffect(() => {
    if (!map || !ml || !userPos) return undefined;
    const el = document.createElement('span');
    el.className = 'games-me-dot';
    el.setAttribute('aria-label', 'Sinä olet tässä');
    const m = new ml.Marker({ element: el }).setLngLat([userPos[1], userPos[0]]).addTo(map);
    return () => m.remove();
  }, [map, ml, userPos]);

  return (
    <div className="games-map-wrap">
      <div className="games-map">
        <div ref={box} className="games-map-canvas" />
        {status !== 'error' && !painted && (
          <div className="games-map-loading" aria-live="polite"><Spinner size={22} /><span>Ladataan karttaa…</span></div>
        )}
        {status === 'error' && <MapFallback onRetry={() => setAttempt((a) => a + 1)} onShowList={onShowList} />}
        {status === 'ready' && painted && places.length === 0 && (
          <div className="games-map-note"><Icon name="map" size={16} />Ei pelejä kartalla juuri nyt</div>
        )}
        {status === 'ready' && selected && (
          <div className="games-map-preview" key={selected.key}>
            <div className="games-map-preview-head">
              <span className="games-map-preview-name truncate"><Icon name="pin" size={15} />{selected.name}</span>
              <IconButton icon="close" label="Sulje esikatselu" size="sm" variant="soft" onClick={() => setSelectedKey(null)} />
            </div>
            {selected.games.length === 1 ? (
              <GameCard game={selected.games[0]} onClick={() => onOpen(selected.games[0])} showDistance />
            ) : (
              <div className="games-map-preview-scroll">
                {selected.games.map((g) => <GameCard key={g.id} game={g} variant="compact" onClick={() => onOpen(g)} />)}
              </div>
            )}
          </div>
        )}
      </div>
      {unpinned > 0 && status !== 'error' && (
        <button type="button" className="games-map-unpinned" onClick={onShowList}>
          <Icon name="info" size={15} />
          <span>{unpinned === 1 ? '1 peli' : `${unpinned} peliä`} ilman karttasijaintia</span>
          <span className="games-map-unpinned-cta">Näytä listana</span>
        </button>
      )}
    </div>
  );
}

/**
 * PinPicker — tap the map to drop a pin, drag to adjust. lat/lng may be null.
 *   center [lat,lng] used when there is no pin yet, onPick(lat, lng)
 */
export function PinPicker({ lat, lng, center, onPick }) {
  const box = useRef(null);
  const [attempt, setAttempt] = useState(0);
  const hasPin = lat != null && lng != null;
  const { status, map, ml, painted } = useMapLibre(box, hasPin ? [lat, lng] : center, { zoom: 13, attempt });
  const marker = useRef(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  const place = (lngLat) => {
    if (!map || !ml) return;
    if (marker.current) { marker.current.setLngLat(lngLat); return; }
    const el = document.createElement('span');
    el.className = 'games-pin-drop';
    marker.current = new ml.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat(lngLat).addTo(map);
    marker.current.on('dragend', () => { const p = marker.current.getLngLat(); pick.current(p.lat, p.lng); });
  };

  useEffect(() => {
    if (!map) return undefined;
    const onClick = (e) => { place(e.lngLat); pick.current(e.lngLat.lat, e.lngLat.lng); };
    map.on('click', onClick);
    return () => { map.off('click', onClick); marker.current?.remove(); marker.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, ml]);

  // Follow pins set from outside (e.g. picking a venue chip).
  useEffect(() => {
    if (!map || !hasPin) return;
    place([lng, lat]);
    map.easeTo({ center: [lng, lat], duration: 300 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lat, lng]);

  return (
    <div className="games-picker">
      <div ref={box} className="games-picker-canvas" />
      {status !== 'error' && !painted && <div className="games-map-loading"><Spinner size={20} /><span>Ladataan karttaa…</span></div>}
      {status === 'error' && <MapFallback compact onRetry={() => setAttempt((a) => a + 1)} />}
      {status === 'ready' && painted && (
        <span className="games-picker-hint">
          <Icon name={hasPin ? 'check' : 'pin'} size={14} />
          {hasPin ? 'Raahaa nastaa tai napauta uutta kohtaa' : 'Napauta karttaa lisätäksesi nastan'}
        </span>
      )}
    </div>
  );
}
