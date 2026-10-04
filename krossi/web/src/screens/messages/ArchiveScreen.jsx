// ArchiveScreen — /pelaa/viestit/arkisto: archived conversations with Palauta / Poista.
// The archive is a per-browser list of ids (api.messages.getArchived / setArchived).
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useNow } from '../../app/hooks.js';
import { goBack, navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { Button, EmptyState, ErrorState, Icon, Page, SkeletonList, TopBar } from '../../ui/index.js';
import { ConversationRow } from './ConversationRow.jsx';
import { useConversationActions } from './InboxScreen.jsx';

export function ArchiveScreen() {
  const { user } = useSession();
  const now = useNow(30_000);
  const [openId, setOpenId] = useState(null);
  const { data, error, loading, reload, setData } = useAsync(async () => {
    const [conversations, archived] = await Promise.all([api.messages.listConversations(), api.messages.getArchived()]);
    return { conversations, archived };
  }, []);
  const { leaving, collapse, restore, remove } = useConversationActions({ setData });

  useEffect(() => api.messages.subscribeInbox(() => reload({ silent: true })), [reload]);
  useEffect(() => {
    if (!openId) return undefined;
    const close = (e) => { if (!e.target.closest?.('.msg-row.is-open')) setOpenId(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [openId]);

  const archivedSet = new Set(data?.archived || []);
  const list = (data?.conversations || []).filter((c) => archivedSet.has(c.id));
  const actions = [
    { key: 'restore', label: 'Palauta', icon: 'undo', tone: 'restore', onClick: (c) => collapse(c.id, () => restore(c)) },
    { key: 'delete', label: 'Poista', icon: 'trash', tone: 'danger', onClick: remove },
  ];

  let body;
  if (loading) body = <div className="msg-skeleton"><SkeletonList count={3} variant="row" /></div>;
  else if (error) body = <ErrorState error={error} onRetry={() => reload()} />;
  else if (list.length === 0) {
    body = (
      <EmptyState
        art="chat"
        title="Arkisto on tyhjä"
        text="Arkistoi vanhat keskustelut pyyhkäisemällä niitä vasemmalle Viesteissä — ne löytyvät sitten täältä."
        action={<Button variant="dark" icon="chat" onClick={() => goBack('/pelaa/viestit')}>Takaisin viesteihin</Button>}
      />
    );
  } else {
    body = (
      <>
        <div className="msg-list stagger" role="list">
          {list.map((c, i) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              meId={user?.id}
              now={now}
              actions={actions}
              persistent
              openId={openId}
              setOpenId={setOpenId}
              onOpen={(conv) => navigate(`/pelaa/viestit/${conv.id}`)}
              leaving={leaving.has(c.id)}
              style={{ '--i': i }}
            />
          ))}
        </div>
        <p className="msg-note"><Icon name="info" size={15} />Arkisto on tallessa vain tällä laitteella. Keskustelut säilyvät, vaikka ne ovat piilossa.</p>
      </>
    );
  }

  return (
    <>
      <TopBar title="Arkisto" back="/pelaa/viestit" />
      <Page className="msg-page msg-archive-page">
        {body}
      </Page>
    </>
  );
}
