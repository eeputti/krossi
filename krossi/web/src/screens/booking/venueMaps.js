// venueMaps.js — plain floor maps ("pohjakartat") for court booking, drawn by VenueMap.jsx.
//
// Pure data (no JSX) so node tests can import it. Every map has its own unit space (the
// viewBox). The numbers keep the arrangement and proportions of the halls' own drawings, not
// their pixels: gaps are tightened a little so the courts stay legible on a 300 px wide phone.
// Only what helps find a court is drawn: hall outlines, the courts, the entrances and a few
// named rooms; outdoors also the street, paths and a few trees.
//
//   title      location name for the map's accessible label
//   viewBox    [x, y, w, h] — the canvas keeps this aspect ratio
//   place      { label, tag?, box: [x, y, w, h] } — the place name printed on the map
//   features   drawn in layers by type (ground → buildings → rooms):
//                road      { x, y, w, h, label?, vertical? }   flat street band
//                path      { points: [[x, y], …], width }      gravel path
//                trees     { points: [[x, y, r], …] }
//                building  { x, y, w, h, r? }                  thin outline; touching buildings share one
//                room      { x, y, w, h }                      inside a building
//                note      {}                                  text only
//              Any feature may carry label (string, '\n' = line break), labelAlts (shorter
//              fallbacks, tried in order when the label doesn't fit — nothing is shown when none
//              fits), box ([x, y, w, h] where the label sits; defaults to the shape) and
//              level (1 = also shown on compact maps).
//   courts     { [mapId]: { x, y, w, h, kind: 'tennis'|'padel'|'sulka'|'squash',
//                           orientation: 'v'|'h' (long axis), surface?: 'hard'|'clay',
//                           label, short } } — label/short are used when no court has this mapId
//   entrances  [{ x, y, dir: 'up'|'down'|'left'|'right', label, labelAlts?, box, align? }]
//              (x, y) is the door on the building edge; the arrow points in `dir`, into the building.

export const VENUE_MAPS = {
  // Janus-Areena, Heinlammintie 64. Main hall with tennis 3 · sulka 5 over padel · sulka 4–1 ·
  // tennis 2 · tennis 1; an annex up and to the right (sulka 7 and 6 — also pickleball — and a
  // crosswise tennis 4) joined by a corridor. Main entrance between the changing rooms at the
  // bottom; the annex has its own door on its right wall.
  'lahti-janus': {
    title: 'Janus-Areena',
    viewBox: [0, 0, 740, 650],
    place: { label: 'Janus-Areena', box: [20, 14, 268, 90] },
    features: [
      { type: 'building', x: 300, y: 14, w: 390, h: 172 },
      { type: 'building', x: 435, y: 180, w: 24, h: 62, r: 1 },
      { type: 'building', x: 20, y: 236, w: 688, h: 294 },
      { type: 'building', x: 366, y: 524, w: 256, h: 50, r: 2 },
      { type: 'room', x: 366, y: 530, w: 110, h: 44, label: 'Pukuh. N', labelAlts: ['Naiset'] },
      { type: 'room', x: 512, y: 530, w: 110, h: 44, label: 'Pukuh. M', labelAlts: ['Miehet'] },
      { type: 'note', box: [306, 150, 136, 34], label: 'Myös pickleball', labelAlts: ['Pickleball'] },
    ],
    courts: {
      te3: { x: 42, y: 275, w: 100, h: 216, kind: 'tennis', surface: 'hard', orientation: 'v', label: 'Tennis 3', short: 'Te3' },
      sulka5: { x: 166, y: 260, w: 124, h: 54, kind: 'sulka', orientation: 'h', label: 'Sulka 5', short: 'Su5' },
      padel: { x: 183, y: 324, w: 90, h: 182, kind: 'padel', orientation: 'v', label: 'Padel', short: 'Padel' },
      sulka4: { x: 310, y: 260, w: 124, h: 54, kind: 'sulka', orientation: 'h', label: 'Sulka 4', short: 'Su4' },
      sulka3: { x: 310, y: 324, w: 124, h: 54, kind: 'sulka', orientation: 'h', label: 'Sulka 3', short: 'Su3' },
      sulka2: { x: 310, y: 388, w: 124, h: 54, kind: 'sulka', orientation: 'h', label: 'Sulka 2', short: 'Su2' },
      sulka1: { x: 310, y: 452, w: 124, h: 54, kind: 'sulka', orientation: 'h', label: 'Sulka 1', short: 'Su1' },
      te2: { x: 460, y: 275, w: 100, h: 216, kind: 'tennis', surface: 'hard', orientation: 'v', label: 'Tennis 2', short: 'Te2' },
      te1: { x: 586, y: 275, w: 100, h: 216, kind: 'tennis', surface: 'hard', orientation: 'v', label: 'Tennis 1', short: 'Te1' },
      // annex
      sulka7: { x: 314, y: 28, w: 54, h: 120, kind: 'sulka', orientation: 'v', label: 'Sulka 7', short: 'Su7' },
      sulka6: { x: 380, y: 28, w: 54, h: 120, kind: 'sulka', orientation: 'v', label: 'Sulka 6', short: 'Su6' },
      te4: { x: 456, y: 50, w: 216, h: 100, kind: 'tennis', surface: 'hard', orientation: 'h', label: 'Tennis 4', short: 'Te4' },
    },
    entrances: [
      { x: 494, y: 574, dir: 'up', label: 'Sisäänkäynti', box: [384, 608, 220, 38] },
      { x: 690, y: 162, dir: 'left', label: 'Sisäänkäynti', box: [520, 190, 208, 42], align: 'end' },
    ],
  },

  // Kispi-Areena, Kisapuisto. The halls' own drawing is portrait with the Tarinakatu entrance
  // at the bottom; here it is turned a quarter to north-up (as on the Kisapuisto map): the
  // badminton row is the west end, tennis 4 → 1 run west → east, and the service wing (golf,
  // gym, billiards, table tennis, squash, café, reception) is the south side. The entrance is
  // the east end of the service wing, from Tarinakatu.
  'lahti-kispi': {
    title: 'Kispi-Areena',
    viewBox: [0, 0, 736, 442],
    place: { label: 'Kispi-Areena', box: [16, 4, 400, 40] },
    features: [
      { type: 'building', x: 16, y: 46, w: 660, h: 336 },
      { type: 'room', x: 578, y: 130, w: 92, h: 150, label: 'Pukuhuone', labelAlts: ['Puku-\nhuone'] },
      { type: 'room', x: 22, y: 292, w: 78, h: 82, label: 'Golfsimulaattorit 5–6', labelAlts: ['Golf-\nsimulaattorit', 'Golf'] },
      { type: 'room', x: 100, y: 292, w: 110, h: 82, label: 'Kuntosali', labelAlts: ['Kunto-\nsali'] },
      { type: 'room', x: 210, y: 292, w: 66, h: 82, label: 'Biljardi' },
      { type: 'room', x: 276, y: 292, w: 96, h: 82, label: 'Pöytätennis', labelAlts: ['Pöytä-\ntennis', 'Pingis'] },
      { type: 'room', x: 456, y: 292, w: 106, h: 82, label: 'Kahvio' },
      { type: 'room', x: 562, y: 292, w: 108, h: 82, label: 'Ajanvaraus', labelAlts: ['Ajan-\nvaraus'], level: 1 },
    ],
    courts: {
      sulka5: { x: 26, y: 58, w: 94, h: 40, kind: 'sulka', orientation: 'h', label: 'Sulka 5', short: 'Su5' },
      sulka4: { x: 26, y: 102, w: 94, h: 40, kind: 'sulka', orientation: 'h', label: 'Sulka 4', short: 'Su4' },
      sulka3: { x: 26, y: 146, w: 94, h: 40, kind: 'sulka', orientation: 'h', label: 'Sulka 3', short: 'Su3' },
      sulka2: { x: 26, y: 190, w: 94, h: 40, kind: 'sulka', orientation: 'h', label: 'Sulka 2', short: 'Su2' },
      sulka1: { x: 26, y: 234, w: 94, h: 40, kind: 'sulka', orientation: 'h', label: 'Sulka 1', short: 'Su1' },
      te4: { x: 136, y: 66, w: 92, h: 200, kind: 'tennis', surface: 'hard', orientation: 'v', label: 'Tennis 4', short: 'Te4' },
      te3: { x: 248, y: 66, w: 92, h: 200, kind: 'tennis', surface: 'hard', orientation: 'v', label: 'Tennis 3', short: 'Te3' },
      te2: { x: 360, y: 66, w: 92, h: 200, kind: 'tennis', surface: 'hard', orientation: 'v', label: 'Tennis 2', short: 'Te2' },
      te1: { x: 472, y: 66, w: 92, h: 200, kind: 'tennis', surface: 'hard', orientation: 'v', label: 'Tennis 1', short: 'Te1' },
      squash1: { x: 378, y: 293, w: 72, h: 80, kind: 'squash', orientation: 'v', label: 'Squash 1', short: 'Sq1' },
    },
    entrances: [
      {
        x: 676, y: 333, dir: 'left', label: 'Sisäänkäynti (Tarinakadun puolelta)',
        labelAlts: ['Sisäänkäynti\nTarinakadun puolelta', 'Sisäänkäynti'], box: [392, 386, 334, 54], align: 'end',
      },
    ],
  },

  // Kisapuisto outdoor clay courts beside Kispi-Areena, north up: the hall's south end at the
  // top for orientation, the six courts below it (the beach volley / basketball area between
  // them is left out, so the hall sits closer than in reality), Tarinakatu on the east.
  // NOTE: the numbering inside each pair (1 top / 2 bottom, 3 top / 4 bottom, 5 left / 6 right)
  // is read off an annotated aerial photo — check it with the hall before relying on it.
  'lahti-kisapuisto': {
    title: 'Kisapuiston ulkokentät',
    viewBox: [0, 0, 600, 660],
    place: { label: 'Kisapuisto', tag: 'Ulkokentät', box: [14, 70, 150, 80] },
    features: [
      { type: 'road', x: 532, y: 0, w: 48, h: 660, label: 'Tarinakatu', vertical: true, level: 1 },
      { type: 'path', points: [[176, 56], [176, 660]], width: 14 },
      { type: 'path', points: [[176, 296], [532, 296]], width: 10 },
      {
        type: 'trees',
        points: [[56, 196, 12], [98, 232, 9], [40, 286, 10], [92, 412, 12], [46, 494, 9], [104, 576, 11], [302, 150, 10], [262, 214, 8], [318, 612, 9]],
      },
      { type: 'building', x: 40, y: -60, w: 395, h: 116, label: 'Kispi-Areena', box: [40, 0, 395, 56], level: 1 },
    ],
    courts: {
      ulko5: { x: 350, y: 110, w: 78, h: 154, kind: 'tennis', surface: 'clay', orientation: 'v', label: 'Kenttä 5', short: 'K5' },
      ulko6: { x: 434, y: 110, w: 78, h: 154, kind: 'tennis', surface: 'clay', orientation: 'v', label: 'Kenttä 6', short: 'K6' },
      ulko3: { x: 355, y: 328, w: 80, h: 146, kind: 'tennis', surface: 'clay', orientation: 'v', label: 'Kenttä 3', short: 'K3' },
      ulko4: { x: 355, y: 478, w: 80, h: 146, kind: 'tennis', surface: 'clay', orientation: 'v', label: 'Kenttä 4', short: 'K4' },
      ulko1: { x: 200, y: 346, w: 80, h: 146, kind: 'tennis', surface: 'clay', orientation: 'v', label: 'Kenttä 1', short: 'K1' },
      ulko2: { x: 200, y: 496, w: 80, h: 146, kind: 'tennis', surface: 'clay', orientation: 'v', label: 'Kenttä 2', short: 'K2' },
    },
    entrances: [],
  },
};

/** true when VENUE_MAPS has a floor map for this BookingLocation.mapKey */
export function hasVenueMap(mapKey) {
  return typeof mapKey === 'string' && Object.prototype.hasOwnProperty.call(VENUE_MAPS, mapKey);
}
