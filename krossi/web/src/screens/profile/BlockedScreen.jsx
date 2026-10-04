// BlockedScreen — /pelaa/asetukset/estetyt: blocked players, with "Poista esto" (+ undo).
import { useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { Avatar, Button, EmptyState, ErrorState, ListRow, Page, SkeletonList, TopBar, useToast } from '../../ui/index.js';

export function BlockedScreen() {
  const toast = useToast();
  const { data: rows, loading, error, reload, setData } = useAsync(() => api.social.listBlocked(), []);
  const [busyId, setBusyId] = useState(null);

  const unblock = async (row) => {
    setBusyId(row.rowId);
    try {
      await api.social.unblock(row.rowId);
      setData((list) => (list || []).filter((r) => r.rowId !== row.rowId));
      toast(`${row.user.name} ei ole enää estetty`, {
        icon: 'check',
        action: {
          label: 'Kumoa',
          onClick: () => api.social.block(row.user.id).then(() => reload({ silent: true })).catch((err) => toast(err)),
        },
      });
    } catch (err) {
      toast(err);
    } finally {
      setBusyId(null);
    }
  };

  let body;
  if (loading) body = <SkeletonList count={3} variant="row" />;
  else if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!rows?.length) {
    body = (
      <EmptyState
        art="players"
        title="Ei estettyjä profiileja"
        text="Jos joku ei käyttäydy, voit estää hänet hänen profiilistaan. Estetyt eivät näy sinulle."
        action={<Button variant="soft" icon="arrow-left" onClick={() => navigate('/pelaa/asetukset')}>Takaisin asetuksiin</Button>}
      />
    );
  } else {
    body = (
      <div className="list-group stagger">
        {rows.map((row, i) => (
          <ListRow
            key={row.rowId}
            style={{ '--i': i }}
            leading={<Avatar person={row.user} size={42} />}
            title={row.user.name}
            subtitle="Estetty"
            right={<Button variant="outline" size="sm" loading={busyId === row.rowId} onClick={() => unblock(row)}>Poista esto</Button>}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      <TopBar title="Estetyt profiilit" back="/pelaa/asetukset" />
      <Page className="profile-subpage">
        <p className="profile-blocked-intro">Estetyt pelaajat eivät näy pelaajalistallasi eivätkä voi pyytää sinua pelaamaan.</p>
        {body}
      </Page>
    </>
  );
}
