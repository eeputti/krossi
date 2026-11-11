// Shared help for the sheets where a coach hands out join codes (Liittymiskoodini, Kutsu ryhmään):
// "Näin se toimii" as numbered steps, and the note that minors are added by the coach on Pelaajat
// and get a personal link each (Kutsu pelaajat, Henkilökohtaiset). Styles: .jc-* in styles/season.css.
import { Button } from '../ui/index.js';
import { openInvites } from './nav.js';

export function HowSteps({ items }) {
  return (
    <div className="jc-how">
      <div className="jc-how-title">Näin se toimii</div>
      <ol className="jc-steps">{items.map((s, i) => <li key={i}><span>{s}</span></li>)}</ol>
    </div>
  );
}

/**
 * onClose closes the sheet first, so Kutsu pelaajat opens on top of the page, not of the sheet.
 * Inside Kutsu pelaajat, onPersonal switches to its Henkilökohtaiset side instead.
 */
export function MinorsNote({ onClose, onPersonal = null }) {
  return (
    <div className="jc-minor">
      <div className="jc-minor-text">
        <strong>Alaikäiset</strong>
        <span>Suosittelemme, että lisäät heidät itse Pelaajat-välilehdellä. Sieltä lähetät jokaiselle oman henkilökohtaisen linkin.</span>
      </div>
      {onPersonal
        ? <Button variant="outline" size="sm" icon="send" onClick={onPersonal}>Henkilökohtaiset linkit</Button>
        : <Button variant="outline" size="sm" icon="send" onClick={() => { onClose(); openInvites('henk'); }}>Kutsu pelaajat</Button>}
    </div>
  );
}
