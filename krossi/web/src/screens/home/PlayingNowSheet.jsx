// PlayingNowSheet — "⚡ Pelaan nyt": tell nearby players you're ready to play right now.
//   <PlayingNowSheet open onClose={fn} />
// Picks a duration (1/2/3 h) and an optional note, calls api.profile.startPlayingNow and
// updates the session profile so the hero switches to "Pelaat nyt klo X asti" immediately.
import { useEffect, useId, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { useSession } from '../../app/session.jsx';
import { formatTime } from '../../lib/format.js';
import { Button, ChipSelect, Field, Icon, Sheet, Textarea, useToast } from '../../ui/index.js';
import { cityIn } from '../players/playerInfo.js';

const DURATIONS = [
  { value: '60', label: '1 tunti' },
  { value: '120', label: '2 tuntia' },
  { value: '180', label: '3 tuntia' },
];
const NOTE_MAX = 200;
const MIN_MS = 60_000;

export function PlayingNowSheet({ open, onClose }) {
  const { profile, setProfile, refreshProfile } = useSession();
  const toast = useToast();
  const [minutes, setMinutes] = useState('120');
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  const noteId = useId();
  const city = profile?.city || '';

  useEffect(() => {
    if (open) { setMinutes('120'); setNote(''); }
  }, [open]);

  const until = new Date(Date.now() + Number(minutes) * MIN_MS).toISOString();

  const submit = () => run(async () => {
    const cleanNote = note.trim() || null;
    try {
      const res = await api.profile.startPlayingNow({ minutes: Number(minutes), note: cleanNote });
      setProfile((p) => (p ? { ...p, playingNowUntil: until, playingNowNote: cleanNote } : p));
      refreshProfile();
      const sent = Number(res?.sent) || 0;
      toast(sent > 0 ? `Kerrottu ${sent} pelaajalle lähistöllä` : 'Pelaat nyt — näyt muille salamamerkillä', { icon: 'bolt' });
      if (res?.warning) toast(res.warning, { tone: 'info' });
      onClose?.();
    } catch (err) {
      toast(err);
    }
  });

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      size="sm"
      title="Pelaan nyt"
      subtitle={city
        ? `Kerromme ${cityIn(city)} pelaaville, että olet valmis peliin heti.`
        : 'Kerromme lähistön pelaajille, että olet valmis peliin heti.'}
      footer={(
        <Button variant="lime" size="lg" block icon="bolt" loading={busy} onClick={submit}>
          {busy ? 'Ilmoitetaan…' : 'Ilmoita pelaajille'}
        </Button>
      )}
    >
      <div className="home-pn">
        <div className="home-pn-preview" aria-live="polite">
          <span className="home-pn-bolt"><Icon name="bolt" size={20} strokeWidth={2.4} /></span>
          <span className="home-pn-preview-text">
            <span className="home-pn-preview-title">Näyt pelaavana klo <span className="t-num">{formatTime(until)}</span> asti</span>
            <span className="home-pn-preview-sub">Pelaajalistassa ja profiilissasi näkyy salamamerkki.</span>
          </span>
        </div>

        <Field label="Kuinka pitkään?">
          <ChipSelect options={DURATIONS} value={minutes} onChange={(v) => v && setMinutes(v)} layout="grid" columns={3} size="lg" ariaLabel="Kesto" />
        </Field>

        <Field label="Viesti muille" optional htmlFor={noteId} hint={`${note.length}/${NOTE_MAX}`}>
          <Textarea
            id={noteId}
            rows={2}
            value={note}
            maxLength={NOTE_MAX}
            placeholder="Esim. Kenttä varattu klo 18, tule mukaan!"
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
          />
        </Field>
      </div>
    </Sheet>
  );
}
