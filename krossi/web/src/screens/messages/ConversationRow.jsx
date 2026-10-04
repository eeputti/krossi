// ConversationRow — one inbox/archive row. Touch: swipe left to reveal the actions (pointer
// events, rubber-band + spring back). Mouse: the same actions appear as icon buttons on hover.
//
//   <ConversationRow conversation meId now actions=[{ key, label, icon, tone: 'archive'|'danger'|'restore', onClick }]
//     openId setOpenId onOpen leaving persistent style />
//   persistent: show the action icon buttons all the time (archive screen).
import { useEffect, useRef } from 'react';
import { Avatar, Icon, IconButton } from '../../ui/index.js';
import { relativeShort } from '../../lib/format.js';
import { previewText } from './chatUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const ACTION_W = 78;

/** Avatar for a conversation: single person, or a diagonal duo for groups (+ ball badge on game chats). */
export function ConversationAvatar({ conversation, size = 54 }) {
  const people = conversation.participants || [];
  const badge = conversation.gameId ? <span className="msg-av-badge" aria-hidden="true"><Icon name="ball" size={12} strokeWidth={2.4} /></span> : null;
  if (people.length < 2) {
    return (
      <span className="msg-av" style={{ '--av': `${size}px` }}>
        <Avatar person={people[0]} name={people[0] ? undefined : conversation.title} size={size} />
        {badge}
      </span>
    );
  }
  const small = Math.round(size * 0.68);
  return (
    <span className="msg-av msg-av-duo" style={{ '--av': `${size}px` }}>
      <Avatar person={people[1]} size={small} className="msg-av-back" />
      <Avatar person={people[0]} size={small} ring className="msg-av-front" />
      {badge}
    </span>
  );
}

export function ConversationRow({ conversation, meId, now, actions = [], openId, setOpenId, onOpen, leaving, persistent, style }) {
  const front = useRef(null);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const isOpen = openId === conversation.id;
  const width = actions.length * ACTION_W;

  const setX = (x, animate) => {
    const el = front.current;
    if (!el) return;
    el.style.transition = animate ? '' : 'none';
    el.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setX(isOpen ? -width : 0, true); }, [isOpen, width]);

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' || !width) return;
    drag.current = { x0: e.clientX, y0: e.clientY, base: isOpen ? -width : 0, x: isOpen ? -width : 0, mode: null, t: performance.now(), vx: 0 };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x0;
    const my = e.clientY - d.y0;
    if (!d.mode) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) >= Math.abs(mx)) { drag.current = null; return; } // vertical: let the page scroll
      d.mode = 'x';
      front.current?.setPointerCapture?.(e.pointerId);
      if (openId && openId !== conversation.id) setOpenId(null);
    }
    let x = d.base + mx;
    if (x > 0) x *= 0.22; // rubber band to the right
    if (x < -width) x = -width + (x + width) * 0.3; // rubber band past the actions
    const t = performance.now();
    d.vx = (x - d.x) / Math.max(1, t - d.t);
    d.x = x;
    d.t = t;
    setX(x, false);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== 'x') return;
    suppressClick.current = true;
    const open = d.vx < -0.45 || (d.vx < 0.45 && d.x < -width * 0.42);
    setX(open ? -width : 0, true);
    setOpenId(open ? conversation.id : null);
  };

  const handleClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (openId) { setOpenId(null); return; } // first tap just closes an open row
    onOpen(conversation);
  };

  const unread = conversation.unread;
  const time = conversation.lastMessage?.createdAt || conversation.updatedAt;
  return (
    <div className={cx('msg-row-wrap', leaving && 'is-leaving')} style={style}>
      <div className="msg-row-clip">
        <div className={cx('msg-row', isOpen && 'is-open', unread && 'is-unread', persistent && 'is-persistent')}>
          {width > 0 && (
            <div className="msg-row-actions" style={{ '--w': `${width}px` }}>
              {actions.map((a) => (
                <button key={a.key} type="button" tabIndex={isOpen ? 0 : -1} className={cx('msg-row-action', `is-${a.tone}`)} onClick={() => { setOpenId(null); a.onClick(conversation); }}>
                  <Icon name={a.icon} size={20} />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          )}
          <div
            ref={front}
            className="msg-row-front"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <button type="button" className="msg-row-main" onClick={handleClick} aria-label={`${conversation.title}${unread ? ', lukematon' : ''}`}>
              <ConversationAvatar conversation={conversation} />
              <span className="msg-row-text">
                <span className="msg-row-top">
                  <span className="msg-row-title truncate">{conversation.title}</span>
                  <span className="msg-row-time t-num">{time ? relativeShort(time, now) : ''}</span>
                </span>
                <span className="msg-row-bottom">
                  <span className="msg-row-preview truncate">{previewText(conversation, meId)}</span>
                  {unread && <span className="msg-row-dot" aria-hidden="true" />}
                </span>
              </span>
            </button>
            {actions.length > 0 && (
              <div className="msg-row-tools">
                {actions.map((a) => (
                  <IconButton key={a.key} icon={a.icon} label={a.label} variant="soft" size="sm" className={cx('msg-row-tool', `is-${a.tone}`)} onClick={() => a.onClick(conversation)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
