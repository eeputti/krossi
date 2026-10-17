// library.js — Krossi's drill library as data: every topic file in CATEGORIES order. The apps
// never import this: build.mjs writes it to /koutsi-uusi/drills.json, which the drill bank
// loads when it is first needed (shared/drills/useLibrary.js), so the library doesn't slow down
// opening the app. Tests and build scripts import it directly.
import { lammittely } from './lammittely.js';
import { pohjalyonnit } from './pohjalyonnit.js';
import { syotto } from './syotto.js';
import { palautus } from './palautus.js';
import { verkkopeli } from './verkkopeli.js';
import { liikkuminen } from './liikkuminen.js';
import { pistepeli } from './pistepeli.js';
import { nelinpeli } from './nelinpeli.js';
import { lapset } from './lapset.js';
import { fysiikka } from './fysiikka.js';

export const LIBRARY = [
  ...lammittely, ...pohjalyonnit, ...syotto, ...palautus, ...verkkopeli,
  ...liikkuminen, ...pistepeli, ...nelinpeli, ...lapset, ...fysiikka,
];
