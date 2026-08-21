// koutsi-demo-backend.jsx — makes the demo run the REAL Koutsi app.
//
// The demo used to be a second, hand-written copy of the whole UI (koutsi-demo-*.jsx).
// It drifted badly: ~1200 lines against the real app's ~2400, so features shipped to
// coaches never reached the thing prospective coaches actually try.
//
// Now the demo pages load the real app files and this file swaps the backend underneath:
//   1. lib/koutsi-data.js loads first and defines every helper on window.
//   2. this file OVERWRITES the ~65 Supabase-backed functions with in-memory versions,
//      and shims the auth layer so the demo is always "signed in".
//   3. the real UI files load last and cannot tell the difference.
//
// Everything below therefore has to match koutsi-data.js signature for signature. The
// pure helpers (dates, ISO weeks, lookups) are NOT redefined — they come from the real
// data layer unchanged, which is the point.

(function () {
  const STORE_KEY = 'koutsi_demo_state_v1';

  // ── demo identities ───────────────────────────────────────────────────────
  const COACH = 'demo-coach';
  const COACH2 = 'demo-coach-2';
  const S1 = 'demo-student-1';
  const S2 = 'demo-student-2';
  const S3 = 'demo-student-3';
  const GROUP = 'demo-group-1';

  // Which person the demo is "logged in as" — the player page overrides this before
  // this file runs, so one backend serves both demos.
  const DEMO_UID = window.KOUTSI_DEMO_ROLE === 'player' ? S1 : COACH;

  // ── small local helpers (the real data layer's are private to its IIFE) ────
  const pad = (n) => String(n).padStart(2, '0');
  function dayStr(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function isoAt(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  }
  function hueOf(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  }
  const initialOf = (name) => (name || '?').trim().charAt(0).toUpperCase() || '?';
  const shortDate = (iso) => window.koutsiFmtShortDate(String(iso).slice(0, 10));
  let seq = 0;
  const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq += 1)}`;

  function person(id, name, extra) {
    return Object.assign({ id, name, initial: initialOf(name), hue: hueOf(id) }, extra || {});
  }

  // ── seed ──────────────────────────────────────────────────────────────────
  // Kept close to the old demo's content so the story a prospective coach reads
  // stays the same; only the shape changed to match the real app's state.
  function seed() {
    const now = window.koutsiCurrentIsoWeek();
    return {
      coach: person(COACH, 'Anna Koskinen', {
        tagline: 'Tennisvalmentaja · Lahti',
        bio: 'Valmennan juniori- ja aikuispelaajia. Erikoisalana lyöntitekniikka ja kilpapelaajien fysiikka.',
        experience: '12 vuotta valmennuskokemusta · Suomen Tennisliiton tason 2 valmentajakoulutus',
        specialties: ['Yksityistunnit', 'Ryhmätreenit', 'Junioripelaajat', 'Kilpavalmennus'],
      }),
      coaches: [
        person(COACH, 'Anna Koskinen', { tagline: 'Tennisvalmentaja · Lahti', bio: '', experience: '', specialties: [] }),
        person(COACH2, 'Juho Aalto', { tagline: 'Fysiikkavalmentaja', bio: '', experience: '', specialties: [] }),
      ],
      students: [
        student(S1, 'Maria K.', 16, 'Kilpapelaaja', {
          goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli',
          lastSession: 'Kämmenen valmistautuminen myöhässä',
          focus: 'Split step + ensimmäinen askel',
          background: 'Vanha nilkkavamma (2025) — vältä äkkinäisiä suunnanmuutoksia alkulämmittelyssä. Tavoitteena SM-kisat keväällä.',
          playerWish: 'Haluaisin harjoitella enemmän verkkopeliä ensi kerralla.',
          diary: [
            { id: 'd1', at: isoAt(-2), text: 'Hyvä nousu syötössä tällä viikolla — jatka samaan malliin.' },
            { id: 'd2', at: isoAt(-7), text: 'Aloitettiin uusi lyöntitekniikka forehandiin.' },
          ],
          homework: [{ id: 'h1', at: isoAt(-8), text: '10 min syöttöharjoittelua päivässä', done: false, doneAt: null }],
          videos: [
            { id: 'v1', at: isoAt(-45), title: 'Syöttöanalyysi', date: dayStr(-45), tags: ['syotto'], addedBy: 'coach' },
            { id: 'v2', at: isoAt(-52), title: 'Forehand vertailu', date: dayStr(-52), tags: ['tekniikka'], addedBy: 'coach' },
          ],
          moods: [
            { id: 'm1', at: isoAt(-2), score: 4, note: 'Hyvä fiilis treenin jälkeen', hiddenFromCoach: false },
            { id: 'm2', at: isoAt(-9), score: 3, note: '', hiddenFromCoach: false },
          ],
          matchNotes: [
            { id: 'n1', at: isoAt(-5), opponentName: 'Sofia L.', date: dayStr(-5), note: 'Vahva kämmen, rystyllä epävarma paineessa. Pelaa toiselle puolelle.' },
          ],
        }),
        student(S2, 'Aleksi R.', 14, 'Keskitaso', {
          goal: 'Backhandin tasapaino pitkissä vaihdoissa',
          lastSession: 'Liikkeen aloitus parani huomattavasti',
          focus: 'Askelkuvio ennen lyöntiä',
          diary: [{ id: 'd3', at: isoAt(-1), text: 'Backhand parani huomattavasti — hyvä liikkeen aloitus.' }],
          homework: [{ id: 'h2', at: isoAt(-13), text: 'Katso videoanalyysi backhandista', done: true, doneAt: isoAt(-11) }],
          videos: [{ id: 'v3', at: isoAt(-42), title: 'Backhand-analyysi', date: dayStr(-42), tags: ['tekniikka'], addedBy: 'coach' }],
        }),
        student(S3, 'Venla H.', 12, 'Aloittelija', {
          goal: 'Pallon rytmi ja peliin pääsy',
          focus: 'Perusotteet',
          diary: [],
          homework: [],
          videos: [],
        }),
      ],
      groups: [{
        id: GROUP, coachId: COACH, name: 'Juniorit A', level: 'Keskitaso', day: 'Ti', time: '17:00',
        memberIds: [S1, S2, S3],
        themes: [{ id: 't1', year: now.year, week: now.week, title: 'Syötön rytmi', lead: 'Tasainen heitto ja sama rytmi joka syötössä.' }],
        theme: { id: 't1', year: now.year, week: now.week, title: 'Syötön rytmi', lead: 'Tasainen heitto ja sama rytmi joka syötössä.' },
        upcomingThemes: [],
        annualPlan: null,
      }],
      trainings: [
        { id: 'tr1', date: dayStr(1), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: GROUP, coachId: COACH, seriesId: 'ser1', absences: [] },
        { id: 'tr2', date: dayStr(8), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: GROUP, coachId: COACH, seriesId: 'ser1', absences: [] },
        { id: 'tr3', date: dayStr(-6), time: '17:00', type: 'Ryhmätreeni', studentId: null, groupId: GROUP, coachId: COACH, seriesId: 'ser1', absences: [{ studentId: S3, reason: 'poissa' }] },
        { id: 'tr4', date: dayStr(3), time: '15:30', type: 'Yksityistunti', studentId: S1, groupId: null, coachId: COACH, seriesId: null, absences: [] },
      ],
      exercises: [
        { id: 'e1', coachId: COACH, name: 'Ristiin–suoraan', goal: 'Suunnanvaihdon tarkkuus', players: '2 pelaajaa', playerCount: 2, duration: '15 min', level: 'Keskitaso', tags: ['tekniikka'] },
        { id: 'e2', coachId: COACH, name: 'Syöttösarja 10', goal: 'Kakkossyötön varmuus', players: '1 pelaaja', playerCount: 1, duration: '10 min', level: 'Kaikki tasot', tags: ['syotto'] },
      ],
      clubEvents: [
        { id: 'ce1', date: dayStr(14), title: 'Seuran kevätkisat', kind: 'kisa' },
        { id: 'ce2', date: dayStr(30), title: 'Vanhempainilta', kind: 'muu' },
      ],
      // side tables the real app reads
      notifications: [
        { id: 'nt1', kind: 'homework_done', title: 'Aleksi R. merkitsi kotitehtävän tehdyksi', body: 'Katso videoanalyysi backhandista', linkPath: null, createdAt: isoAt(-11), read: false },
      ],
      inviteCodes: [],
      joinCode: 'DEMO24',
      emailPref: true,
    };
  }

  function student(id, name, age, level, extra) {
    return Object.assign(person(id, name, {
      age, level, goal: '', lastSession: '', focus: '', background: '', playerNote: '', playerWish: '',
      joinedAt: isoAt(-120), diary: [], homework: [], videos: [], moods: [], matchNotes: [],
    }), extra || {});
  }

  // ── store ─────────────────────────────────────────────────────────────────
  const clone = (v) => JSON.parse(JSON.stringify(v));
  let state = null;

  function load() {
    if (state) return state;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      state = raw ? JSON.parse(raw) : seed();
    } catch { state = seed(); }
    return state;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }
  function reset() {
    state = seed();
    save();
  }
  // Demo mutations are instant; wrapping them in a promise keeps every caller's
  // `await` behaving exactly as it does against Supabase.
  const done = (v) => Promise.resolve(v);
  const findStudent = (id) => load().students.find((s) => s.id === id);

  // Sub-records live inside their student, so edits look them up by id across all of them.
  function eachStudentList(key, fn) {
    load().students.forEach((s) => { s[key] = fn(s[key] || [], s); });
    save();
  }
  function removeById(key, id) {
    eachStudentList(key, (list) => list.filter((x) => x.id !== id));
    return done();
  }
  function patchById(key, id, patch) {
    eachStudentList(key, (list) => list.map((x) => (x.id === id ? Object.assign({}, x, patch) : x)));
    return done();
  }

  // ── fake Supabase client ──────────────────────────────────────────────────
  // The apps only use realtime channels and storage URLs; both are inert here.
  const noopChannel = {
    on() { return this; },
    subscribe() { return this; },
  };
  window.koutsiSupabase = {
    channel: () => noopChannel,
    removeChannel: () => {},
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
  };

  // ── auth shim ─────────────────────────────────────────────────────────────
  const demoAuth = {
    loading: false,
    session: { user: { id: DEMO_UID, email: 'demo@krossi.app' } },
    profile: { id: DEMO_UID, name: DEMO_UID === COACH ? 'Anna Koskinen' : 'Maria K.' },
    needsOnboarding: false,
    recoveryMode: false,
    profileError: null,
    retryProfile: () => {},
    // "Kirjaudu ulos" in a demo means: start the tour over.
    signOut: () => { reset(); window.location.reload(); },
    refreshProfile: () => Promise.resolve(),
  };
  window.useKoutsiAuth = () => demoAuth;
  window.KoutsiAuthProvider = ({ children }) => children;
  // These three never render in the demo, but the app references them.
  window.KoutsiAuthScreen = () => null;
  window.KoutsiProfileOnboarding = () => null;
  window.KoutsiPasswordResetScreen = () => null;
  // These two DO render: the root shows a loader for the first frame while it checks
  // whether the signed-in user is a coach/student. Without them React would be asked
  // to render `undefined` and throw.
  window.KoutsiAuthLoadingScreen = () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sand, #f7f5ef)', color: '#8a857a', fontSize: 14 }}>
      Ladataan…
    </div>
  );
  window.KoutsiErrorScreen = ({ message, onRetry }) => (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--sand, #f7f5ef)' }}>
      <div style={{ fontSize: 14, color: '#8f2f24', textAlign: 'center', maxWidth: 360 }}>{message || 'Jokin meni pieleen.'}</div>
      {onRetry && <button onClick={onRetry} className="btn-outline btn-sm">Yritä uudelleen</button>}
    </div>
  );

  // ── loaders ───────────────────────────────────────────────────────────────
  function coachState() {
    const s = clone(load());
    return {
      coach: s.coach, coaches: s.coaches, students: s.students, groups: s.groups,
      trainings: s.trainings, exercises: s.exercises, clubEvents: s.clubEvents,
    };
  }
  window.koutsiLoadCoachState = () => done(coachState());
  window.koutsiLoadStudentState = (studentId) => {
    const s = clone(load());
    const me = s.students.find((x) => x.id === studentId) || s.students[0];
    return done({
      coach: s.coaches[0] || null, coaches: s.coaches, students: [me],
      groups: s.groups.filter((g) => g.memberIds.includes(me.id)),
      trainings: s.trainings, exercises: s.exercises, clubEvents: s.clubEvents,
    });
  };
  // Row presence is what gates the app; in the demo both always exist.
  window.koutsiFetchCoachRow = (uid) => done(uid === COACH ? { id: COACH } : null);
  window.koutsiFetchStudentRow = (uid) => done(findStudent(uid) ? { id: uid } : null);
  window.koutsiStartWithoutCode = () => done({ id: DEMO_UID });

  // ── diary ─────────────────────────────────────────────────────────────────
  window.koutsiAddDiaryEntry = (coachId, studentId, text) => {
    const st = findStudent(studentId);
    if (st) { st.diary.unshift({ id: newId('d'), at: new Date().toISOString(), date: shortDate(new Date().toISOString()), text }); save(); }
    return done();
  };
  window.koutsiUpdateDiaryEntry = (id, text) => patchById('diary', id, { text });
  window.koutsiDeleteDiaryEntry = (id) => removeById('diary', id);

  // ── homework ──────────────────────────────────────────────────────────────
  window.koutsiAddHomework = (studentId, text) => {
    const st = findStudent(studentId);
    if (st) { st.homework.unshift({ id: newId('h'), at: new Date().toISOString(), text, done: false, doneAt: null }); save(); }
    return done();
  };
  window.koutsiToggleHomeworkDone = (id, isDone) => patchById('homework', id, { done: isDone, doneAt: isDone ? new Date().toISOString() : null });
  window.koutsiUpdateHomework = (id, text) => patchById('homework', id, { text });
  window.koutsiDeleteHomework = (id) => removeById('homework', id);

  // ── moods / match notes ───────────────────────────────────────────────────
  window.koutsiAddMood = (studentId, { score, note, hiddenFromCoach }) => {
    const st = findStudent(studentId);
    if (st) {
      const at = new Date().toISOString();
      st.moods.unshift({ id: newId('m'), at, date: shortDate(at), score, note: note || '', hiddenFromCoach: !!hiddenFromCoach });
      save();
    }
    return done();
  };
  window.koutsiSetMoodHidden = (id, hidden) => patchById('moods', id, { hiddenFromCoach: !!hidden });
  window.koutsiDeleteMood = (id) => removeById('moods', id);
  window.koutsiAddMatchNote = (studentId, { opponentName, date, note }) => {
    const st = findStudent(studentId);
    if (st) { st.matchNotes.unshift({ id: newId('n'), at: new Date().toISOString(), opponentName, date, note: note || '' }); save(); }
    return done();
  };
  window.koutsiUpdateMatchNote = (id, patch) => patchById('matchNotes', id, patch);
  window.koutsiDeleteMatchNote = (id) => removeById('matchNotes', id);

  // ── student fields ────────────────────────────────────────────────────────
  const setField = (studentId, key, value) => {
    const st = findStudent(studentId);
    if (st) { st[key] = value; save(); }
    return done();
  };
  window.koutsiSaveBackground = (id, text) => setField(id, 'background', text);
  window.koutsiSetStudentLevel = (id, level) => setField(id, 'level', level);
  window.koutsiSaveGoal = (id, goal) => setField(id, 'goal', goal);
  window.koutsiSaveNote = (id, v) => setField(id, 'playerNote', v);
  window.koutsiSaveWish = (id, v) => setField(id, 'playerWish', v);

  // ── videos ────────────────────────────────────────────────────────────────
  // No file ever leaves the browser in the demo: an uploaded file becomes an
  // object URL so it still plays, and a link stays a link.
  window.koutsiShareVideo = ({ title, date, tags, studentIds, addedById, file, externalUrl }) => {
    const url = file ? URL.createObjectURL(file) : null;
    (studentIds || []).forEach((sid) => {
      const st = findStudent(sid);
      if (!st) return;
      st.videos.unshift({
        id: newId('v'), at: new Date().toISOString(), title, date, tags: tags || [],
        addedBy: addedById === sid ? 'player' : 'coach',
        storagePath: url, externalUrl: externalUrl || null, mimeType: file ? file.type : null,
      });
    });
    save();
    return done();
  };
  // storagePath already IS a playable object URL here.
  window.koutsiVideoUrl = (storagePath) => done(storagePath || null);
  window.koutsiDeleteVideo = (id) => removeById('videos', id);

  // ── trainings ─────────────────────────────────────────────────────────────
  window.koutsiAddTraining = ({ coachId, studentId, groupId, date, time, type, repeatUntil }) => {
    const s = load();
    const seriesId = repeatUntil ? newId('ser') : null;
    const dates = repeatUntil ? window.koutsiWeeklyDates(date, repeatUntil) : [date];
    dates.forEach((d) => s.trainings.push({
      id: newId('tr'), date: d, time, type,
      studentId: studentId || null, groupId: groupId || null, coachId: coachId || COACH,
      seriesId, absences: [],
    }));
    save();
    return done(dates.length);
  };
  window.koutsiUpdateTraining = (id, patch) => {
    const s = load();
    s.trainings = s.trainings.map((t) => (t.id === id ? Object.assign({}, t, patch) : t));
    save();
    return done();
  };
  window.koutsiUpdateTrainingSeries = (seriesId, patch, fromDate) => {
    const s = load();
    s.trainings = s.trainings.map((t) => (t.seriesId === seriesId && t.date >= fromDate ? Object.assign({}, t, patch) : t));
    save();
    return done();
  };
  window.koutsiDeleteTraining = (id) => {
    const s = load();
    s.trainings = s.trainings.filter((t) => t.id !== id);
    save();
    return done();
  };
  window.koutsiDeleteTrainingSeries = (seriesId, fromDate) => {
    const s = load();
    s.trainings = s.trainings.filter((t) => !(t.seriesId === seriesId && t.date >= fromDate));
    save();
    return done();
  };
  window.koutsiCountSeriesRemaining = (seriesId, fromDate) =>
    done(load().trainings.filter((t) => t.seriesId === seriesId && t.date >= fromDate).length);

  // paikalla → poissa → loukkaantunut → paikalla
  window.koutsiCycleAbsence = (trainingId, studentId, currentReason) => {
    const t = load().trainings.find((x) => x.id === trainingId);
    if (t) {
      const rest = (t.absences || []).filter((a) => a.studentId !== studentId);
      if (!currentReason) rest.push({ studentId, reason: 'poissa' });
      else if (currentReason === 'poissa') rest.push({ studentId, reason: 'vamma' });
      t.absences = rest;
      save();
    }
    return done();
  };

  // ── groups ────────────────────────────────────────────────────────────────
  window.koutsiCreateGroup = ({ coachId, name, level, day, time, memberIds }) => {
    const s = load();
    const id = newId('g');
    s.groups.push({
      id, coachId: coachId || COACH, name, level, day, time,
      memberIds: memberIds || [], themes: [], theme: null, upcomingThemes: [], annualPlan: null,
    });
    save();
    return done(id);
  };
  window.koutsiUpdateGroup = (groupId, patch) => {
    const s = load();
    s.groups = s.groups.map((g) => (g.id === groupId ? Object.assign({}, g, patch) : g));
    save();
    return done();
  };
  window.koutsiDeleteGroup = (groupId) => {
    const s = load();
    s.groups = s.groups.filter((g) => g.id !== groupId);
    s.trainings = s.trainings.filter((t) => t.groupId !== groupId);
    save();
    return done();
  };
  window.koutsiAddGroupMembers = (groupId, studentIds) => {
    const g = load().groups.find((x) => x.id === groupId);
    if (g) { g.memberIds = Array.from(new Set([...(g.memberIds || []), ...studentIds])); save(); }
    return done();
  };
  window.koutsiRemoveGroupMember = (groupId, studentId) => {
    const g = load().groups.find((x) => x.id === groupId);
    if (g) { g.memberIds = (g.memberIds || []).filter((id) => id !== studentId); save(); }
    return done();
  };

  // ── weekly themes ─────────────────────────────────────────────────────────
  window.koutsiSaveThemes = (groupId, rows) => {
    const g = load().groups.find((x) => x.id === groupId);
    if (!g) return done(0);
    const clean = (rows || []).filter((r) => r.title && r.title.trim());
    clean.forEach((r) => {
      const hit = g.themes.find((t) => t.year === r.year && t.week === r.week);
      if (hit) { hit.title = r.title.trim(); hit.lead = (r.lead || '').trim(); }
      else g.themes.push({ id: newId('t'), year: r.year, week: r.week, title: r.title.trim(), lead: (r.lead || '').trim() });
    });
    refreshThemes(g);
    save();
    return done(clean.length);
  };
  window.koutsiDeleteThemes = (themeIds) => {
    const ids = new Set(themeIds || []);
    load().groups.forEach((g) => { g.themes = g.themes.filter((t) => !ids.has(t.id)); refreshThemes(g); });
    save();
    return done();
  };
  function refreshThemes(g) {
    g.themes.sort(window.koutsiCompareIsoWeeks);
    const now = window.koutsiCurrentIsoWeek();
    g.theme = g.themes.find((t) => t.year === now.year && t.week === now.week) || null;
    g.upcomingThemes = g.themes.filter((t) => window.koutsiCompareIsoWeeks(t, now) > 0);
  }

  // ── annual plan ───────────────────────────────────────────────────────────
  window.koutsiUploadAnnualPlan = (groupId, file) => {
    const g = load().groups.find((x) => x.id === groupId);
    if (g) {
      g.annualPlan = {
        filename: file.name, storagePath: URL.createObjectURL(file), sizeBytes: file.size,
        status: 'review', date: window.koutsiTodayStr(),
      };
      save();
    }
    return done();
  };
  window.koutsiAnnualPlanUrl = (storagePath) => done(storagePath || null);
  window.koutsiRemoveAnnualPlan = (groupId) => {
    const g = load().groups.find((x) => x.id === groupId);
    if (g) { g.annualPlan = null; save(); }
    return done();
  };
  window.koutsiPendingAnnualPlans = () => done([]);
  window.koutsiPublishAnnualPlan = (groupId) => {
    const g = load().groups.find((x) => x.id === groupId);
    if (g && g.annualPlan) { g.annualPlan.status = 'published'; save(); }
    return done();
  };

  // ── exercises ─────────────────────────────────────────────────────────────
  window.koutsiAddExercise = ({ coachId, name, goal, players, playerCount, duration, level, tags }) => {
    load().exercises.push({ id: newId('e'), coachId: coachId || COACH, name, goal, players, playerCount, duration, level, tags: tags || [] });
    save();
    return done();
  };
  window.koutsiUpdateExercise = (id, patch) => {
    const s = load();
    s.exercises = s.exercises.map((e) => (e.id === id ? Object.assign({}, e, patch) : e));
    save();
    return done();
  };
  window.koutsiDeleteExercise = (id) => {
    const s = load();
    s.exercises = s.exercises.filter((e) => e.id !== id);
    save();
    return done();
  };
  window.koutsiSeedExercises = () => done(0);

  // ── club events ───────────────────────────────────────────────────────────
  window.koutsiAddClubEvent = ({ date, title, kind }) => {
    load().clubEvents.push({ id: newId('ce'), date, title, kind });
    save();
    return done();
  };
  window.koutsiUpdateClubEvent = (id, patch) => {
    const s = load();
    s.clubEvents = s.clubEvents.map((e) => (e.id === id ? Object.assign({}, e, patch) : e));
    save();
    return done();
  };
  window.koutsiDeleteClubEvent = (id) => {
    const s = load();
    s.clubEvents = s.clubEvents.filter((e) => e.id !== id);
    save();
    return done();
  };

  // ── invite codes / coaching link ──────────────────────────────────────────
  window.koutsiMyJoinCode = () => done(load().joinCode);
  window.koutsiListInviteCodes = () => done(clone(load().inviteCodes));
  window.koutsiCreateInviteCode = (groupId, { expiresDays = 14, maxUses = 1 } = {}) => {
    const code = { code: newId('K').slice(-6).toUpperCase(), groupId: groupId || null,
      createdAt: new Date().toISOString(), expiresAt: null, maxUses, useCount: 0, revokedAt: null, active: true };
    load().inviteCodes.push(code);
    save();
    return done(code);
  };
  window.koutsiRevokeInviteCode = (code) => {
    const hit = load().inviteCodes.find((c) => c.code === code);
    if (hit) { hit.revokedAt = new Date().toISOString(); hit.active = false; save(); }
    return done();
  };
  window.koutsiRedeemInviteCode = () => done({ coach_id: COACH, coach_name: 'Anna Koskinen', group_id: GROUP, group_name: 'Juniorit A' });
  window.koutsiRedeemCoachKey = () => done({ ok: true });
  window.koutsiEndCoaching = (coachId, studentId) => {
    const s = load();
    s.students = s.students.filter((x) => x.id !== studentId);
    s.groups.forEach((g) => { g.memberIds = g.memberIds.filter((id) => id !== studentId); });
    save();
    return done();
  };

  // ── profile / notifications / settings ────────────────────────────────────
  window.koutsiSaveCoachProfile = (coachId, patch) => {
    const s = load();
    Object.assign(s.coach, patch);
    save();
    return done();
  };
  window.koutsiSaveDisplayName = (uid, name) => {
    const s = load();
    if (uid === COACH) { s.coach.name = name; s.coach.initial = initialOf(name); }
    const st = findStudent(uid);
    if (st) { st.name = name; st.initial = initialOf(name); }
    save();
    return done();
  };
  window.koutsiUploadAvatar = (uid, file) => done(URL.createObjectURL(file));
  window.koutsiLoadNotifications = () => done(clone(load().notifications).map((n) => Object.assign({}, n, { date: shortDate(n.createdAt) })));
  window.koutsiMarkNotificationsRead = () => {
    load().notifications.forEach((n) => { n.read = true; });
    save();
    return done();
  };
  window.koutsiLoadEmailPref = () => done(load().emailPref);
  window.koutsiSetEmailPref = (uid, enabled) => { load().emailPref = !!enabled; save(); return done(); };
  window.koutsiExportMyData = () => done(clone(load()));
  // Nothing to delete server-side — treat it as "start the demo over".
  window.koutsiDeleteAccount = () => { reset(); return done(); };

  // Exposed so a "Aloita demo alusta" control can call it.
  window.koutsiDemoReset = () => { reset(); window.location.reload(); };
})();
