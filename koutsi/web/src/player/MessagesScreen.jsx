// MessagesScreen (player) — Viestit: the conversations the player's coaches have opened. With one
// coach the list is skipped and the conversation opens straight away. ThreadScreen is one
// conversation (/pelaaja/viestit/:coachId); a reply link (?vastaa=announcement:<id>) quotes a Tiedote.
import { useEffect } from 'react';
import { useData } from '../app/data.jsx';
import { goBack, navigate } from '../app/router.js';
import { Avatar, EmptyState, Page, SkeletonList, TopBar } from '../ui/index.js';
import { useMessages } from '../shared/messages/MessagesProvider.jsx';
import { Chat } from '../shared/messages/Chat.jsx';
import { listTime, parseRef, previewOf, refQuote, sortThreads } from '../domain/messages.js';
import { koutsiGroupsForStudent } from '../domain/core.js';

const cx = (...c) => c.filter(Boolean).join(' ');
export const playerThreadPath = (coachId, ref = null) => `/pelaaja/viestit/${encodeURIComponent(coachId)}${ref ? `?vastaa=${encodeURIComponent(`${ref.kind}:${ref.id}`)}` : ''}`;

/** The conversations a player has: opened by a coach (on), or with messages from before. */
export function visibleThreads(threads) {
  return sortThreads((threads || []).filter((t) => t.enabled || t.lastMessageAt));
}

function coachLine(state, coachId) {
  const names = [...new Set(koutsiGroupsForStudent(state, state.students[0].id).filter((g) => g.coachId === coachId).map((g) => g.name))];
  return ['Valmentajasi', ...names].join(' · ');
}

export function MessagesScreen() {
  const { state } = useData();
  const m = useMessages();
  const threads = visibleThreads(m.threads);
  const coachOf = (id) => (state.coaches || []).find((c) => c.id === id) || null;
  const only = threads.length === 1 ? threads[0] : null;
  useEffect(() => { if (only) navigate(playerThreadPath(only.coachId), { replace: true }); }, [only?.coachId]); // eslint-disable-line react-hooks/exhaustive-deps

  let content;
  if (!m.loaded || only) content = <SkeletonList count={2} variant="row" />;
  else if (!threads.length) content = <EmptyState art="mail" title="Ei viestejä" text="Kun valmentajasi ottaa viestit käyttöön, voitte viestiä täällä kahden kesken." />;
  else {
    content = (
      <div className="msg-list" role="list">
        {threads.map((t) => {
          const coach = coachOf(t.coachId);
          const unread = t.unread > 0;
          return (
            <button key={t.id} type="button" className={cx('msg-row', unread && 'is-unread')} onClick={() => navigate(playerThreadPath(t.coachId))}>
              <Avatar person={coach} size={44} />
              <span className="msg-row-text">
                <span className="msg-row-top">
                  <span className="msg-row-title truncate">{coach?.name || 'Valmentaja'}</span>
                  <span className="msg-row-time t-num">{listTime(t.lastMessageAt)}</span>
                </span>
                <span className="msg-row-group truncate">{coachLine(state, t.coachId)}</span>
                <span className="msg-row-bottom">
                  <span className="msg-row-preview truncate">{previewOf(t, 'player') || 'Ei vielä viestejä'}</span>
                  {unread && <span className="msg-row-dot" aria-hidden="true" />}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <>
      <TopBar title="Viestit" back="/pelaaja/koti" />
      <Page className="msg-page k-page-pad">{content}</Page>
    </>
  );
}

export function ThreadScreen({ params, query }) {
  const { state } = useData();
  const m = useMessages();
  const me = state.students[0];
  const coach = (state.coaches || []).find((c) => c.id === params.id) || null;
  const thread = coach ? m.byCoach(coach.id) : null;
  if (m.loaded && (!coach || !thread || (!thread.enabled && !thread.lastMessageAt))) {
    return (
      <>
        <TopBar title="Viestit" back="/pelaaja/koti" />
        <Page><EmptyState art="mail" title="Ei keskustelua" text="Valmentaja ei ole ottanut viestejä käyttöön." /></Page>
      </>
    );
  }
  const first = (coach?.name || '').split(' ')[0] || 'Valmentaja';
  return (
    <Chat
      thread={thread}
      viewer="player"
      title={coach?.name || 'Valmentaja'}
      sub={coach ? coachLine(state, coach.id) : ''}
      person={coach}
      onBack={() => goBack('/pelaaja/koti')}
      placeholder="Kirjoita valmentajalle…"
      closed={thread && !thread.enabled ? `${first} on ottanut viestit pois. Keskustelu jää luettavaksi.` : null}
      initialRef={parseRef(query?.vastaa)}
      resolveRef={(kind, id) => refQuote(state, me, kind, id, 'player')}
    />
  );
}
