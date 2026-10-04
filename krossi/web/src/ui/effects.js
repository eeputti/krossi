// effects.js — confetti burst and native share with clipboard fallback.

const COLORS = ['#CFE414', '#DDEE5A', '#0E3B2C', '#1E6B52', '#FFFFFF', '#D9734A'];

/**
 * confetti({ x, y, count, spread }) — one-shot burst on a temporary full-screen canvas.
 * x/y are viewport px (default: horizontal centre, 35 % from the top). Respects reduced motion.
 */
export function confetti({ x, y, count = 90, spread = 1 } = {}) {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.className = 'confetti-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const ox = x ?? w / 2;
  const oy = y ?? h * 0.35;
  const parts = Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1 * spread;
    const speed = 7 + Math.random() * 9;
    const ball = i % 9 === 0;
    return {
      x: ox, y: oy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: ball ? 7 + Math.random() * 3 : 5 + Math.random() * 6, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      color: ball ? '#CFE414' : COLORS[i % COLORS.length], ball, life: 1,
    };
  });
  const start = performance.now();
  const frame = (t) => {
    const elapsed = t - start;
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      p.life = Math.max(0, 1 - elapsed / 2200);
      if (p.y < h + 20 && p.life > 0) alive++;
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.ball) {
        ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      }
      ctx.restore();
    }
    if (alive > 0 && elapsed < 2400) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/**
 * share({ title, text, url }) — native share sheet where available, otherwise copies the URL.
 * Resolves to 'shared' | 'copied' | 'cancelled' | 'failed'.
 */
export async function share({ title, text, url }) {
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
  } catch (err) {
    if (err?.name === 'AbortError') return 'cancelled';
  }
  return (await copyText(url || text || '')) ? 'copied' : 'failed';
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = value; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
