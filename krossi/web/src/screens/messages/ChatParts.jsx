// ChatParts.jsx — building blocks of the chat: message groups and bubbles, system pills, the
// pinned game card, the composer and the loading skeleton.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Button, Chip, Icon, IconButton, Skeleton, useToast } from '../../ui/index.js';
import { firstName, formatGameTime, formatTime } from '../../lib/format.js';
import { GameDateTile } from '../shared/GameCard.jsx';
import { matchLabel, placeLine } from '../games/gameUtils.js';
import { bubblePosition, groupTime, isEmojiOnly, joinText, linkParts } from './chatUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const MAX_LEN = 1000;

function BubbleText({ text }) {
  return linkParts(text).map((part, i) => (part.url
    ? <a key={i} href={part.url} target="_blank" rel="noopener noreferrer" className="chat-link">{part.url.replace(/^https?:\/\/(www\.)?/, '')}</a>
    : <span key={i}>{part.text}</span>));
}

function Bubble({ m, pos, isNew, onImage, onImageLoad }) {
  const cls = cx('chat-bubble', `is-${pos}`, m.local && !m.failed && 'is-pending', m.failed && 'is-failed', isNew && 'is-new');
  if (m.kind === 'thumbs' || (m.kind === 'text' && isEmojiOnly(m.text))) {
    return <div className={cx(cls, 'chat-emoji', m.kind === 'thumbs' && 'is-thumbs')} role="img" aria-label={m.kind === 'thumbs' ? 'Peukku' : m.text}>{m.kind === 'thumbs' ? '👍' : m.text}</div>;
  }
  if (m.kind === 'image') {
    return (
      <button type="button" className={cx(cls, 'chat-image')} onClick={() => onImage(m)} aria-label="Avaa kuva">
        {m.imageUrl ? <img src={m.imageUrl} alt="" onLoad={onImageLoad} /> : <span className="chat-image-missing"><Icon name="image" size={22} /></span>}
      </button>
    );
  }
  return <div className={cls}><BubbleText text={m.text} /></div>;
}

/** Consecutive messages of one sender. Others' groups in group chats get a name + avatar. */
export function MessageGroup({ group, showSender, isNew, onImage, onImageLoad, onRetry, onDiscard, onSender }) {
  const last = group.messages[group.messages.length - 1];
  const count = group.messages.length;
  return (
    <div className={cx('chat-group', group.mine ? 'is-mine' : 'is-theirs', showSender && 'has-sender')}>
      {showSender && <div className="chat-sender">{firstName(group.sender?.name)}</div>}
      <div className="chat-group-body">
        {showSender && (
          <button type="button" className="chat-group-av" onClick={() => onSender(group.sender)} aria-label={`Avaa ${group.sender?.name || 'pelaajan'} profiili`}>
            <Avatar person={group.sender} size={28} />
          </button>
        )}
        <div className="chat-bubbles">
          {group.messages.map((m, i) => (
            <Bubble key={m.key || m.id} m={m} pos={bubblePosition(i, count)} isNew={isNew(m)} onImage={onImage} onImageLoad={onImageLoad} />
          ))}
        </div>
      </div>
      {last.failed ? (
        <div className="chat-failed" role="alert">
          <Icon name="alert" size={14} />
          <span>Ei lähtenyt.</span>
          <button type="button" className="chat-failed-btn" onClick={() => onRetry(last)}>Yritä uudelleen</button>
          <button type="button" className="chat-failed-btn is-quiet" onClick={() => onDiscard(last)}>Poista</button>
        </div>
      ) : (
        <div className="chat-meta t-num">{last.local ? 'Lähetetään…' : groupTime(group)}</div>
      )}
    </div>
  );
}

export function SystemPill({ message, meId, isNew }) {
  return (
    <div className={cx('chat-system', isNew && 'is-new')}>
      <span className="chat-system-pill">
        {joinText(message, meId)}
        <span className="chat-system-time t-num">{formatTime(message.createdAt)}</span>
      </span>
    </div>
  );
}

export function DaySeparator({ label }) {
  return <div className="chat-day" role="separator"><span>{label}</span></div>;
}

/** Pinned mini game card under the header of a game chat. */
export function PinnedGame({ state, onOpen }) {
  if (state.loading) {
    return (
      <div className="chat-game" aria-busy="true">
        <Skeleton w={44} h={48} r={10} />
        <span className="chat-game-text"><Skeleton w="46%" h={13} /><Skeleton w="72%" h={11} /></span>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="chat-game is-error">
        <span className="chat-game-text"><span className="chat-game-sub">Pelin tietoja ei saatu ladattua.</span></span>
        <Button variant="ghost" size="sm" icon="refresh" onClick={() => state.reload()}>Yritä uudelleen</Button>
      </div>
    );
  }
  const game = state.data;
  if (!game) return null;
  const cancelled = game.status === 'cancelled';
  return (
    <div className={cx('chat-game rise', cancelled && 'is-cancelled')}>
      <GameDateTile iso={game.scheduledAt} size="sm" />
      <span className="chat-game-text">
        <span className="chat-game-title">
          <span className="truncate">{formatGameTime(game.scheduledAt)}</span>
          {cancelled && <Chip tone="danger" size="sm">Peruttu</Chip>}
        </span>
        <span className="chat-game-sub truncate">{matchLabel(game.matchType)} · {placeLine(game)}</span>
      </span>
      <Button variant="dark" size="sm" iconRight="chevron-right" onClick={onOpen} className="chat-game-btn">Avaa peli</Button>
    </div>
  );
}

/** Placeholder bubbles while the thread loads. */
export function ChatSkeleton() {
  const rows = [['theirs', '58%', 38], ['theirs', '40%', 38], ['mine', '52%', 38], ['theirs', '66%', 56], ['mine', '34%', 38], ['mine', '48%', 38]];
  return (
    <div className="chat-skeleton" aria-busy="true" aria-label="Ladataan viestejä">
      {rows.map(([side, w, h], i) => (
        <div key={i} className={cx('chat-skeleton-row', `is-${side}`)}><Skeleton w={w} h={h} r={20} /></div>
      ))}
    </div>
  );
}

/**
 * Composer — auto-growing textarea, image picker with a preview chip, send (lime) when there is
 * something to send, otherwise a 👍. Enter sends on devices with a fine pointer (Shift+Enter = newline).
 *   onSend({ text, image: { file, url } | null }), onThumbs(), disabled
 */
export function Composer({ onSend, onThumbs, disabled, textareaRef }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [thumbKey, setThumbKey] = useState(0);
  const fileRef = useRef(null);
  const ta = textareaRef;
  const canSend = (text.trim().length > 0 || !!image) && !disabled;
  const unsent = useRef(null);
  unsent.current = image;
  useEffect(() => () => { if (unsent.current) URL.revokeObjectURL(unsent.current.url); }, []);

  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [text, ta]);

  const takeFile = (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('Valitse kuvatiedosto (JPG, PNG tai HEIC).', { tone: 'error' }); return; }
    if (image) URL.revokeObjectURL(image.url);
    setImage({ file, url: URL.createObjectURL(file) });
    ta.current?.focus();
  };
  const removeImage = () => {
    if (image) URL.revokeObjectURL(image.url);
    setImage(null);
    ta.current?.focus();
  };

  const submit = (e) => {
    e?.preventDefault();
    if (!canSend) return;
    if (text.length > MAX_LEN) { toast(`Viesti on liian pitkä (enintään ${MAX_LEN} merkkiä).`, { tone: 'error' }); return; }
    onSend({ text: text.trim(), image });
    setText('');
    setImage(null); // the URL now belongs to the pending bubble; ChatScreen revokes it on unmount
    ta.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    e.preventDefault();
    submit();
  };

  const onPaste = (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => /^image\//.test(f.type));
    if (file) { e.preventDefault(); takeFile(file); }
  };

  const thumbs = () => {
    if (disabled) return;
    setThumbKey((k) => k + 1);
    onThumbs();
  };

  return (
    <form className="chat-composer" onSubmit={submit}>
      <IconButton icon="image" label="Lisää kuva" className="chat-attach-btn" onClick={() => fileRef.current?.click()} disabled={disabled} />
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { takeFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div className={cx('chat-field', image && 'has-image')}>
        {image && (
          <div className="chat-preview pop">
            <img src={image.url} alt="Valittu kuva" />
            <button type="button" className="chat-preview-remove" onClick={removeImage} aria-label="Poista kuva"><Icon name="close" size={14} strokeWidth={2.6} /></button>
          </div>
        )}
        <textarea
          ref={ta}
          className="chat-input"
          rows={1}
          value={text}
          placeholder={image ? 'Lisää kuvateksti…' : 'Kirjoita viesti…'}
          aria-label="Viesti"
          maxLength={MAX_LEN + 200}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          disabled={disabled}
        />
        {text.length > MAX_LEN - 100 && <span className={cx('chat-count t-num', text.length > MAX_LEN && 'is-over')}>{text.length}/{MAX_LEN}</span>}
      </div>
      {canSend ? (
        <button key="send" type="submit" className="chat-send pop" aria-label="Lähetä" onMouseDown={(e) => e.preventDefault()}>
          <Icon name="send" size={20} strokeWidth={2.3} />
        </button>
      ) : (
        <button key={`thumbs-${thumbKey}`} type="button" className={cx('chat-thumb-btn', thumbKey > 0 && 'is-tapped')} aria-label="Lähetä peukku" onClick={thumbs} onMouseDown={(e) => e.preventDefault()} disabled={disabled}>
          <span aria-hidden="true">👍</span>
        </button>
      )}
    </form>
  );
}
