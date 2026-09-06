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
        bio: 'Valmennan aikuispelaajia. Erikoisalana lyöntitekniikka ja kilpapelaajien fysiikka.',
        experience: '12 vuotta valmennuskokemusta · Suomen Tennisliiton tason 2 valmentajakoulutus',
        specialties: ['Yksityistunnit', 'Ryhmätreenit', 'Aikuispelaajat', 'Kilpavalmennus'],
      }),
      coaches: [
        person(COACH, 'Anna Koskinen', { tagline: 'Tennisvalmentaja · Lahti', bio: '', experience: '', specialties: [] }),
        person(COACH2, 'Juho Aalto', { tagline: 'Fysiikkavalmentaja', bio: '', experience: '', specialties: [] }),
      ],
      students: [
        student(S1, 'Maria K.', 26, 'Kilpapelaaja', {
          goal: 'Varmempi kakkossyöttö ja rohkeampi verkkopeli',
          lastSession: 'Kämmenen valmistautuminen myöhässä',
          focus: 'Split step + ensimmäinen askel',
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
            { id: 'n1', at: isoAt(-5), opponentName: 'Sofia L.', date: dayStr(-5), note: 'Vahva kämmen, rystyllä epävarma paineessa. Pelaa toiselle puolelle.', durationMinutes: 95, result: 'voitto', format: 'kaksinpeli', score: '6-4 6-3' },
          ],
        }),
        student(S2, 'Aleksi R.', 24, 'Keskitaso', {
          goal: 'Backhandin tasapaino pitkissä vaihdoissa',
          lastSession: 'Liikkeen aloitus parani huomattavasti',
          focus: 'Askelkuvio ennen lyöntiä',
          diary: [{ id: 'd3', at: isoAt(-1), text: 'Backhand parani huomattavasti — hyvä liikkeen aloitus.' }],
          homework: [{ id: 'h2', at: isoAt(-13), text: 'Katso videoanalyysi backhandista', done: true, doneAt: isoAt(-11) }],
          videos: [{ id: 'v3', at: isoAt(-42), title: 'Backhand-analyysi', date: dayStr(-42), tags: ['tekniikka'], addedBy: 'coach' }],
        }),
        student(S3, 'Venla H.', 22, 'Aloittelija', {
          goal: 'Pallon rytmi ja peliin pääsy',
          focus: 'Perusotteet',
          diary: [],
          homework: [],
          videos: [],
        }),
      ],
      groups: [{
        id: GROUP, coachId: COACH, name: 'Aikuiset A', level: 'Keskitaso', day: 'Ti', time: '17:00', durationMinutes: 90,
        memberIds: [S1, S2, S3], slots: [],
        themes: [{ id: 't1', year: now.year, week: now.week, title: 'Syötön rytmi', lead: 'Tasainen heitto ja sama rytmi joka syötössä.' }],
        theme: { id: 't1', year: now.year, week: now.week, title: 'Syötön rytmi', lead: 'Tasainen heitto ja sama rytmi joka syötössä.' },
        upcomingThemes: [],
        annualPlan: null,
      }],
      trainings: [
        { id: 'tr1', date: dayStr(1), time: '17:00', type: 'Ryhmätreeni', durationMinutes: 90, studentId: null, groupId: GROUP, coachId: COACH, seriesId: 'ser1', absences: [] },
        { id: 'tr2', date: dayStr(8), time: '17:00', type: 'Ryhmätreeni', durationMinutes: 90, studentId: null, groupId: GROUP, coachId: COACH, seriesId: 'ser1', absences: [] },
        { id: 'tr3', date: dayStr(-6), time: '17:00', type: 'Ryhmätreeni', durationMinutes: 90, studentId: null, groupId: GROUP, coachId: COACH, seriesId: 'ser1', absences: [{ studentId: S3, reason: 'poissa', note: '', reportedBy: S3, updatedAt: isoAt(-7) }] },
        { id: 'tr4', date: dayStr(3), time: '15:30', type: 'Yksityistunti', durationMinutes: null, studentId: S1, groupId: null, coachId: COACH, seriesId: null, absences: [] },
        // Näyttää valmentajalle heti demossa, miltä pelaajan oma aktiivisuus näyttää:
        // Maria on käynyt tekemässä omatoimisia juttuja, Aleksi ja Venla eivät.
        { id: 'tr5', date: dayStr(-1), time: '09:00', type: 'Fysiikka', durationMinutes: 45, loggedBy: 'player', notes: 'Kuntosali — jalat ja keskivartalo.', studentId: S1, groupId: null, coachId: COACH, seriesId: null, absences: [] },
        { id: 'tr6', date: dayStr(-3), time: '12:00', type: 'Omatoiminen harjoitus', durationMinutes: 40, loggedBy: 'player', notes: 'Syöttöjä yksin seinää vasten.', studentId: S1, groupId: null, coachId: COACH, seriesId: null, absences: [] },
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
      annualPlanSubmissions: [],
      joinCode: 'DEMO24',
      emailPref: true,
    };
  }

  function student(id, name, age, level, extra) {
    const ageValue = age == null ? '' : String(age);
    return Object.assign(person(id, name, {
      age, ageRange: null, ageValue, ageLabel: age == null ? '' : `${age} v`,
      level, goal: '', lastSession: '', focus: '', playerNote: '', playerWish: '',
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
  // Jos datakerrokseen ilmestyy uusi Supabase-funktio jota demo ei korvaa, kutsu
  // päätyisi tänne. Kaadetaan selkeällä viestillä sen sijaan että tulisi
  // arvoituksellinen "rpc is not a function". build.mjs tarkistaa tämän myös
  // etukäteen, joten tämä on vain viimeinen turvaverkko.
  const notInDemo = (what) => () => {
    throw new Error(`Demo ei toteuta tätä toimintoa (${what}). Lisää se koutsi-demo-backend.jsx:ään.`);
  };
  window.koutsiSupabase = {
    channel: () => noopChannel,
    removeChannel: () => {},
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }), getPublicUrl: (p) => ({ data: { publicUrl: p || '' } }) }) },
    rpc: notInDemo('rpc'),
    from: notInDemo('from'),
    functions: { invoke: notInDemo('functions.invoke') },
  };

  // ── auth shim ─────────────────────────────────────────────────────────────
  const demoAuth = {
    loading: false,
    session: { user: { id: DEMO_UID, email: 'demo@krossi.app' } },
    profile: { id: DEMO_UID, name: DEMO_UID === COACH ? 'Anna Koskinen' : 'Maria K.' },
    needsOnboarding: false,
    pilotAccepted: true,
    pilotError: false,
    recoveryMode: false,
    profileError: null,
    retryProfile: () => {},
    // "Kirjaudu ulos" in a demo means: start the tour over.
    // Demossa uloskirjautuminen päättää kokeilun ja vie oikeaan palveluun,
    // kuten oikeassa sovelluksessa se veisi kirjautumisnäkymään.
    signOut: () => { reset(); window.location.href = SIGNUP_URL; },
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
    const groups = s.groups.filter((g) => g.memberIds.includes(me.id));
    const rosterIds = new Set(groups.flatMap((g) => g.memberIds));
    const roster = s.students
      .filter((student) => student.id !== me.id && rosterIds.has(student.id))
      .map((student) => ({
        id: student.id, initial: student.initial, hue: student.hue,
        avatarUrl: student.avatarUrl || '', name: student.name,
        level: student.level || null, rosterOnly: true,
      }));
    return done({
      coach: s.coaches[0] || null, coaches: s.coaches, students: [me, ...roster],
      groups,
      trainings: s.trainings, exercises: s.exercises, clubEvents: s.clubEvents,
    });
  };
  // Row presence is what gates the app; in the demo both always exist.
  window.koutsiFetchCoachRow = (uid) => done(uid === COACH ? { id: COACH } : null);
  window.koutsiFetchStudentRow = (uid) => done(findStudent(uid) ? { id: uid } : null);
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
  window.koutsiAddMatchNote = (studentId, { opponentName, date, note, durationMinutes, result, format, score, partnerName, opponent2Name }) => {
    const st = findStudent(studentId);
    if (st) {
      st.matchNotes.unshift({
        id: newId('n'), at: new Date().toISOString(), opponentName, date, note: note || '',
        durationMinutes: durationMinutes || null, result: result || null, format: format || null, score: score || '',
        partnerName: format === 'nelinpeli' ? (partnerName || '') : '',
        opponent2Name: format === 'nelinpeli' ? (opponent2Name || '') : '',
      });
      save();
    }
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
  window.koutsiSetStudentLevel = (id, level) => setField(id, 'level', level);
  window.koutsiSaveGoal = (id, goal) => setField(id, 'goal', goal);
  window.koutsiSaveNote = (id, v) => setField(id, 'playerNote', v);
  window.koutsiSaveWish = (id, v) => setField(id, 'playerWish', v);

  // ── videos ────────────────────────────────────────────────────────────────
  // No file ever leaves the browser in the demo: an uploaded file becomes an
  // object URL so it still plays, and a link stays a link.
  window.koutsiShareVideo = ({ shareId, title, date, tags, studentIds, addedById, file, externalUrl, onProgress }) => {
    const resolvedShareId = shareId || newId('vs');
    const url = file ? URL.createObjectURL(file) : null;
    if (file && onProgress) onProgress(100);
    (studentIds || []).forEach((sid) => {
      const st = findStudent(sid);
      if (!st) return;
      st.videos.unshift({
        id: newId('v'), shareId: resolvedShareId, recipientIds: [...studentIds],
        at: new Date().toISOString(), title, date, tags: tags || [],
        addedBy: addedById === sid ? 'player' : 'coach',
        storagePath: url, externalUrl: externalUrl || null, mimeType: file ? file.type : null,
      });
    });
    save();
    return done();
  };
  window.koutsiSetVideoRecipients = (shareId, studentIds) => {
    const s = load();
    let source = null;
    s.students.forEach((st) => {
      const match = (st.videos || []).find((v) => v.shareId === shareId);
      if (match && !source) source = match;
    });
    if (!source) return done();
    const recipients = [...new Set(studentIds || [])];
    s.students.forEach((st) => {
      st.videos = (st.videos || []).filter((v) => v.shareId !== shareId || recipients.includes(st.id));
      const current = st.videos.find((v) => v.shareId === shareId);
      if (recipients.includes(st.id) && !current) {
        st.videos.unshift({
          ...source, id: newId('v'), recipientIds: recipients,
          addedBy: source.addedBy,
        });
      }
      st.videos.forEach((v) => { if (v.shareId === shareId) v.recipientIds = recipients; });
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
      id: newId('tr'), date: d, time, type, durationMinutes: null,
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

  window.koutsiAddSelfTraining = ({ studentId, coachId, date, endDate, time, type, durationMinutes, notes }) => {
    const s = load();
    s.trainings.push({
      id: newId('tr'), date, endDate: endDate || null, time, type, durationMinutes: durationMinutes || null,
      loggedBy: 'player', notes: notes || '',
      studentId: studentId || null, groupId: null, coachId: coachId || COACH, seriesId: null, absences: [],
    });
    save();
    return done();
  };
  window.koutsiDeleteSelfTraining = (id) => {
    const s = load();
    s.trainings = s.trainings.filter((t) => t.id !== id);
    save();
    return done();
  };

  window.koutsiSetAttendance = (trainingIds, studentId, status, note) => {
    const ids = new Set(trainingIds || []);
    load().trainings.forEach((t) => {
      if (!ids.has(t.id)) return;
      const rest = (t.absences || []).filter((a) => a.studentId !== studentId);
      if (status !== 'paikalla') rest.push({
        studentId,
        reason: 'poissa',
        note: '',
        reportedBy: DEMO_UID,
        updatedAt: new Date().toISOString(),
      });
      t.absences = rest;
    });
    save();
    return done();
  };

  // paikalla → poissa → paikalla
  window.koutsiCycleAbsence = (trainingId, studentId, currentReason) => {
    const next = !currentReason ? 'poissa' : 'paikalla';
    return window.koutsiSetAttendance([trainingId], studentId, next, '');
  };

  // ── groups ────────────────────────────────────────────────────────────────
  // Mirrors koutsi-data.js's real generation so the demo's calendar fills in the same
  // way a live coach's would, instead of leaving a freshly created group with no sessions.
  const demoGenerateGroupTrainings = (s, groupId, coachId, day, time, durationMinutes, fromDate, weeksAhead) => {
    const first = window.koutsiNextWeekday ? window.koutsiNextWeekday(fromDate, day) : null;
    if (!first || !time) return null;
    const span = (window.koutsiClampGroupTrainingWeeks(weeksAhead ?? window.KOUTSI_DEFAULT_GROUP_TRAINING_WEEKS) - 1) * 7;
    const dates = window.koutsiWeeklyDates(first, window.koutsiAddDays(first, span));
    const seriesId = newId('ser');
    dates.forEach((d) => s.trainings.push({
      id: newId('tr'), date: d, time, type: 'Ryhmätreeni', durationMinutes: durationMinutes || null,
      studentId: null, groupId, coachId: coachId || COACH, seriesId, absences: [],
    }));
    return seriesId;
  };
  window.koutsiCreateGroup = ({ coachId, name, level, day, time, durationMinutes, memberIds, weeksAhead }) => {
    const s = load();
    const id = newId('g');
    const duration = durationMinutes || 60;
    s.groups.push({
      id, coachId: coachId || COACH, name, level, day, time, durationMinutes: duration,
      memberIds: memberIds || [], slots: [], themes: [], theme: null, upcomingThemes: [], annualPlan: null,
    });
    demoGenerateGroupTrainings(s, id, coachId, day, time, duration, window.koutsiTodayStr(), weeksAhead);
    save();
    return done(id);
  };
  window.koutsiAddGroupSlot = ({ groupId, coachId, day, time, durationMinutes, weeksAhead }) => {
    const s = load();
    const group = s.groups.find((g) => g.id === groupId);
    if (!group) return done();
    const duration = window.koutsiRoundToQuarterHourMinutes(durationMinutes || 60);
    const roundedTime = window.koutsiRoundTimeToQuarterHour(time);
    const slotId = newId('slot');
    const seriesId = demoGenerateGroupTrainings(s, groupId, coachId || group.coachId, day, roundedTime, duration, window.koutsiTodayStr(), weeksAhead);
    (group.slots ||= []).push({ id: slotId, day, time: roundedTime, durationMinutes: duration, seriesId });
    save();
    return done(slotId);
  };
  window.koutsiDeleteGroupSlot = (slotId) => {
    const s = load();
    let seriesId = null;
    s.groups.forEach((g) => {
      const hit = (g.slots || []).find((slot) => slot.id === slotId);
      if (hit) seriesId = hit.seriesId;
      g.slots = (g.slots || []).filter((slot) => slot.id !== slotId);
    });
    if (seriesId) {
      const today = window.koutsiTodayStr();
      s.trainings = s.trainings.filter((t) => !(t.seriesId === seriesId && t.date >= today));
    }
    save();
    return done();
  };
  window.koutsiUpdateGroup = (groupId, patch) => {
    const s = load();
    const existing = s.groups.find((g) => g.id === groupId);
    const duration = patch.durationMinutes || (existing && existing.durationMinutes) || 60;
    const scheduleChanged = existing && (existing.day !== patch.day || existing.time !== patch.time || (existing.durationMinutes || 60) !== duration);
    s.groups = s.groups.map((g) => (g.id === groupId ? Object.assign({}, g, patch, { durationMinutes: duration }) : g));
    if (scheduleChanged) {
      const today = window.koutsiTodayStr();
      s.trainings = s.trainings.filter((t) => !(t.groupId === groupId && t.date >= today));
      demoGenerateGroupTrainings(s, groupId, existing.coachId, patch.day, patch.time, duration, today, patch.weeksAhead);
    }
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
  window.koutsiSetExerciseVideo = ({ exerciseId, title, file, externalUrl, onProgress }) => {
    const exercise = load().exercises.find((e) => e.id === exerciseId);
    if (exercise) {
      if (file && onProgress) onProgress(100);
      exercise.video = {
        title,
        storagePath: file ? URL.createObjectURL(file) : null,
        externalUrl: externalUrl || null,
        mimeType: file ? file.type : null,
        sizeBytes: file ? file.size : null,
      };
      save();
    }
    return done();
  };
  window.koutsiRemoveExerciseVideo = (exerciseId) => {
    const exercise = load().exercises.find((e) => e.id === exerciseId);
    if (exercise) { exercise.video = null; save(); }
    return done();
  };
  // Sama harjoitepankki jonka oikea palvelu lisää koutsi_seed_exercises-RPC:llä,
  // jotta demossa napin painaminen tuottaa saman tuloksen kuin tuotannossa.
  const KOUTSI_DEMO_EXERCISE_TEMPLATES = [
    {"name": "Pallonkuljetus mailalla", "goal": "Herätellään pallotuntuma ja kevyt liike ennen varsinaista treeniä. Pallo pysyy mailan päällä kävellen, sitten hölkäten.", "players": "1", "playerCount": 1, "duration": "5 min", "level": "Kaikki tasot", "tags": ["lammittely"]},
    {"name": "Minitennis ristiin", "goal": "Pehmeä aloitus: pelataan syöttöruutujen sisällä ristiin. Katse palloon, lyhyet liikkeet, korkea osumapiste.", "players": "2", "playerCount": 2, "duration": "10 min", "level": "Kaikki tasot", "tags": ["lammittely", "tekniikka"]},
    {"name": "Sivuttaisliike ja kosketus", "goal": "Sivuaskeleet päätyviivalla, kosketus kartioon kummassakin päässä. Rakentaa liikkumisen perusasennon.", "players": "1", "playerCount": 1, "duration": "8 min", "level": "Kaikki tasot", "tags": ["lammittely", "liikkuminen"]},
    {"name": "Split step -ajoitus", "goal": "Valmentaja syöttää, pelaaja tekee splitin juuri ennen vastustajan osumaa. Ajoitus ennen nopeutta.", "players": "1", "playerCount": 1, "duration": "10 min", "level": "Kaikki tasot", "tags": ["liikkuminen", "tekniikka"]},
    {"name": "Kahdeksikko kartioiden ympäri", "goal": "Nopeat jalat ja suunnanmuutokset ilman palloa. 4 x 30 s, välissä 30 s palautus.", "players": "1", "playerCount": 1, "duration": "10 min", "level": "Keskitaso", "tags": ["liikkuminen"]},
    {"name": "Kämmen ristiin 10 palloa", "goal": "Kymmenen peräkkäistä kämmentä ristiin verkon yli. Tavoite on rytmi ja varmuus, ei vauhti.", "players": "2", "playerCount": 2, "duration": "12 min", "level": "Aloittelija", "tags": ["tekniikka"]},
    {"name": "Rysty ristiin 10 palloa", "goal": "Sama kuin kämmenversio rystypuolelle. Vartalon kierto mukaan, lyönti loppuu korkealle.", "players": "2", "playerCount": 2, "duration": "12 min", "level": "Aloittelija", "tags": ["tekniikka"]},
    {"name": "Kämmen–rysty vuorottelu", "goal": "Valmentaja syöttää vuorotellen puolille. Pelaajan pitää palata keskelle joka lyönnin jälkeen.", "players": "2", "playerCount": 2, "duration": "12 min", "level": "Keskitaso", "tags": ["tekniikka", "liikkuminen"]},
    {"name": "Suora vs. risto -päätös", "goal": "Valmentaja huutaa \"suora\" tai \"risto\" pallon lähdettyä. Pakottaa katseen ylös ja päätöksen myöhään.", "players": "2", "playerCount": 2, "duration": "15 min", "level": "Edistynyt", "tags": ["tekniikka", "pistepeli"]},
    {"name": "Syvyyspeli — kolmen metrin vyöhyke", "goal": "Piste vain, jos pallo putoaa päätyviivan takaosaan merkittyyn vyöhykkeeseen. Opettaa turvamarginaalin.", "players": "2", "playerCount": 2, "duration": "15 min", "level": "Keskitaso", "tags": ["tekniikka", "pistepeli"]},
    {"name": "Ensimmäinen syöttö — 20 palloa", "goal": "Kaksikymmentä ykkössyöttöä, tavoitteena vähintään 12 sisään. Kirjataan prosentti joka kerta.", "players": "1", "playerCount": 1, "duration": "12 min", "level": "Kaikki tasot", "tags": ["syotto"]},
    {"name": "Kakkossyöttö + suunta", "goal": "Kymmenen kakkossyöttöä ulos, kymmenen keskelle. Kierre ja korkeus verkon yli tärkeämpi kuin vauhti.", "players": "1", "playerCount": 1, "duration": "12 min", "level": "Keskitaso", "tags": ["syotto", "tekniikka"]},
    {"name": "Syöttö kohdealueisiin", "goal": "Kartiot syöttöruudun kolmeen kohtaan. Valmentaja määrää kohteen ennen jokaista syöttöä.", "players": "1", "playerCount": 1, "duration": "15 min", "level": "Edistynyt", "tags": ["syotto"]},
    {"name": "Syöttö + ensimmäinen lyönti", "goal": "Syöttö ja heti sen jälkeen ensimmäinen kämmen keskeltä. Yhdistää syötön muuhun peliin.", "players": "2", "playerCount": 2, "duration": "15 min", "level": "Keskitaso", "tags": ["syotto", "pistepeli"]},
    {"name": "Palautus jalkojen kanssa", "goal": "Lyhyt heilautus, aikainen split. Ykkössyötön palautus vain kentälle, kakkossyötön palautus hyökkäävästi.", "players": "2", "playerCount": 2, "duration": "15 min", "level": "Keskitaso", "tags": ["syotto", "tekniikka"]},
    {"name": "Lentolyönti läheltä verkkoa", "goal": "Pehmeät lentolyönnit vuorotellen kämmen ja rysty. Maila edessä, ei heilautusta.", "players": "2", "playerCount": 2, "duration": "10 min", "level": "Aloittelija", "tags": ["verkkopeli", "tekniikka"]},
    {"name": "Lähestymislyönti ja verkkoon", "goal": "Lyhyt pallo, hyökkäävä lähestymislyönti suoraan, sitten lentolyönti pisteeseen.", "players": "2", "playerCount": 2, "duration": "15 min", "level": "Keskitaso", "tags": ["verkkopeli", "pistepeli"]},
    {"name": "Verkkorefleksit", "goal": "Molemmat pelaajat syöttöviivalla, nopeita lyhyitä lentolyöntejä. Kehittää reaktion ja mailan otteen.", "players": "2", "playerCount": 2, "duration": "8 min", "level": "Edistynyt", "tags": ["verkkopeli", "liikkuminen"]},
    {"name": "Ylälyönti paikaltaan", "goal": "Valmentaja syöttää korkean pallon, pelaaja ottaa ylälyönnin. Osoita vapaalla kädellä palloa.", "players": "2", "playerCount": 2, "duration": "10 min", "level": "Keskitaso", "tags": ["verkkopeli", "tekniikka"]},
    {"name": "Pistepeli 7 pisteeseen", "goal": "Lyhyt kilpailu, jokainen piste aloitetaan syötöstä. Voittaja jää, häviäjä vaihtaa.", "players": "2+", "playerCount": 2, "duration": "15 min", "level": "Kaikki tasot", "tags": ["pistepeli"]},
    {"name": "Tie-break -harjoitus", "goal": "Pelataan pelkkiä tie-breakeja. Totuttaa paineeseen ja syöttövuorojen vaihtumiseen.", "players": "2", "playerCount": 2, "duration": "20 min", "level": "Edistynyt", "tags": ["pistepeli", "syotto"]},
    {"name": "Piste alkaa 0–30", "goal": "Jokainen peli aloitetaan 0–30 tilanteesta. Opettaa pelaamaan takaa-ajoasemasta.", "players": "2", "playerCount": 2, "duration": "20 min", "level": "Edistynyt", "tags": ["pistepeli"]},
    {"name": "Kuningaskenttä", "goal": "Ryhmä kiertää kentän puolilla, voittaja siirtyy ylöspäin. Pitää tempon ja motivaation korkealla.", "players": "4+", "playerCount": 4, "duration": "20 min", "level": "Kaikki tasot", "tags": ["pistepeli", "liikkuminen"]},
    {"name": "Nelinpeliasemat", "goal": "Käydään läpi syöttöparin ja palautusparin perusasemat, sitten pelataan pisteitä niistä.", "players": "4", "playerCount": 4, "duration": "20 min", "level": "Keskitaso", "tags": ["pistepeli", "verkkopeli"]},
    {"name": "Jäähdyttely ja venyttely", "goal": "Kevyt hölkkä ja päälihasryhmien venytykset. Sulkee treenin ja tukee palautumista.", "players": "1", "playerCount": 1, "duration": "8 min", "level": "Kaikki tasot", "tags": ["lammittely"]}
  ];
  window.koutsiSeedExercises = () => {
    const s = load();
    const have = new Set(s.exercises.map((e) => e.name));
    const added = KOUTSI_DEMO_EXERCISE_TEMPLATES.filter((t) => !have.has(t.name));
    added.forEach((t) => s.exercises.push(Object.assign({ id: newId('e'), coachId: COACH }, t)));
    save();
    return done(added.length);
  };

  // ── club events ───────────────────────────────────────────────────────────
  window.koutsiAddClubEvent = ({ date, endDate, title, kind }) => {
    load().clubEvents.push({ id: newId('ce'), date, endDate: endDate || null, title, kind });
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
  // Nimellä lisätty pelaaja: demossa hän ilmestyy heti luetteloon.
  window.koutsiCreatePlayer = (name, age, level) => {
    if (age != null && (!Number.isInteger(age) || age < 1 || age >= 120)) return Promise.reject(new Error('Jos annat pelaajan iän, sen pitää olla 1–119 vuotta.'));
    const id = newId('demo-student');
    load().students.push(student(id, name, age || null, level || null, { isPlaceholder: true }));
    save();
    return done(id);
  };
  window.koutsiBulkSetup = ({ groups = [], players = [], themes = [], weeksAhead } = {}) => {
    if (players.some((player) => player.age != null && (!Number.isInteger(player.age) || player.age < 1 || player.age >= 120))) return Promise.reject(new Error('Jos annat pelaajan iän, sen pitää olla 1–119 vuotta.'));
    const s = load();
    const groupIds = {};
    let groupsCreated = 0;
    let groupsReused = 0;

    groups.forEach((row) => {
      let group = row.existing_id ? s.groups.find((g) => g.id === row.existing_id) : null;
      if (row.existing_id && !group) throw new Error('Ryhmää ei löytynyt');
      if (!group) {
        const duration = row.duration_minutes || 60;
        group = {
          id: newId('g'), coachId: COACH, name: row.name, level: row.level || 'Kaikki tasot',
          day: row.day || 'Ma', time: row.time, durationMinutes: duration, memberIds: [], slots: [], themes: [], theme: null,
          upcomingThemes: [], annualPlan: null,
        };
        s.groups.push(group);
        demoGenerateGroupTrainings(s, group.id, COACH, group.day, group.time, duration, window.koutsiTodayStr(), weeksAhead);
        groupsCreated += 1;
      } else groupsReused += 1;
      groupIds[row.client_id] = group.id;
    });

    const created = players.map((row) => {
      const id = newId('demo-student');
      s.students.push(student(id, row.name, row.age || null, row.level || null, { isPlaceholder: true }));
      (row.group_refs || []).forEach((ref) => {
        const group = s.groups.find((g) => g.id === groupIds[ref]);
        if (!group) throw new Error('Pelaajalle valittua ryhmää ei löytynyt');
        if (!group.memberIds.includes(id)) group.memberIds.push(id);
      });
      return { id, name: row.name };
    });

    themes.forEach((row) => {
      const group = s.groups.find((g) => g.id === groupIds[row.group_ref]);
      if (!group) throw new Error('Viikkoteeman ryhmää ei löytynyt');
      const hit = group.themes.find((t) => t.year === row.year && t.week === row.week);
      if (hit) { hit.title = row.title; hit.lead = row.lead || ''; }
      else group.themes.push({ id: newId('t'), year: row.year, week: row.week, title: row.title, lead: row.lead || '' });
      refreshThemes(group);
    });
    save();
    return done({
      players_created: created.length, groups_created: groupsCreated,
      groups_reused: groupsReused, themes_saved: themes.length, players: created,
      group_ids: groupIds,
    });
  };
  // Henkilökohtainen linkki sisältää paikanvaraajan satunnaisen tunnisteen, joten
  // yhteisen koodin haltijalle ei tarvitse näyttää muiden pelaajien nimilistaa.
  window.koutsiClaimPlayer = (code, studentId) => {
    const s = load();
    const ph = s.students.find((x) => x.id === studentId && x.isPlaceholder);
    if (!ph) throw new Error('Tätä profiilia ei voi lunastaa');
    // Demossa lunastaja ON tämä selain, joten paikanvaraaja muuttuu
    // suoraan lunastetuksi pelaajaksi — data on jo hänen.
    delete ph.isPlaceholder;
    s.groups.forEach((g) => {
      if (!g.memberIds.includes(ph.id)) g.memberIds.push(ph.id);
    });
    save();
    return done({ coach_id: COACH, coach_name: s.coach.name, claimed: true });
  };
  window.koutsiRedeemInviteCode = () => done({ coach_id: COACH, coach_name: 'Anna Koskinen', group_id: GROUP, group_name: 'Aikuiset A' });
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
  // Oikea backend tallentaa polun julkiseen ämpäriin; demossa kuva menee data-URL:na
  // samaan localStorage-tilaan, jotta se säilyy myös sivun uudelleenlatauksen yli.
  window.koutsiUploadAvatar = (uid, file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Kuvaa ei voitu lukea.'));
    reader.onload = () => {
      const url = String(reader.result || '');
      const s = load();
      if (uid === COACH) s.coach.avatarUrl = url;
      s.coaches.forEach((c) => { if (c.id === uid) c.avatarUrl = url; });
      const st = findStudent(uid);
      if (st) st.avatarUrl = url;
      try { save(); } catch { /* kuva voi ylittää kiintiön — jää tämän istunnon ajaksi */ }
      resolve(url);
    };
    reader.readAsDataURL(file);
  });
  window.koutsiSaveStudentProfile = (studentId, patch) => {
    const st = findStudent(studentId);
    if (st) {
      if (patch.profileAge !== undefined) {
        const labels = { alle20: 'Alle 20', '20-30': '20–30', '30-40': '30–40', '40-50': '40–50', '50-60': '50–60', '60+': '60+' };
        const value = patch.profileAge || '';
        const exact = /^\d{2,3}$/.test(value) ? Number(value) : null;
        st.age = exact;
        st.ageRange = labels[value] ? value : null;
        st.ageValue = value;
        st.ageLabel = exact == null ? (labels[value] || '') : `${exact} v`;
      } else if (patch.age !== undefined) {
        st.age = patch.age;
        st.ageRange = null;
        st.ageValue = patch.age == null ? '' : String(patch.age);
        st.ageLabel = patch.age == null ? '' : `${patch.age} v`;
      }
      save();
    }
    return done();
  };
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

  // ── ylläpito ──────────────────────────────────────────────────────────────
  // Demokäyttäjä ei ole ylläpitäjä, joten paneeli ei näy eikä sen hakuja ajeta.
  window.koutsiIsAdmin = () => done(false);
  window.koutsiAdminCoaches = () => done([]);
  window.koutsiAdminUsers = () => done([]);
  window.koutsiAdminDeleteUser = () => Promise.reject(new Error('not allowed'));
  window.koutsiAdminActAs = () => Promise.reject(new Error('not allowed'));
  window.koutsiAdminGroups = () => done([]);
  window.koutsiAdminBulkInviteCodes = () => done([]);
  window.koutsiAdminUploadAnnualPlan = () => done();
  window.koutsiUploadSharedAnnualPlan = (coachId, file) => {
    const s = load();
    const submission = {
      id: newId('annual-plan'), coachId, filename: file.name,
      storagePath: URL.createObjectURL(file), sizeBytes: file.size,
      status: 'pending', uploadedAt: new Date().toISOString(), handledAt: null,
    };
    (s.annualPlanSubmissions ||= []).unshift(submission);
    save();
    return done(clone(submission));
  };
  window.koutsiAnnualPlanSubmissions = (coachId = null, pendingOnly = false) => {
    const rows = (load().annualPlanSubmissions || []).filter((submission) =>
      (!coachId || submission.coachId === coachId)
      && (!pendingOnly || submission.status === 'pending'));
    return done(clone(rows));
  };
  window.koutsiAdminHandleAnnualPlanSubmission = (submissionId) => {
    const submission = (load().annualPlanSubmissions || []).find((item) => item.id === submissionId);
    if (!submission || submission.status !== 'pending') return Promise.reject(new Error('Vuosisuunnitelmaa ei löytynyt tai se on jo käsitelty.'));
    submission.status = 'handled';
    submission.handledAt = new Date().toISOString();
    save();
    return done();
  };

  // ── "Luo tili" -kehote ────────────────────────────────────────────────────
  // Demo on myyntityökalu, joten siitä pitää päästä yhdellä klikkauksella
  // oikeaan palveluun. Kehote elää täällä eikä app-tiedostoissa, jotta
  // tuotantosovellus pysyy täysin tietämättömänä demosta.
  const SIGNUP_URL = window.KOUTSI_DEMO_ROLE === 'player'
    ? 'https://koutsi.krossi.app/pelaaja'
    : 'https://koutsi.krossi.app/valmentaja';

  const CTA_DISMISS_KEY = 'koutsi_demo_cta_dismissed';

  function mountDemoCta() {
    if (document.getElementById('koutsi-demo-cta')) return;
    try { if (sessionStorage.getItem(CTA_DISMISS_KEY)) return; } catch { /* private mode */ }

    const bar = document.createElement('div');
    bar.id = 'koutsi-demo-cta';
    bar.setAttribute('style', [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:150',
      'display:flex', 'align-items:center', 'gap:10px',
      'background:#0E3B2C', 'color:#fff', 'border-radius:16px',
      'padding:12px 12px 12px 16px', 'font-family:inherit',
      'box-shadow:0 18px 40px -18px rgba(0,0,0,0.55)',
      'max-width:min(360px, calc(100vw - 36px))',
    ].join(';'));
    bar.innerHTML =
      '<div style="font-size:12.5px;line-height:1.45;flex:1;min-width:0;">' +
        '<strong style="display:block;font-size:13px;margin-bottom:2px;">Kokeilet demoa</strong>' +
        '<span style="opacity:.82;">Tiedot ovat kuvitteellisia ja tallentuvat vain tähän selaimeen.</span>' +
      '</div>' +
      '<a href="' + SIGNUP_URL + '" style="flex-shrink:0;background:var(--lime,#CFE414);color:#101a08;' +
        'font-weight:800;font-size:13px;text-decoration:none;padding:10px 14px;border-radius:11px;white-space:nowrap;">' +
        'Luo tili</a>' +
      '<button type="button" aria-label="Sulje" style="flex-shrink:0;background:none;border:none;color:#fff;' +
        'opacity:.6;font-size:18px;line-height:1;cursor:pointer;padding:4px 2px;font-family:inherit;">&times;</button>';

    bar.querySelector('button').onclick = () => {
      try { sessionStorage.setItem(CTA_DISMISS_KEY, '1'); } catch { /* private mode */ }
      bar.remove();
    };
    document.body.appendChild(bar);

    // Mobiilissa sovelluksella on kiinteä alanavigaatio. Nostetaan kehote sen
    // yläpuolelle korkeus mitaten, jotta navi ei jää sen alle — kovakoodattu
    // arvo vanhenisi heti kun navin korkeus muuttuu.
    const lift = () => {
      const nav = document.querySelector('.kv-mobile-bottomnav');
      const visible = nav && getComputedStyle(nav).display !== 'none' && nav.getBoundingClientRect().height > 0;
      bar.style.bottom = visible ? `${Math.round(nav.getBoundingClientRect().height) + 12}px` : '18px';
    };
    lift();
    window.addEventListener('resize', lift);
    // navi ilmestyy vasta kun React on renderöinyt
    setTimeout(lift, 300);
    setTimeout(lift, 1200);
  }
  if (document.body) mountDemoCta();
  else document.addEventListener('DOMContentLoaded', mountDemoCta);

  // Exposed so a "Aloita demo alusta" control can call it.
  window.koutsiDemoReset = () => { reset(); window.location.reload(); };
})();
