// KeyWelcome — the surprise when a valmentaja-avain gives more than the default 3-month trial:
// "Sait 12 kk ilmaisen kokeilun!" with confetti. Used on the sign-up page (in the gate card) and in
// Profiili → Tilaus (in the key sheet). Nothing hints at it beforehand: the coach sees the 3-month
// trial, asks the owner, gets a key by e-mail, and is pleasantly surprised.
import { useEffect } from 'react';
import { Button, Illustration, confetti } from '../ui/index.js';

export function KeyWelcome({ welcome, onDone, doneLabel = 'Aloitetaan' }) {
  useEffect(() => {
    const t = setTimeout(() => confetti({ count: 140, spread: 1.2 }), 120);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="stack-4 key-welcome rise">
      <Illustration name="celebrate" size={140} />
      <h1 className="k-gate-title">{welcome.title}</h1>
      {welcome.text && <p className="k-gate-lead">{welcome.text}</p>}
      <Button variant="dark" size="lg" block onClick={onDone} className="k-gate-cta">{doneLabel}</Button>
    </div>
  );
}
