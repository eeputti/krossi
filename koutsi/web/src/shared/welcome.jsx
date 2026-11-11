// welcome.jsx — the "where to send feedback" row at the foot of both apps' first-visit WelcomeSheet.
import { Icon } from '../ui/index.js';

/** `place` names where Anna palautetta sits on this device, e.g. "sivupalkin alaosassa". */
export function WelcomeHelp({ place }) {
  return (
    <p className="k-welcome-help">
      <Icon name="chat" size={18} />
      <span>Jokin epäselvää tai rikki? Kerro siitä kohdassa <strong>Anna palautetta</strong>, {place}.</span>
    </p>
  );
}
