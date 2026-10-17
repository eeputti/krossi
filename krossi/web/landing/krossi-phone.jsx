// krossi-phone.jsx — the hero phone: the real Krossi demo (krossi.app/demo) running inside a phone
// frame, so the landing page always shows the app exactly as it is. The demo is laid out at a phone
// width (APP_W) and scaled down to fit the frame. Exports KrossiAppPhone.

const APP_W = 360;

function KrossiAppPhone({ src = '/demo/pelaajat' }) {
  const viewRef = React.useRef(null);
  const frameRef = React.useRef(null);
  const [box, setBox] = React.useState(null); // the screen area under the status bar, in px

  React.useEffect(() => {
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(viewRef.current);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const frame = frameRef.current;
    // Links that leave the demo (Luo oma tili → /pelaa) open in the whole window, not in the phone.
    const onLoad = () => {
      try {
        const loc = frame.contentWindow.location;
        if (loc.protocol.startsWith('http') && !loc.pathname.startsWith('/demo')) window.location.assign(loc.href);
      } catch (e) { /* a page from another site: leave it */ }
    };
    frame.addEventListener('load', onLoad);
    // The blank frame is navigated instead of given a src, so the prerendered landing HTML
    // (scripts/prerender.mjs) holds an empty frame and the demo loads only once.
    frame.contentWindow.location.replace(src);
    return () => frame.removeEventListener('load', onLoad);
  }, [src]);

  const scale = box ? box.w / APP_W : 1;
  return (
    <div className="app-phone">
      <div className="app-phone-screen">
        <span className="app-phone-island" />
        <div className="app-phone-status">
          <span>12.44</span>
          <span className="app-phone-icons" aria-hidden="true">
            <svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 2.6c2 0 3.8.8 5.1 2.1l1-1C12.5 2 10.4 1 8 1S3.5 2 1.9 3.7l1 1C4.2 3.4 6 2.6 8 2.6z" fill="#fff" /><path d="M8 5.6c1.2 0 2.3.5 3.1 1.3l1-1C11 4.8 9.6 4.2 8 4.2s-3 .6-4.1 1.7l1 1C5.7 6.1 6.8 5.6 8 5.6z" fill="#fff" /><circle cx="8" cy="9" r="1.4" fill="#fff" /></svg>
            <svg width="24" height="11" viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke="#fff" strokeOpacity="0.6" fill="none" /><rect x="2" y="2" width="16" height="7" rx="1.5" fill="#fff" /><path d="M22 3.5v4c.7-.3 1.2-1 1.2-2s-.5-1.7-1.2-2z" fill="#fff" fillOpacity="0.6" /></svg>
          </span>
        </div>
        <div className="app-phone-view" ref={viewRef}>
          <iframe
            ref={frameRef}
            className="app-phone-frame"
            title="Krossin demo"
            style={{ width: APP_W, height: box ? box.h / scale : '100%', transform: `scale(${scale})`, visibility: box ? 'visible' : 'hidden' }}
          />
        </div>
        <div className="app-phone-home"><span /></div>
      </div>
    </div>
  );
}

Object.assign(window, { KrossiAppPhone });
