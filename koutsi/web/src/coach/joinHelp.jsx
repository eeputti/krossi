// Shared help for the sheets where a coach hands out join codes (Liittymiskoodini, Kutsu pelaajat,
// Kutsu ryhmään): "Näin se toimii" as numbered steps, the note that minors are added by the coach
// and get an own code each (Pelaajille), and the big QR code the coach shows from the phone on
// court, which says first whom to show it to (a player by name, a group by name, or anyone) and
// where they land. Styles: .jc-* and .gl-qr* in styles/season.css.
import { Button, Sheet } from '../ui/index.js';
import { CopyButton, QrCode } from '../shared/bits.jsx';
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
 * Inside Liittymiskoodini / Kutsu pelaajat, onPersonal switches to its Pelaajille side instead.
 */
export function MinorsNote({ onClose, onPersonal = null }) {
  return (
    <div className="jc-minor">
      <div className="jc-minor-text">
        <strong>Alaikäiset</strong>
        <span>{onPersonal
          ? 'Suosittelemme, että lisäät heidät itse ja lähetät jokaiselle oman koodin kohdasta Pelaajille.'
          : 'Suosittelemme, että lisäät heidät itse Pelaajat-välilehdellä. Sieltä lähetät jokaiselle oman henkilökohtaisen linkin.'}</span>
      </div>
      {onPersonal
        ? <Button variant="outline" size="sm" icon="user" onClick={onPersonal}>Pelaajille</Button>
        : <Button variant="outline" size="sm" icon="send" onClick={() => { onClose(); openInvites('henk'); }}>Kutsu pelaajat</Button>}
    </div>
  );
}

/** The code big on the coach's screen. lead = whom to show it to and where they land; help = how. */
export function ShowQrSheet({ open, onClose, title, subtitle, lead, help, link, code, foot }) {
  if (!code || !link) return null;
  return (
    <Sheet open={open} onClose={onClose} size="md" title={title} subtitle={subtitle}>
      <div className="gl-qr">
        <p className="gl-qr-lead">{lead}</p>
        <QrCode text={link} size={260} />
        <p className="gl-qr-help">{help}</p>
        <div className="k-code">{code}</div>
        <p className="k-faint">{foot || 'Tai koutsi.krossi.app/pelaaja ja syötä koodi'}</p>
        <CopyButton text={link} label="Kopioi linkki" />
      </div>
    </Sheet>
  );
}
