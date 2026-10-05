// InboxScreen — /pelaa/viestit: play requests on top, then conversations (swipe / hover to
// archive or delete). Realtime: any inbox change silently reloads the lists.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { openCreateGame } from '../../app/AppShell.jsx';
import { useAsync, useNow, useResync } from '../../app/hooks.js';
import { usePaywall } from '../../app/paywall.jsx';
import { Link, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { relativeShort } from '../../lib/format.js';
import {
  Avatar, Button, Card, EmptyState, ErrorState, Icon, IconButton, Page, PageHeader, Section, SkeletonList, useConfirm, useToast,
} from '../../ui/index.js';
import { levelText } from '../players/playerInfo.js';
import { ConversationRow } from './ConversationRow.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const COLLAPSE_MS = 300;

/** Shared by the inbox and the archive: archive / restore / delete with collapse animations. */
export function useConversationActions({ setData }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [leaving, setLeaving] = useState(() => new Set());
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const collapse = useCallback((id, then) => {
    setLeaving((s) => new Set(s).add(id));
    timers.current.push(setTimeout(() => {
      then?.();
      setLeaving((s) => { const n = new Set(s); n.delete(id); return n; });
    }, COLLAPSE_MS));
  }, []);

  const writeArchived = useCallback(async (change) => {
    const current = await api.messages.getArchived();
    const next = change(current);
    await api.messages.setArchived(next);
    setData((d) => (d ? { ...d, archived: next } : d));
    return next;
  }, [setData]);

  const restore = useCallback(async (conversation, { silent = false } = {}) => {
    try {
      await writeArchived((ids) => ids.filter((x) => x !== conversation.id));
      if (!silent) toast('Keskustelu palautettu Viesteihin', { icon: 'undo' });
    } catch (err) {
      toast(err);
    }
  }, [toast, writeArchived]);

  const archive = useCallback(async (conversation) => {
    const hide = (d) => (d ? { ...d, archived: [...new Set([...d.archived, conversation.id])] } : d);
    collapse(conversation.id, () => setData(hide));
    try {
      await writeArchived((ids) => [...new Set([...ids, conversation.id])]);
      toast('Keskustelu arkistoitu', {
        icon: 'archive',
        duration: 5000,
        action: { label: 'Kumoa', onClick: () => restore(conversation, { silent: true }) },
      });
    } catch (err) {
      toast(err);
      setData((d) => (d ? { ...d, archived: d.archived.filter((x) => x !== conversation.id) } : d));
    }
  }, [collapse, restore, setData, toast, writeArchived]);

  const remove = useCallback(async (conversation) => {
    const ok = await confirm({
      title: 'Poistetaanko keskustelu?',
      message: 'Keskustelu ja sen viestit poistuvat kaikilta osallistujilta. Tätä ei voi perua.',
      confirmLabel: 'Poista',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.messages.deleteConversation(conversation.id);
      collapse(conversation.id, () => setData((d) => (d ? { ...d, conversations: d.conversations.filter((c) => c.id !== conversation.id) } : d)));
      toast('Keskustelu poistettu', { icon: 'trash' });
    } catch (err) {
      toast(err);
    }
  }, [collapse, confirm, setData, toast]);

  return { leaving, collapse, archive, restore, remove };
}

function RequestCard({ request, now, busy, leaving, onAccept, onIgnore, onProfile, style }) {
  const level = levelText(request.from);
  return (
    <div className={cx('msg-row-wrap', leaving && 'is-leaving')} style={style}>
      <div className="msg-row-clip">
        <Card className="msg-req" padding="none">
          <div className="msg-req-head">
            <button type="button" className="msg-req-who" onClick={onProfile}>
              <Avatar person={request.from} size={46} />
              <span className="msg-req-whotext">
                <span className="msg-req-name truncate">{request.from.name}</span>
                <span className="msg-req-sub truncate">{[level, relativeShort(request.createdAt, now)].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
            <span className="msg-req-tag"><Icon name="racket" size={14} />Pelipyyntö</span>
          </div>
          {request.message && <p className="msg-req-bubble">{request.message}</p>}
          <div className="msg-req-actions">
            <Button variant="soft" onClick={onIgnore} disabled={busy}>Ohita</Button>
            <Button variant="lime" icon="check" loading={busy} onClick={onAccept}>Hyväksy</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function InboxScreen() {
  const { user } = useSession();
  const meId = user?.id;
  const toast = useToast();
  const { requirePaid } = usePaywall();
  const now = useNow(30_000);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { data, error, loading, reload, setData } = useAsync(async () => {
    const [conversations, requests, archived] = await Promise.all([
      api.messages.listConversations(),
      api.messages.listRequests(),
      api.messages.getArchived(),
    ]);
    return { conversations, requests, archived };
  }, []);
  const { leaving, collapse, archive, remove } = useConversationActions({ setData });

  useEffect(() => api.messages.subscribeInbox(() => reload({ silent: true })), [reload]);
  useResync(() => reload({ silent: true }));

  // Tapping anywhere outside an open (swiped) row closes it.
  useEffect(() => {
    if (!openId) return undefined;
    const close = (e) => { if (!e.target.closest?.('.msg-row.is-open')) setOpenId(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [openId]);

  const accept = (request) => requirePaid(async () => {
    setBusyId(request.id);
    try {
      const conversationId = await api.messages.acceptRequest(request.id);
      toast('Pelipyyntö hyväksytty — sovitaan peli! 🎾');
      navigate(`/pelaa/viestit/${conversationId}`);
    } catch (err) {
      toast(err);
      setBusyId(null);
    }
  }, 'Vastaa pelipyyntöihin');

  const ignore = (request) => {
    collapse(request.id, () => setData((d) => (d ? { ...d, requests: d.requests.filter((r) => r.id !== request.id) } : d)));
    api.messages.ignoreRequest(request.id).catch((err) => { toast(err); reload({ silent: true }); });
  };

  const openProfile = (person) => requirePaid(() => navigate(`/pelaa/pelaaja/${person.id}`), 'Näe pelaajien profiilit');

  const archivedSet = new Set(data?.archived || []);
  const conversations = (data?.conversations || []).filter((c) => !archivedSet.has(c.id));
  const archivedCount = (data?.conversations || []).filter((c) => archivedSet.has(c.id)).length;
  const requests = data?.requests || [];
  const unread = conversations.filter((c) => c.unread).length + requests.length;

  const actions = [
    { key: 'archive', label: 'Arkistoi', icon: 'archive', tone: 'archive', onClick: archive },
    { key: 'delete', label: 'Poista', icon: 'trash', tone: 'danger', onClick: remove },
  ];

  let body;
  if (loading) {
    body = <div className="msg-skeleton"><SkeletonList count={6} variant="row" /></div>;
  } else if (error) {
    body = <ErrorState error={error} onRetry={() => reload()} />;
  } else if (conversations.length === 0 && requests.length === 0) {
    body = (
      <EmptyState
        art="chat"
        title="Ei vielä viestejä"
        text="Kun lähetät pelipyynnön tai liityt peliin, keskustelut ilmestyvät tänne."
        action={(
          <>
            <Button variant="lime" icon="users" onClick={() => navigate('/pelaa/pelaajat')}>Etsi pelaajia</Button>
            <Button variant="outline" icon="plus" onClick={() => openCreateGame()}>Luo peli</Button>
          </>
        )}
      />
    );
  } else {
    body = (
      <>
        {requests.length > 0 && (
          <Section title={<span className="msg-section-title">Pelipyynnöt <span className="msg-count t-num">{requests.length}</span></span>} className="msg-section">
            <div className="msg-requests stagger">
              {requests.map((r, i) => (
                <RequestCard
                  key={r.id}
                  request={r}
                  now={now}
                  busy={busyId === r.id}
                  leaving={leaving.has(r.id)}
                  onAccept={() => accept(r)}
                  onIgnore={() => ignore(r)}
                  onProfile={() => openProfile(r.from)}
                  style={{ '--i': i }}
                />
              ))}
            </div>
          </Section>
        )}
        <Section title={requests.length > 0 ? 'Keskustelut' : undefined} className="msg-section">
          {conversations.length === 0 ? (
            <EmptyState compact art="chat" title="Ei keskusteluja" text="Hyväksy pelipyyntö, niin pääsette sopimaan pelistä." />
          ) : (
            <div className="msg-list stagger" role="list">
              {conversations.map((c, i) => (
                <ConversationRow
                  key={c.id}
                  conversation={c}
                  meId={meId}
                  now={now}
                  actions={actions}
                  openId={openId}
                  setOpenId={setOpenId}
                  onOpen={(conv) => navigate(`/pelaa/viestit/${conv.id}`)}
                  leaving={leaving.has(c.id)}
                  style={{ '--i': i }}
                />
              ))}
            </div>
          )}
          {conversations.length > 0 && <p className="msg-hint">Pyyhkäise keskustelua vasemmalle arkistoidaksesi tai poistaaksesi sen.</p>}
          {archivedCount > 0 && (
            <Link to="/pelaa/viestit/arkisto" className="msg-archive-link">
              <span className="msg-archive-icon"><Icon name="archive" size={18} /></span>
              <span className="msg-archive-text">Arkisto</span>
              <span className="msg-archive-count t-num">{archivedCount}</span>
              <Icon name="chevron-right" size={18} />
            </Link>
          )}
        </Section>
      </>
    );
  }

  return (
    <Page className="msg-page">
      <PageHeader
        title="Viestit"
        subtitle={!loading && !error && unread > 0 ? `${unread} ${unread === 1 ? 'uusi' : 'uutta'}` : undefined}
        actions={<IconButton icon="archive" label="Arkisto" variant="soft" onClick={() => navigate('/pelaa/viestit/arkisto')} />}
      />
      {body}
    </Page>
  );
}
