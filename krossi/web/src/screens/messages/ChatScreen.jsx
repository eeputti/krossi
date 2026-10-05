// ChatScreen — /pelaa/viestit/:id (route type 'full': no tab bar on phones).
// Sticky header (+ pinned game card in game chats), grouped bubbles with day separators,
// optimistic sending, realtime with dedupe, "Uusia viestejä" pill, image lightbox and a
// composer pinned to the bottom of a visual-viewport-sized column (keyboard friendly).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useResync } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { goBack, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { chatDayLabel, formatTime } from '../../lib/format.js';
import {
  Avatar, AvatarStack, Button, Chip, EmptyState, ErrorState, Icon, IconButton, ListRow, Sheet, Skeleton, useConfirm, useToast,
} from '../../ui/index.js';
import { levelText } from '../players/playerInfo.js';
import { buildTimeline, mergeMessage, mergeSnapshot } from './chatUtils.js';
import { ChatSkeleton, Composer, DaySeparator, MessageGroup, PinnedGame, SystemPill } from './ChatParts.jsx';

let tmpSeq = 0;

/** Sizes the chat column to the visual viewport (shrinks above the virtual keyboard). */
function useChatViewport(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const vv = window.visualViewport;
    const update = () => {
      const host = el.parentElement;
      const top = host ? host.getBoundingClientRect().top + window.scrollY : 0;
      el.style.setProperty('--chat-top', `${Math.max(0, Math.round(top))}px`);
      if (vv) el.style.setProperty('--chat-vh', `${Math.round(vv.height)}px`);
      if (vv && vv.offsetTop > 0 && document.activeElement?.classList.contains('chat-input')) window.scrollTo(0, 0);
    };
    update();
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, [ref]);
}

export function ChatScreen({ params }) {
  const id = params.id;
  const { user, profile, paid } = useSession();
  const meId = user?.id;
  const toast = useToast();
  const confirm = useConfirm();
  const { requirePaid } = usePaywall();
  const rootRef = useRef(null);
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  useChatViewport(rootRef);

  // ── data ──────────────────────────────────────────────────────────────────
  const conv = useAsync(() => api.messages.getConversation(id), [id]);
  const conversation = conv.data || null;
  const gameId = conversation?.gameId || null;
  const game = useAsync(() => (gameId ? api.games.get(gameId) : Promise.resolve(null)), [gameId]);
  const other = conversation && !conversation.isGroup ? conversation.participants[0] || null : null;
  // Header subtitle enrichment only (city); the header works without it, so failures fall back quietly.
  const otherProfile = useAsync(() => (other && paid ? api.players.get(other.id).catch(() => null) : Promise.resolve(null)), [other?.id, paid]);
  const archived = useAsync(() => api.messages.getArchived(), [id]);
  const isArchived = (archived.data || []).includes(id);

  const myLite = useMemo(() => ({
    id: meId, name: profile?.name || 'Sinä', avatarUrl: profile?.avatarUrl || null, avatarColor: profile?.avatarColor || 'blue', skillLevel: profile?.skillLevel || null,
  }), [meId, profile]);

  const [messages, setMessages] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const loaded = useRef(false);
  const buffer = useRef([]);

  const markRead = useCallback(() => {
    api.messages.markRead(id).catch(() => {}); // best effort; the unread dot simply stays
  }, [id]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      let list = await api.messages.listMessages(id);
      for (const m of buffer.current) list = mergeMessage(list, m, meId);
      buffer.current = [];
      loaded.current = true;
      setMessages(list);
      markRead();
    } catch (err) {
      setLoadError(err);
    }
  }, [id, meId, markRead]);

  const seen = useRef(null);
  const initialIds = useRef(null);
  useEffect(() => {
    loaded.current = false;
    buffer.current = [];
    seen.current = null;
    initialIds.current = null;
    setMessages(null);
    load();
    return api.messages.subscribe(id, (msg) => {
      if (!loaded.current) { buffer.current.push(msg); return; }
      setMessages((list) => mergeMessage(list || [], msg, meId));
      if (msg.senderId !== meId) markRead();
    });
  }, [id, meId, load, markRead]);

  // Back from the background / offline: fetch what realtime missed and merge it into what is on
  // screen (keys, unsent bubbles and anything that arrived during the fetch are kept).
  useResync(useCallback(async () => {
    if (!loaded.current) return;
    try {
      const fresh = await api.messages.listMessages(id);
      setMessages((curr) => mergeSnapshot(curr || [], fresh, meId));
      markRead();
    } catch { /* keep what we have; the next resync tries again */ }
  }, [id, meId, markRead]));

  // ── sending (optimistic, in order) ────────────────────────────────────────
  const queue = useRef(Promise.resolve());
  const objectUrls = useRef(new Set());
  useEffect(() => () => objectUrls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const deliver = useCallback((draft, tmpId) => {
    queue.current = queue.current.then(async () => {
      try {
        const msg = draft.kind === 'image' ? await api.messages.sendImage(id, draft.file)
          : draft.kind === 'thumbs' ? await api.messages.sendThumbs(id)
            : await api.messages.send(id, draft.text);
        setMessages((list) => mergeMessage(list || [], msg, meId, tmpId));
      } catch (err) {
        setMessages((list) => (list || []).map((m) => (m.id === tmpId ? { ...m, failed: true } : m)));
        toast(err);
      }
    });
  }, [id, meId, toast]);

  const enqueue = useCallback((draft) => {
    const tmpId = `tmp-${Date.now().toString(36)}-${++tmpSeq}`;
    const local = {
      id: tmpId, key: tmpId, local: true, draft, conversationId: id, senderId: meId, sender: myLite, kind: draft.kind,
      text: draft.kind === 'thumbs' ? '👍' : draft.text || null, imageUrl: draft.url || null, createdAt: new Date().toISOString(), meta: null,
    };
    setMessages((list) => [...(list || []), local]);
    deliver(draft, tmpId);
  }, [deliver, id, meId, myLite]);

  const onSend = ({ text, image }) => {
    if (image) { objectUrls.current.add(image.url); enqueue({ kind: 'image', file: image.file, url: image.url }); }
    if (text) enqueue({ kind: 'text', text });
  };
  const retry = (m) => {
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, failed: false } : x)));
    deliver(m.draft, m.id);
  };
  const discard = (m) => setMessages((list) => list.filter((x) => x.id !== m.id));

  // ── scrolling ─────────────────────────────────────────────────────────────
  const nearBottom = useRef(true);
  const [newCount, setNewCount] = useState(0);
  const [far, setFar] = useState(false);
  const toBottom = useCallback((smooth) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    nearBottom.current = dist < 140;
    if (nearBottom.current) setNewCount(0);
    setFar(dist > 520);
  };

  useLayoutEffect(() => {
    if (!messages) return;
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id));
      initialIds.current = new Set(seen.current);
      toBottom(false);
      return;
    }
    const fresh = messages.filter((m) => !seen.current.has(m.id));
    if (!fresh.length) return;
    fresh.forEach((m) => seen.current.add(m.id));
    if (fresh.some((m) => m.local) || nearBottom.current) toBottom(true);
    else {
      const incoming = fresh.filter((m) => m.senderId !== meId).length;
      if (incoming) setNewCount((c) => c + incoming);
    }
  }, [messages, meId, toBottom]);

  // Keep the newest message in view when the column resizes (keyboard, composer growing, game card).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let lastH = el.clientHeight;
    const ro = new ResizeObserver(() => {
      if (el.clientHeight !== lastH && nearBottom.current) el.scrollTop = el.scrollHeight;
      lastH = el.clientHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onImageLoad = () => { if (nearBottom.current) toBottom(false); };
  const isNew = useCallback((m) => !!initialIds.current && !initialIds.current.has(m.id) && !initialIds.current.has(m.key), []);
  const timeline = useMemo(() => (messages ? buildTimeline(messages, meId) : []), [messages, meId]);

  // ── navigation, sheets ────────────────────────────────────────────────────
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const openPlayer = (person) => {
    if (!person || person.id === meId) return;
    requirePaid(() => navigate(`/pelaa/pelaaja/${person.id}`), 'Näe pelaajien profiilit');
  };
  const openGame = () => requirePaid(() => navigate(`/pelaa/peli/${gameId}`), 'Avaa peli');
  const openWho = () => {
    if (!conversation) return;
    if (conversation.isGroup) setPeopleOpen(true);
    else openPlayer(other);
  };
  const openImage = (m) => { setLightbox(m); setLightboxOpen(true); };

  const toggleArchive = async () => {
    setMenuOpen(false);
    try {
      const ids = await api.messages.getArchived();
      if (isArchived) {
        const next = ids.filter((x) => x !== id);
        await api.messages.setArchived(next);
        archived.setData(next);
        toast('Keskustelu palautettu Viesteihin', { icon: 'undo' });
        return;
      }
      const next = [...new Set([...ids, id])];
      await api.messages.setArchived(next);
      archived.setData(next);
      toast('Keskustelu arkistoitu', {
        icon: 'archive',
        duration: 5000,
        action: {
          label: 'Kumoa',
          onClick: () => api.messages.getArchived()
            .then((cur) => api.messages.setArchived(cur.filter((x) => x !== id)))
            .catch((err) => toast(err)),
        },
      });
      goBack('/pelaa/viestit');
    } catch (err) {
      toast(err);
    }
  };

  const deleteChat = async () => {
    setMenuOpen(false);
    const ok = await confirm({
      title: 'Poistetaanko keskustelu?',
      message: 'Keskustelu ja sen viestit poistuvat kaikilta osallistujilta. Tätä ei voi perua.',
      confirmLabel: 'Poista',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.messages.deleteConversation(id);
      toast('Keskustelu poistettu', { icon: 'trash' });
      navigate('/pelaa/viestit', { replace: true });
    } catch (err) {
      toast(err);
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  const peopleCount = (conversation?.participants.length || 0) + 1;
  const subtitle = !conversation ? '' : conversation.isGroup
    ? `${gameId ? 'Pelichat' : 'Ryhmä'} · ${peopleCount} pelaajaa`
    : [levelText(otherProfile.data || other), otherProfile.data?.city].filter(Boolean).join(' · ') || 'Näytä profiili';

  let thread;
  if (conv.error) thread = <ErrorState error={conv.error} onRetry={() => { conv.reload(); load(); }} />;
  else if (!conv.loading && !conversation) {
    thread = (
      <EmptyState
        art="chat"
        title="Keskustelua ei löytynyt"
        text="Se on ehkä poistettu, tai sinulla ei ole siihen pääsyä."
        action={<Button variant="dark" icon="chat" onClick={() => navigate('/pelaa/viestit', { replace: true })}>Takaisin viesteihin</Button>}
      />
    );
  } else if (loadError) thread = <ErrorState error={loadError} onRetry={load} />;
  else if (conv.loading || !messages) thread = <ChatSkeleton />;
  else if (messages.length === 0) {
    thread = (
      <EmptyState
        compact
        art="wave"
        title="Aloita keskustelu 👋"
        text="Ehdota aikaa ja paikkaa — tai lähetä peukku."
        className="chat-empty"
      />
    );
  } else {
    thread = timeline.map((item) => {
      if (item.type === 'day') return <DaySeparator key={item.key} label={item.label} />;
      if (item.type === 'system') return <SystemPill key={item.key} message={item.message} meId={meId} isNew={isNew(item.message)} />;
      return (
        <MessageGroup
          key={item.key}
          group={item}
          showSender={conversation.isGroup && !item.mine}
          isNew={isNew}
          onImage={openImage}
          onImageLoad={onImageLoad}
          onRetry={retry}
          onDiscard={discard}
          onSender={openPlayer}
        />
      );
    });
  }

  const creatorId = game.data?.creator?.id;
  return (
    <div className="chat" ref={rootRef}>
      <header className="chat-head">
        <div className="chat-head-bar">
          <button type="button" className="chat-back" onClick={() => goBack('/pelaa/viestit')} aria-label="Takaisin viesteihin">
            <Icon name="chevron-left" size={26} strokeWidth={2.4} />
          </button>
          {conversation ? (
            <button type="button" className="chat-who" onClick={openWho} aria-label={conversation.isGroup ? 'Näytä osallistujat' : `Avaa ${conversation.title} profiili`}>
              {conversation.isGroup
                ? <AvatarStack people={conversation.participants} max={3} size={30} className="chat-who-stack" />
                : <Avatar person={other} name={other ? undefined : conversation.title} size={40} />}
              <span className="chat-who-text">
                <span className="chat-title truncate">{conversation.title}</span>
                <span className="chat-sub truncate">{subtitle}</span>
              </span>
            </button>
          ) : (
            <span className="chat-who is-loading" aria-hidden="true">
              <Skeleton w={40} h={40} r={999} />
              <span className="chat-who-text"><Skeleton w={120} h={14} /><Skeleton w={84} h={11} /></span>
            </span>
          )}
          {conversation && <IconButton icon="more" label="Keskustelun toiminnot" onClick={() => setMenuOpen(true)} />}
        </div>
        {gameId && <PinnedGame state={game} onOpen={openGame} />}
      </header>

      <div className="chat-body">
        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          <div className="chat-thread" aria-live="polite">{thread}</div>
        </div>
        {newCount > 0 ? (
          <button type="button" className="chat-jump is-pill pop" onClick={() => { toBottom(true); setNewCount(0); }}>
            {newCount === 1 ? 'Uusi viesti' : 'Uusia viestejä'} <Icon name="chevron-down" size={16} strokeWidth={2.6} />
          </button>
        ) : far ? (
          <button type="button" className="chat-jump pop" onClick={() => toBottom(true)} aria-label="Uusimpiin viesteihin">
            <Icon name="chevron-down" size={20} strokeWidth={2.4} />
          </button>
        ) : null}
      </div>

      <Composer onSend={onSend} onThumbs={() => enqueue({ kind: 'thumbs' })} disabled={!conversation || !messages} textareaRef={taRef} />

      {conversation?.isGroup && (
        <Sheet
          open={peopleOpen}
          onClose={() => setPeopleOpen(false)}
          title="Osallistujat"
          subtitle={`${peopleCount} pelaajaa`}
          size="sm"
          footer={gameId ? <Button variant="dark" size="lg" block icon="calendar" onClick={() => { setPeopleOpen(false); openGame(); }}>Avaa peli</Button> : null}
        >
          <div className="chat-people list-group">
            <ListRow leading={<Avatar person={myLite} size={42} />} title={`${myLite.name} (sinä)`} subtitle={levelText(profile) || undefined} right={creatorId === meId ? <Chip tone="green" size="sm" icon="star">Järjestäjä</Chip> : null} />
            {conversation.participants.map((p) => (
              <ListRow
                key={p.id}
                leading={<Avatar person={p} size={42} />}
                title={p.name}
                subtitle={levelText(p) || 'Pelaaja'}
                right={creatorId === p.id ? <Chip tone="green" size="sm" icon="star">Järjestäjä</Chip> : undefined}
                onClick={() => { setPeopleOpen(false); openPlayer(p); }}
              />
            ))}
          </div>
        </Sheet>
      )}

      {conversation && (
        <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={conversation.title} subtitle={subtitle} size="sm">
          <div className="chat-menu list-group">
            {conversation.isGroup
              ? <ListRow icon="users" title="Osallistujat" subtitle={`${peopleCount} pelaajaa`} onClick={() => { setMenuOpen(false); setPeopleOpen(true); }} />
              : <ListRow icon="user" title="Näytä profiili" onClick={() => { setMenuOpen(false); openPlayer(other); }} />}
            {gameId && <ListRow icon="calendar" title="Avaa peli" onClick={() => { setMenuOpen(false); openGame(); }} />}
            <ListRow icon={isArchived ? 'undo' : 'archive'} title={isArchived ? 'Palauta arkistosta' : 'Arkistoi keskustelu'} subtitle={isArchived ? undefined : 'Piilottaa sen Viesteistä tällä laitteella'} onClick={toggleArchive} chevron={false} />
            <ListRow icon="trash" title="Poista keskustelu" subtitle="Poistuu kaikilta osallistujilta" tone="danger" onClick={deleteChat} chevron={false} />
          </div>
        </Sheet>
      )}

      <Sheet open={lightboxOpen} onClose={() => setLightboxOpen(false)} onClosed={() => setLightbox(null)} size="full" tone="dark" className="chat-lightbox" bodyClassName="chat-lightbox-body">
        {lightbox && (
          <figure className="chat-lightbox-figure">
            <img src={lightbox.imageUrl} alt="Kuva keskustelusta" className="chat-lightbox-img" />
            <figcaption className="chat-lightbox-cap">
              {lightbox.senderId === meId ? 'Sinä' : lightbox.sender?.name} · {chatDayLabel(lightbox.createdAt)} klo {formatTime(lightbox.createdAt)}
            </figcaption>
          </figure>
        )}
      </Sheet>
    </div>
  );
}
