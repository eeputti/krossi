// koutsi-qr.js — minimal QR encoder, used to put a scannable invite on the coach's screen.
//
// Deliberately dependency-free: the app already loads three scripts from CDNs, and a QR
// image service would mean sending every invite link (which grants access to a coaching
// group) to a third party. This covers exactly what the invite flow needs — byte mode,
// error-correction level M, versions 1–10 — which is far more than a ~50 character
// koutsi.krossi.app link requires.
//
// window.koutsiQrMatrix(text) -> boolean[size][size], true = dark module.

(function () {
  // ── GF(256) arithmetic for Reed–Solomon, generator 0x11d ──
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initTables() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= gfMul(poly[j], EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
    return poly;
  }
  function rsRemainder(data, degree) {
    const gen = rsGenerator(degree);
    const rem = new Array(degree).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem[0];
      rem.shift();
      rem.push(0);
      for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
    return rem;
  }

  // ── per-version tables, error-correction level M only ──
  // [total codewords, ec codewords per block, [ [blockCount, dataCodewords], ... ] ]
  const VERSIONS = {
    1: [26, 10, [[1, 16]]],
    2: [44, 16, [[1, 28]]],
    3: [70, 26, [[1, 44]]],
    4: [100, 18, [[2, 32]]],
    5: [134, 24, [[2, 43]]],
    6: [172, 16, [[4, 27]]],
    7: [196, 18, [[4, 31]]],
    8: [242, 22, [[2, 38], [2, 39]]],
    9: [292, 22, [[3, 36], [2, 37]]],
    10: [346, 26, [[4, 43], [1, 44]]],
  };
  const ALIGNMENT = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const dataCapacity = (version) => VERSIONS[version][2].reduce((sum, [n, cw]) => sum + n * cw, 0);

  // ── bit stream ──
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  function encodeData(bytes, version) {
    const capacityBits = dataCapacity(version) * 8;
    const buf = new BitBuffer();
    buf.put(0b0100, 4);                       // byte mode
    buf.put(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) buf.put(b, 8);
    if (buf.bits.length > capacityBits) return null;

    buf.put(0, Math.min(4, capacityBits - buf.bits.length));   // terminator
    while (buf.bits.length % 8 !== 0) buf.bits.push(0);

    const codewords = [];
    for (let i = 0; i < buf.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
      codewords.push(byte);
    }
    const pad = [0xec, 0x11];
    for (let i = 0; codewords.length < dataCapacity(version); i++) codewords.push(pad[i % 2]);
    return codewords;
  }

  // Splits data into blocks, appends each block's EC codewords, then interleaves both
  // groups the way the spec requires.
  function buildCodewords(dataCodewords, version) {
    const [, ecPerBlock, groups] = VERSIONS[version];
    const blocks = [];
    let offset = 0;
    for (const [count, dataLen] of groups) {
      for (let i = 0; i < count; i++) {
        const data = dataCodewords.slice(offset, offset + dataLen);
        offset += dataLen;
        blocks.push({ data, ec: rsRemainder(data, ecPerBlock) });
      }
    }
    const result = [];
    const maxData = Math.max(...blocks.map((b) => b.data.length));
    for (let i = 0; i < maxData; i++) {
      for (const b of blocks) if (i < b.data.length) result.push(b.data[i]);
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (const b of blocks) result.push(b.ec[i]);
    }
    return result;
  }

  // ── matrix ──
  function makeMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(null));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    const setF = (r, c, v) => { modules[r][c] = v; reserved[r][c] = true; };

    const placeFinder = (row, col) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const rr = row + r, cc = col + c;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
          const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          setF(rr, cc, inRing || inCore);
        }
      }
    };
    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {           // timing patterns
      setF(6, i, i % 2 === 0);
      setF(i, 6, i % 2 === 0);
    }

    const centers = ALIGNMENT[version];
    for (const r of centers) {
      for (const c of centers) {
        // skip the three corners already occupied by finder patterns
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const ring = Math.max(Math.abs(dr), Math.abs(dc));
            setF(r + dr, c + dc, ring !== 1);
          }
        }
      }
    }

    setF(size - 8, 8, true);                        // dark module

    for (let i = 0; i < 9; i++) {                   // format information areas
      if (modules[8][i] === null) setF(8, i, false);
      if (modules[i][8] === null) setF(i, 8, false);
    }
    for (let i = 0; i < 8; i++) {
      if (modules[8][size - 1 - i] === null) setF(8, size - 1 - i, false);
      if (modules[size - 1 - i][8] === null) setF(size - 1 - i, 8, false);
    }
    if (version >= 7) {                             // version information areas
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 3; j++) {
          setF(i, size - 11 + j, false);
          setF(size - 11 + j, i, false);
        }
      }
    }
    return { modules, reserved, size };
  }

  function placeData(matrix, codewords) {
    const { modules, reserved, size } = matrix;
    let bitIndex = 0;
    const nextBit = () => {
      const byte = codewords[bitIndex >> 3];
      const bit = byte === undefined ? 0 : (byte >>> (7 - (bitIndex & 7))) & 1;
      bitIndex++;
      return bit === 1;
    };
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                   // the vertical timing column is skipped
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (const col of [right, right - 1]) {
          if (!reserved[row][col]) modules[row][col] = nextBit();
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  function applyMask(matrix, maskIndex) {
    const { modules, reserved, size } = matrix;
    const mask = MASKS[maskIndex];
    const out = modules.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && mask(r, c)) out[r][c] = !out[r][c];
      }
    }
    return out;
  }

  // 15-bit BCH format string; 0b00 is EC level M.
  function formatBits(maskIndex) {
    const data = (0b00 << 3) | maskIndex;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0b10100110111);
    return ((data << 10) | rem) ^ 0b101010000010010;
  }
  function versionBits(version) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0b1111100100101);
    return (version << 12) | rem;
  }

  function drawFormatAndVersion(grid, size, version, maskIndex) {
    const fmt = formatBits(maskIndex);
    const bit = (n) => ((fmt >>> n) & 1) === 1;
    for (let i = 0; i <= 5; i++) grid[8][i] = bit(i);
    grid[8][7] = bit(6);
    grid[8][8] = bit(7);
    grid[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) grid[14 - i][8] = bit(i);
    for (let i = 0; i <= 7; i++) grid[size - 1 - i][8] = bit(i);
    for (let i = 8; i <= 14; i++) grid[8][size - 15 + i] = bit(i);
    grid[size - 8][8] = true;

    if (version >= 7) {
      const vb = versionBits(version);
      for (let i = 0; i < 18; i++) {
        const on = ((vb >>> i) & 1) === 1;
        const r = Math.floor(i / 3);
        const c = size - 11 + (i % 3);
        grid[r][c] = on;
        grid[c][r] = on;
      }
    }
  }

  // Standard penalty scoring — picking the lowest-penalty mask is what keeps the code
  // readable to a phone camera in gym lighting.
  function penalty(grid, size) {
    let score = 0;
    const runScore = (line) => {
      let total = 0, run = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === line[i - 1]) { run++; } else { if (run >= 5) total += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) total += 3 + (run - 5);
      return total;
    };
    for (let r = 0; r < size; r++) score += runScore(grid[r]);
    for (let c = 0; c < size; c++) score += runScore(grid.map((row) => row[c]));

    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
      }
    }

    const pattern = [true, false, true, true, true, false, true, false, false, false, false];
    const matchesAt = (line, i) => pattern.every((p, k) => line[i + k] === p);
    const reversed = pattern.slice().reverse();
    const matchesRevAt = (line, i) => reversed.every((p, k) => line[i + k] === p);
    const scanLine = (line) => {
      let total = 0;
      for (let i = 0; i + 11 <= line.length; i++) {
        if (matchesAt(line, i) || matchesRevAt(line, i)) total += 40;
      }
      return total;
    };
    for (let r = 0; r < size; r++) score += scanLine(grid[r]);
    for (let c = 0; c < size; c++) score += scanLine(grid.map((row) => row[c]));

    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (grid[r][c]) dark++;
    const percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    return score;
  }

  function koutsiQrMatrix(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let version = 0;
    let dataCodewords = null;
    for (let v = 1; v <= 10; v++) {
      const encoded = encodeData(bytes, v);
      if (encoded) { version = v; dataCodewords = encoded; break; }
    }
    if (!version) throw new Error('QR: teksti on liian pitkä');

    const codewords = buildCodewords(dataCodewords, version);
    const matrix = makeMatrix(version);
    placeData(matrix, codewords);

    let best = null;
    for (let m = 0; m < 8; m++) {
      const grid = applyMask(matrix, m);
      drawFormatAndVersion(grid, matrix.size, version, m);
      const score = penalty(grid, matrix.size);
      if (!best || score < best.score) best = { grid, score };
    }
    return best.grid;
  }

  window.koutsiQrMatrix = koutsiQrMatrix;
})();
