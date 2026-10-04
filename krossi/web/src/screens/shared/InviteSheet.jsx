// InviteSheet — SHARED component. Owner: auth agent (wave 2). Other screens import it with exactly this interface:
//   <InviteSheet open onClose={fn} />  — shows my invite link (api.invites.myCode → appUrl('/pelaa/kutsu/'+code)), share/copy buttons, how many joined
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { appUrl } from '../../app/router.js';
import { BADGES } from '../../features/gamification.js';
import { BadgeMedal, Button, ErrorState, Icon, Illustration, ProgressBar, Sheet, Skeleton, copyText, useShare, useToast } from '../../ui/index.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const SHARE_TEXT = 'Pelataan tennistä! Liity Krossiin:';
const FIRST = BADGES.find((b) => b.id === 'invite-1');
const AMBASSADOR = BADGES.find((b) => b.id === 'invite-5');

function WhatsAppMark({ size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
      <path fill="#fff" d="M17.3 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.6.1l-.9 1.1c-.2.2-.3.2-.6.1a7.6 7.6 0 0 1-3.8-3.3c-.3-.5.3-.5.8-1.6.1-.2 0-.3 0-.5l-.9-2.1c-.2-.5-.5-.5-.6-.5h-.6a1 1 0 0 0-.8.4 3.2 3.2 0 0 0-1 2.4 5.6 5.6 0 0 0 1.2 3c.1.2 2 3 4.8 4.2 1.8.8 2.5.8 3.4.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3Z" />
    </svg>
  );
}

function badgeState(joined) {
  if (joined == null) {
    return { badge: { ...FIRST, earned: false, progress: 0 }, title: 'Kutsuja-merkki', text: 'Saat merkin, kun ensimmäinen kaverisi liittyy kutsullasi.', progress: null };
  }
  if (joined < FIRST.target) {
    return { badge: { ...FIRST, earned: false, progress: 0 }, title: 'Kutsuja-merkki', text: 'Saat merkin, kun ensimmäinen kaverisi liittyy kutsullasi.', progress: null };
  }
  if (joined < AMBASSADOR.target) {
    return {
      badge: { ...AMBASSADOR, earned: false, progress: joined / AMBASSADOR.target },
      title: `${joined} ${joined === 1 ? 'kaveri' : 'kaveria'} liittynyt 🎉`,
      text: `Kutsuja-merkki on sinun! ${AMBASSADOR.name}-merkki aukeaa, kun ${AMBASSADOR.target} kaveria on mukana.`,
      progress: joined / AMBASSADOR.target,
    };
  }
  return {
    badge: { ...AMBASSADOR, earned: true, progress: 1 },
    title: `${joined} kaveria liittynyt 🏆`,
    text: `Olet Krossin ${AMBASSADOR.name.toLowerCase()}. Kiitos, että kasvatat tennisporukkaa!`,
    progress: null,
  };
}

export function InviteSheet({ open, onClose }) {
  const shareLink = useShare();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(null);
  const code = useAsync(() => (open ? api.invites.myCode() : Promise.resolve(null)), [open]);
  const activity = useAsync(() => (open ? api.stats.myActivity() : Promise.resolve(null)), [open]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  useEffect(() => { if (!open) setCopied(false); }, [open]);

  const url = code.data ? appUrl(`/pelaa/kutsu/${encodeURIComponent(code.data)}`) : null;
  const shownUrl = url ? url.replace(/^https?:\/\//, '') : '';
  const waHref = url ? `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${url}`)}` : undefined;
  // Activity is only for the badge teaser: if it fails the teaser falls back to its generic copy.
  const joined = activity.error ? null : (activity.data?.invitesJoined ?? null);
  const teaser = badgeState(joined);

  const copy = async () => {
    if (!url) return;
    const ok = await copyText(url);
    if (!ok) { toast('Kopiointi ei onnistunut — paina linkkiä pitkään ja kopioi se.', { tone: 'error' }); return; }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2200);
  };

  const shareIt = () => {
    if (!url) return;
    shareLink({ title: 'Kutsu Krossiin', text: SHARE_TEXT, url });
  };

  return (
    <Sheet open={open} onClose={onClose} size="sm" className="auth-invite-sheet" labelledBy="invite-sheet-title">
      <div className="auth-invite-head">
        <Illustration name="players" size={156} className="auth-invite-art" />
        <h2 className="auth-invite-h" id="invite-sheet-title">Kutsu kaveri Krossiin</h2>
        <p className="auth-invite-lead">Tennis on kivempaa porukalla. Jaa oma linkkisi — kaveri pääsee suoraan mukaan peleihin.</p>
      </div>

      {code.loading ? (
        <div className="auth-invite-loading" aria-busy="true" aria-label="Ladataan kutsulinkkiä">
          <Skeleton h={56} r={16} />
          <Skeleton h={54} r={999} />
          <Skeleton h={54} r={999} />
        </div>
      ) : code.error || !url ? (
        <ErrorState compact title="Kutsulinkkiä ei saatu" error={code.error} onRetry={() => code.reload()} />
      ) : (
        <div className="auth-invite-body">
          <div className={cx('auth-invite-link', copied && 'is-copied')}>
            <span className="auth-invite-link-icon"><Icon name="link" size={17} /></span>
            <span className="auth-invite-url truncate" title={url}>{shownUrl}</span>
            <button type="button" className="auth-invite-copy" onClick={copy} aria-label={copied ? 'Linkki kopioitu' : 'Kopioi linkki'}>
              <Icon key={copied ? 'y' : 'n'} name={copied ? 'check' : 'copy'} size={15} strokeWidth={2.4} className={copied ? 'pop' : undefined} />
              {copied ? 'Kopioitu' : 'Kopioi'}
            </button>
          </div>
          <div className="auth-invite-actions">
            <Button variant="lime" size="lg" block icon="share" onClick={shareIt}>Jaa kutsulinkki</Button>
            <Button as="a" href={waHref} target="_blank" rel="noopener noreferrer" variant="outline" size="lg" block className="auth-invite-wa">
              <WhatsAppMark />
              Lähetä WhatsAppissa
            </Button>
          </div>
        </div>
      )}

      <div className="auth-invite-badge">
        <BadgeMedal badge={teaser.badge} size={56} />
        <div className="auth-invite-badge-text">
          <span className="auth-invite-badge-title">{teaser.title}</span>
          <span className="auth-invite-badge-sub">{teaser.text}</span>
          {teaser.progress != null && (
            <span className="auth-invite-badge-progress">
              <ProgressBar value={teaser.progress} tone="green" label="Kutsujen edistyminen" />
            </span>
          )}
        </div>
      </div>
    </Sheet>
  );
}
