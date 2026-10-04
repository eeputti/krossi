// shareCard.js — draws the recap as a 1080×1920 story image and shares or downloads it.
//
//   const blob = await renderRecapCard(recap, { name });
//   const result = await shareRecapImage(recap, { name });   'shared' | 'downloaded' | 'cancelled'
//
// Colours come from the design tokens on :root so the image matches the app.
import { firstName } from '../../lib/format.js';
import { percent, periodWords, unit } from './copy.js';

const W = 1080;
const H = 1920;
const PAD = 96;

function tokens() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    green900: v('--green-900', '#0A2C20'),
    green800: v('--green-800', '#0E3B2C'),
    green700: v('--green-700', '#155440'),
    lime: v('--lime', '#CFE414'),
    clay: v('--clay', '#D9734A'),
    ink: v('--ink', '#121212'),
    font: v('--font', 'system-ui, sans-serif'),
    fontNum: v('--font-num', 'system-ui, sans-serif'),
  };
}

const font = (weight, size, family) => `${weight} ${size}px ${family}`;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Shortens `text` with an ellipsis until it fits `max` px.
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

// Word-wraps into at most `lines` lines; the last line gets an ellipsis if needed.
function wrap(ctx, text, max, lines) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= max || !line) { line = next; continue; }
    out.push(line);
    line = words[i];
    if (out.length === lines - 1) { line = words.slice(i).join(' '); break; }
  }
  out.push(fit(ctx, line, max));
  return out;
}

function courtLines(ctx, color) {
  ctx.save();
  ctx.translate(W - 120, 380);
  ctx.rotate((-14 * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.11;
  ctx.lineWidth = 7;
  const w = 760;
  const h = 1010;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.beginPath();
  const side = w * 0.12;
  ctx.moveTo(-w / 2 + side, -h / 2); ctx.lineTo(-w / 2 + side, h / 2);
  ctx.moveTo(w / 2 - side, -h / 2); ctx.lineTo(w / 2 - side, h / 2);
  ctx.moveTo(-w / 2 + side, -h * 0.24); ctx.lineTo(w / 2 - side, -h * 0.24);
  ctx.moveTo(-w / 2 + side, h * 0.24); ctx.lineTo(w / 2 - side, h * 0.24);
  ctx.moveTo(0, -h * 0.24); ctx.lineTo(0, h * 0.24);
  ctx.stroke();
  ctx.setLineDash([10, 22]);
  ctx.beginPath(); ctx.moveTo(-w / 2 - 40, 0); ctx.lineTo(w / 2 + 40, 0); ctx.stroke();
  ctx.restore();
}

function ball(ctx, x, y, r, c) {
  ctx.save();
  ctx.fillStyle = c.lime;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath(); ctx.arc(x - r * 1.05, y, r * 0.85, -Math.PI / 2.4, Math.PI / 2.4); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + r * 1.05, y, r * 0.85, Math.PI - Math.PI / 2.4, Math.PI + Math.PI / 2.4); ctx.stroke();
  ctx.restore();
}

/** Draws the share image and resolves to a PNG Blob. */
export async function renderRecapCard(recap, { name } = {}) {
  const c = tokens();
  const words = periodWords(recap.period);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');

  // background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, c.green800);
  bg.addColorStop(1, c.green900);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(140, 260, 20, 140, 260, 760);
  glow.addColorStop(0, 'rgba(207, 228, 20, 0.22)');
  glow.addColorStop(1, 'rgba(207, 228, 20, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  courtLines(ctx, '#FFFFFF');

  ctx.textBaseline = 'alphabetic';
  // logo + who
  ctx.fillStyle = c.lime;
  ctx.font = font(800, 68, c.font);
  ctx.fillText('Krossi', PAD, 190);
  if (name) {
    ctx.font = font(650, 36, c.font);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, firstName(name), 420), W - PAD, 186);
    ctx.textAlign = 'left';
  }

  // title block
  ctx.fillStyle = c.lime;
  ctx.font = font(800, 34, c.font);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '6px';
  ctx.fillText(`${words.genitive} kooste`.toUpperCase(), PAD, 360);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.fillStyle = '#FFFFFF';
  let titleSize = 132;
  ctx.font = font(800, titleSize, c.font);
  while (titleSize > 80 && ctx.measureText(words.name).width > W - 2 * PAD) {
    titleSize -= 4;
    ctx.font = font(800, titleSize, c.font);
  }
  ctx.fillText(fit(ctx, words.name, W - 2 * PAD), PAD, 500);
  ctx.fillStyle = c.lime;
  ctx.font = font(750, 54, c.font);
  const headline = wrap(ctx, recap.headline, W - 2 * PAD, 2);
  headline.forEach((line, i) => ctx.fillText(line, PAD, 600 + i * 68));

  // stat tiles
  const tiles = [
    { value: recap.gamesPlayed, label: unit.games(recap.gamesPlayed) },
    { value: recap.wins, label: recap.wins + recap.losses > 0 ? `${unit.wins(recap.wins)} · ${percent(recap.winRate)}` : unit.wins(recap.wins) },
    { value: recap.longestWeekStreakInPeriod, label: `${unit.weeks(recap.longestWeekStreakInPeriod)} putkeen` },
    { value: recap.newBadges.length, label: unit.badges(recap.newBadges.length) },
  ];
  const gap = 28;
  const tw = (W - 2 * PAD - gap) / 2;
  const th = 270;
  const top = 740;
  tiles.forEach((tile, i) => {
    const x = PAD + (i % 2) * (tw + gap);
    const y = top + Math.floor(i / 2) * (th + gap);
    roundRect(ctx, x, y, tw, th, 44);
    ctx.fillStyle = i === 0 ? c.lime : 'rgba(255,255,255,0.08)';
    ctx.fill();
    ctx.fillStyle = i === 0 ? c.ink : c.lime;
    ctx.font = font(800, 168, c.fontNum);
    ctx.fillText(String(tile.value), x + 44, y + 172);
    ctx.fillStyle = i === 0 ? c.ink : 'rgba(255,255,255,0.78)';
    ctx.font = font(700, 38, c.font);
    ctx.fillText(fit(ctx, tile.label, tw - 88), x + 46, y + 230);
  });

  // highlights
  const rows = [];
  if (recap.topPartner) rows.push({ label: 'Eniten pelattu kaveri', value: `${recap.topPartner.person.name} · ${recap.topPartner.count} ${unit.games(recap.topPartner.count)}` });
  if (recap.topVenue) rows.push({ label: 'Suosikkikenttä', value: recap.topVenue.name });
  else if (recap.busiestWeekday) rows.push({ label: 'Vilkkain päivä', value: recap.busiestWeekday });
  let y = top + 2 * th + gap + 110;
  for (const row of rows.slice(0, 2)) {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = font(700, 34, c.font);
    ctx.fillText(row.label, PAD, y);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(750, 52, c.font);
    ctx.fillText(fit(ctx, row.value, W - 2 * PAD), PAD, y + 66);
    y += 150;
  }

  // footer
  ball(ctx, PAD + 30, H - 128, 30, c);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = font(800, 42, c.font);
  ctx.fillText('krossi.app', PAD + 80, H - 113);
  ctx.textAlign = 'right';
  ctx.fillStyle = c.lime;
  ctx.fillText('Pelataanko?', W - PAD, H - 113);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/** Shares the image with the native share sheet when files are supported, otherwise downloads it. */
export async function shareRecapImage(recap, { name } = {}) {
  const blob = await renderRecapCard(recap, { name });
  const filename = `krossi-kooste-${recap.key}.png`;
  const words = periodWords(recap.period);
  const file = typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `${words.name} — Krossi-kooste`,
        text: `${words.name} Krossissa: ${recap.gamesPlayed} ${unit.games(recap.gamesPlayed)}, ${recap.wins} ${unit.wins(recap.wins)} 🎾 krossi.app`,
      });
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
      // Some browsers claim support but refuse files — fall through to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
