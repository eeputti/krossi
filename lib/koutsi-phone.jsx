// koutsi-phone.jsx — the two phones in koutsi.krossi.app's hero (coach + player).
// The screens are real screenshots of the new Koutsi app's Koti (from the demo), so the
// phones look exactly like the app. Refresh them with: node scripts/koutsi-landing-shots.mjs

const KC_INK = '#121212';

// iPhone shell: white status bar (the app's page is white), the app screen, home bar
function PhoneFrame({ width, src, alt }) {
  const h = Math.round(width * 2.06);
  return (
    <div style={{ width, height: h, position: 'relative', borderRadius: width * 0.16, background: '#0a0a0a', padding: width * 0.028, boxShadow: '0 0 0 1.5px rgba(0,0,0,0.4)' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: width * 0.135, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', background: '#fff' }}>
        <div style={{ position: 'absolute', top: 9, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: width * 0.085, borderRadius: 99, background: '#000', zIndex: 90 }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${width * 0.05}px ${width * 0.08}px 2px`, color: KC_INK, background: '#fff', flexShrink: 0, zIndex: 85, position: 'relative' }}>
          <span style={{ fontSize: width * 0.048, fontWeight: 700 }}>9.30</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width={width * 0.058} height={width * 0.04} viewBox="0 0 16 11"><path d="M8 2.6c2 0 3.8.8 5.1 2.1l1-1C12.5 2 10.4 1 8 1S3.5 2 1.9 3.7l1 1C4.2 3.4 6 2.6 8 2.6z" fill={KC_INK} /><path d="M8 5.6c1.2 0 2.3.5 3.1 1.3l1-1C11 4.8 9.6 4.2 8 4.2s-3 .6-4.1 1.7l1 1C5.7 6.1 6.8 5.6 8 5.6z" fill={KC_INK} /><circle cx="8" cy="9" r="1.4" fill={KC_INK} /></svg>
            <svg width={width * 0.086} height={width * 0.04} viewBox="0 0 24 11"><rect x="0.5" y="0.5" width="20" height="10" rx="3" stroke={KC_INK} strokeOpacity="0.4" fill="none" /><rect x="2" y="2" width="16" height="7" rx="1.5" fill={KC_INK} /><path d="M22 3.5v4c.7-.3 1.2-1 1.2-2s-.5-1.7-1.2-2z" fill={KC_INK} fillOpacity="0.4" /></svg>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <img src={src} alt={alt} width="600" height="1197" loading="eager" decoding="async"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center bottom', display: 'block' }} />
        </div>
        <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', width: width * 0.3, height: 4, borderRadius: 99, background: KC_INK, zIndex: 95 }} />
      </div>
    </div>
  );
}

function CoachPhone({ width = 220 }) {
  return <PhoneFrame width={width} src="assets/koutsi-app-valmentaja.webp" alt="Krossi Koutsi valmentajalle: Koti-näkymä, viikon treenit ja tämän päivän ryhmät" />;
}

function PlayerPhone({ width = 220 }) {
  return <PhoneFrame width={width} src="assets/koutsi-app-pelaaja.webp" alt="Krossi Koutsi pelaajalle: Koti-näkymä, viikon teema, valmentajan tiedote ja Miten meni?" />;
}

Object.assign(window, { CoachPhone, PlayerPhone });
