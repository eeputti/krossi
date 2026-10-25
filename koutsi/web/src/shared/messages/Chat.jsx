// Chat.jsx — one conversation, the same for the coach and the player (Krossi's chat look: grouped
// bubbles with day separators, a composer pinned above the keyboard). Koutsi's own parts: a reply can
// quote a Toive, a Tiedote or a Miten meni? (only its id is stored; each side shows what it can still
// see), "Nähty" under one's own latest message, a reminder that health information does not belong
// here (it turns orange when the text looks like it), and one's own message can be deleted.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useResync } from '../../app/hooks.js';
import { Avatar, Icon, IconButton, Skeleton, useConfirm, useToast } from '../../ui/index.js';
import { looksLikeHealth, MESSAGE_MAX, seen as seenBy, timeline } from '../../domain/messages.js';

const cx = (...c) => c.filter(Boolean).join(' ');
let localSeq = 0;

/** Sizes the conversation to the visual viewport, so the composer stays above a phone keyboard. */
function useChatViewport(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const vv = window.visualViewport;
    const update = () => {
      const top = el.parentElement ? el.parentElement.getBoundingClientRect().top + window.scrollY : 0;
      el.style.setProperty('--chat-top', `${Math.max(0, Math.round(top))}px`);
      if (vv) el.style.setProperty('--chat-vh', `${Math.round(vv.height)}px`);
      if (vv && vv.offsetTop > 0 && document.activeElement?.classList.contains('chat-input')) window.scrollTo(0, 0);
    };
    update();
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => { vv?.removeEventListener('resize', update); window.removeEventListener('resize', update); };
  }, [ref]);
}

function Quote({ quote }) {
  if (!quote) return null;
  return (
    <span className={cx('msg-quote', !quote.text && 'is-gone')}>
      <span className="msg-quote-label">{quote.label}</span>
      <span className="msg-quote-text">{quote.text || 'Ei enää näkyvissä'}</span>
    </span>
  );
}

/**
 * Chat
 *   thread (null while loading), viewer 'coach' | 'player', title, sub, person (the other side, for avatars)
 *   onBack(), onWho() (tap on the name), headAction (node), context (node under the header)
 *   placeholder, closed: null | string (why nobody can write: the composer gives way to it)
 *   initialRef: { kind, id } | null — a reply link's quote; resolveRef(kind, id) → { label, text } | null
 *   onSent() — after a message went through (the coach app counts it)
 */
export function Chat({ thread, viewer, title, sub, person, onBack, onWho, headAction, context, placeholder, closed = null, initialRef = null, resolveRef, onSent }) {
  const toast = useToast();
  const confirm = useConfirm();
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  useChatViewport(rootRef);
  const threadId = thread?.id || null;

  const [messages, setMessages] = useState(null);
  const [pending, setPending] = useState([]);
  const [text, setText] = useState('');
  const [replyRef, setReplyRef] = useState(initialRef);
  const [sending, setSending] = useState(false);
  const firstIds = useRef(null);

  useEffect(() => { setReplyRef(initialRef); }, [initialRef?.kind, initialRef?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!threadId) return;
    try {
      const list = await api.messages.list(threadId);
      setMessages(list);
      if (!firstIds.current) firstIds.current = new Set(list.map((m) => m.id));
      api.messages.markRead(threadId).catch(() => {}); // best effort: the unread dot simply stays
    } catch (err) {
      setMessages((m) => m || []);
      toast(err);
    }
  }, [threadId, toast]);

  useEffect(() => {
    firstIds.current = null;
    setMessages(null);
    load();
    if (!threadId) return undefined;
    let timer = null;
    const unsubscribe = api.messages.subscribe((e) => {
      if (e?.threadId && e.threadId !== threadId) return;
      clearTimeout(timer);
      timer = setTimeout(load, 200);
    });
    return () => { clearTimeout(timer); unsubscribe?.(); };
  }, [threadId, load]);
  useResync(() => { load(); });

  // Newest at the bottom: on open, and when something new arrives while the reader is near it.
  const nearBottom = useRef(true);
  const onScroll = () => {
    const el = scrollRef.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  };
  const shown = useMemo(() => [...(messages || []), ...pending], [messages, pending]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && (nearBottom.current || pending.length)) el.scrollTop = el.scrollHeight;
  }, [shown.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 148)}px`;
  }, [text]);

  const send = async (e) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || !threadId || sending) return;
    if (body.length > MESSAGE_MAX) { toast(`Viesti on liian pitkä (enintään ${MESSAGE_MAX} merkkiä).`, { tone: 'error' }); return; }
    const local = { id: `local-${++localSeq}`, sender: viewer, body, refKind: replyRef?.kind || null, refId: replyRef?.id || null, at: new Date().toISOString(), local: true };
    setPending((p) => [...p, local]);
    setText('');
    const ref = replyRef;
    setReplyRef(null);
    setSending(true);
    try {
      const saved = await api.messages.send(threadId, { body, refKind: ref?.kind || null, refId: ref?.id || null });
      setMessages((list) => ((list || []).some((m) => m.id === saved.id) ? list : [...(list || []), saved]));
      onSent?.();
    } catch (err) {
      toast(err);
      setText(body); // nothing is lost: the text comes back to the field
      setReplyRef(ref);
    } finally {
      setPending((p) => p.filter((m) => m.id !== local.id));
      setSending(false);
      taRef.current?.focus();
    }
  };
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    e.preventDefault();
    send();
  };
  const removeMine = async (m) => {
    if (m.local) return;
    const ok = await confirm({ title: 'Poistetaanko viesti?', message: 'Viesti poistuu teiltä molemmilta.', confirmLabel: 'Poista', danger: true });
    if (!ok) return;
    try {
      await api.messages.remove(m.id);
      setMessages((list) => (list || []).filter((x) => x.id !== m.id));
    } catch (err) { toast(err); }
  };

  const items = useMemo(() => timeline(shown, viewer), [shown, viewer]);
  const isSeen = useMemo(() => seenBy(thread, messages || [], viewer), [thread, messages, viewer]);
  const lastGroup = useMemo(() => [...items].reverse().find((i) => i.kind === 'group') || null, [items]);
  const lastMineKey = lastGroup?.mine ? lastGroup.key : null;
  const health = looksLikeHealth(text);
  const replyQuote = replyRef && resolveRef ? resolveRef(replyRef.kind, replyRef.id) : null;

  let body;
  if (!thread || messages === null) {
    body = (
      <div className="chat-thread chat-skel" aria-busy="true" aria-label="Ladataan viestejä">
        <Skeleton w="62%" h={40} r={20} />
        <span className="chat-skel-mine"><Skeleton w={180} h={40} r={20} /></span>
      </div>
    );
  } else {
    body = (
      <div className="chat-thread" aria-live="polite">
        {items.length === 0 && <p className="chat-empty">{closed ? 'Ei viestejä.' : 'Ei vielä viestejä. Kirjoita ensimmäinen.'}</p>}
        {items.map((it) => (it.kind === 'day' ? (
          <div key={it.key} className="chat-day" role="separator"><span>{it.label}</span></div>
        ) : (
          <div key={it.key} className={cx('chat-group', it.mine ? 'is-mine' : 'is-theirs')}>
            <div className="chat-group-body">
              {!it.mine && <span className="chat-group-av"><Avatar person={person} size={30} /></span>}
              <div className="chat-bubbles">
                {it.bubbles.map((m, i) => {
                  const pos = it.bubbles.length > 1 ? (i === 0 ? 'is-first' : i === it.bubbles.length - 1 ? 'is-last' : 'is-middle') : '';
                  const quote = m.refKind && resolveRef ? resolveRef(m.refKind, m.refId) : null;
                  const isNew = firstIds.current && !firstIds.current.has(m.id);
                  const cls = cx('chat-bubble', pos, isNew && 'is-new', m.local && 'is-pending');
                  return it.mine && !m.local ? (
                    <button key={m.id} type="button" className={cls} onClick={() => removeMine(m)} aria-label={`Oma viesti: ${m.body}. Napauta poistaaksesi.`}>
                      <Quote quote={quote} />{m.body}
                    </button>
                  ) : (
                    <div key={m.id} className={cls}><Quote quote={quote} />{m.body}</div>
                  );
                })}
              </div>
            </div>
            <div className={cx('chat-meta t-num', !it.mine && 'has-av')}>
              {it.bubbles.some((m) => m.local) ? 'Lähetetään…' : `${it.time}${it.mine && it.key === lastMineKey && isSeen ? ' · Nähty' : ''}`}
            </div>
          </div>
        )))}
      </div>
    );
  }

  return (
    <div className="chat" ref={rootRef}>
      <header className="chat-head">
        <div className="chat-head-bar">
          <button type="button" className="chat-back" onClick={onBack} aria-label="Takaisin">
            <Icon name="chevron-left" size={26} strokeWidth={2.4} />
          </button>
          <button type="button" className="chat-who" onClick={onWho} disabled={!onWho}>
            <Avatar person={person} size={40} />
            <span className="chat-who-text">
              <span className="chat-title truncate">{title}</span>
              {sub && <span className="chat-sub truncate">{sub}</span>}
            </span>
          </button>
          {headAction}
        </div>
        {context}
      </header>

      <div className="chat-body">
        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>{body}</div>
      </div>

      {closed ? (
        <div className="msg-closed" role="note"><Icon name="info" size={16} /><span>{closed}</span></div>
      ) : (
        <>
          {replyQuote && (
            <div className="msg-replying">
              <Quote quote={replyQuote} />
              <IconButton icon="close" label="Älä lainaa" size="sm" variant="soft" onClick={() => setReplyRef(null)} />
            </div>
          )}
          <div className={cx('msg-health', health && 'is-warn')} role={health ? 'status' : undefined}>
            <Icon name="info" size={15} />
            <span>{health
              ? 'Viestissä taitaa olla terveystietoa. Muotoile ilman sitä, esim. "En pääse tänään."'
              : 'Ei terveystietoja viesteihin: ei vammoja, sairauksia tai lääkityksiä.'}</span>
          </div>
          <form className="chat-composer" onSubmit={send}>
            <div className="chat-field">
              <textarea
                ref={taRef}
                className="chat-input"
                rows={1}
                value={text}
                placeholder={placeholder || 'Kirjoita viesti…'}
                aria-label="Viesti"
                maxLength={MESSAGE_MAX + 200}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={!thread}
              />
              {text.length > MESSAGE_MAX - 100 && <span className={cx('chat-count t-num', text.length > MESSAGE_MAX && 'is-over')}>{text.length}/{MESSAGE_MAX}</span>}
            </div>
            <button type="submit" className="chat-send" aria-label="Lähetä" disabled={!text.trim() || !thread} onMouseDown={(e) => e.preventDefault()}>
              <Icon name="send" size={20} strokeWidth={2.3} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
