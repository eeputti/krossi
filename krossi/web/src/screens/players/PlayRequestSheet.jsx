// PlayRequestSheet — "Pyydä pelaamaan": a prefilled message + quick suggestions, sent with
// api.players.sendPlayRequest. Shows a little success moment, then closes itself.
//   <PlayRequestSheet open onClose={fn} player={Profile} onSent={fn} />
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { firstName } from '../../lib/format.js';
import { Avatar, Button, Icon, Sheet, Textarea, useToast } from '../../ui/index.js';

const SUGGESTIONS = [
  'Lähtisitkö pelaamaan tällä viikolla?',
  'Pallottelua viikonloppuna?',
  'Matsi arki-iltana?',
];
const MAX = 400;

export function PlayRequestSheet({ open, onClose, player, onSent }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const first = firstName(player?.name);
  const withGreeting = (s) => `Moi ${first}! ${s}`;
  const [text, setText] = useState(() => withGreeting(SUGGESTIONS[0]));
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (open) { setText(withGreeting(SUGGESTIONS[0])); setDone(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, player?.id]);

  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => onClose?.(), 1700);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const send = () => run(async () => {
    try {
      await api.players.sendPlayRequest(player.id, text.trim());
      setDone(true);
      onSent?.();
      toast('Pelipyyntö lähetetty!', { icon: 'send' });
    } catch (err) {
      if (err?.code === 'duplicate') {
        toast(`Teillä on jo avoin pelipyyntö — katso Viestit tai odota, että ${first} vastaa.`, { tone: 'info', duration: 4200 });
        onSent?.();
        onClose?.();
      } else {
        toast(err);
      }
    }
  });

  const trimmed = text.trim();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={done ? undefined : 'Pyydä pelaamaan'}
      subtitle={done ? undefined : `${first} saa pyynnön viesteihinsä.`}
      footer={done ? undefined : (
        <Button variant="lime" size="lg" block icon="send" loading={busy} disabled={!trimmed} onClick={send}>
          Lähetä pyyntö
        </Button>
      )}
    >
      {done ? (
        <div className="players-sent" role="status">
          <span className="players-sent-badge pop"><Icon name="check" size={34} strokeWidth={3} /></span>
          <h3 className="players-sent-title">Pyyntö lähetetty!</h3>
          <p className="players-sent-text">Saat ilmoituksen, kun {first} vastaa. Keskustelu aukeaa Viesteihin.</p>
        </div>
      ) : (
        <div className="players-request">
          <div className="players-request-to">
            <Avatar person={player} size={40} />
            <span className="players-request-to-text">
              <span className="players-request-to-label">Vastaanottaja</span>
              <span className="players-request-to-name truncate">{player?.name}</span>
            </span>
          </div>
          <div className="players-request-suggestions" role="group" aria-label="Valmiit ehdotukset">
            {SUGGESTIONS.map((s) => {
              const on = text === withGreeting(s);
              return (
                <button key={s} type="button" className={`players-suggestion${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setText(withGreeting(s))}>
                  {s}
                </button>
              );
            })}
          </div>
          <label className="sr-only" htmlFor="players-request-text">Viesti</label>
          <Textarea id="players-request-text" rows={4} maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)} placeholder="Kirjoita lyhyt viesti…" />
          <div className="players-request-count t-num">{text.length}/{MAX}</div>
        </div>
      )}
    </Sheet>
  );
}
