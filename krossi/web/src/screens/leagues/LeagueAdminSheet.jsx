// LeagueAdminSheet — "Ylläpito" for the league's admin (creator) and Krossi moderators:
// who may do what, the league's details (name; hallisarja: venue, rules, public standings),
// players (remove), end the season, delete the league.
//   <LeagueAdminSheet open onClose league meId onChanged onDeleted />
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { appUrl } from '../../app/router.js';
import { firstName, plural } from '../../lib/format.js';
import { Avatar, Button, Chip, Field, Icon, IconButton, Input, Sheet, Textarea, Toggle, useConfirm, useShare, useToast } from '../../ui/index.js';
import { isHallisarja, leaguePhase, levelLabel } from './leagueUtils.js';

export function LeagueAdminSheet({ open, onClose, league, meId, onChanged, onDeleted }) {
  const toast = useToast();
  const confirm = useConfirm();
  const shareLink = useShare();
  const [busy, run] = useBusy();
  const [removing, setRemoving] = useState(null);
  const hall = isHallisarja(league);
  const phase = leaguePhase(league);
  const kind = hall ? 'sarja' : 'liiga';
  const [form, setForm] = useState({ seasonLabel: '', venue: '', description: '', isPublic: false });

  useEffect(() => {
    if (!open || !league) return;
    setForm({ seasonLabel: league.seasonLabel || '', venue: league.venue || '', description: league.description || '', isPublic: Boolean(league.isPublic) });
  }, [open, league?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!league) return null;
  const iCreated = league.createdBy === meId;
  const dirty = form.seasonLabel.trim() !== league.seasonLabel
    || (form.venue.trim() || null) !== (league.venue || null)
    || (form.description.trim() || null) !== (league.description || null)
    || form.isPublic !== Boolean(league.isPublic);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e?.target ? e.target.value : e }));

  const save = () => run(async () => {
    if (!form.seasonLabel.trim()) { toast('Anna nimi.'); return; }
    try {
      await api.leagues.update(league.id, form);
      toast('Tiedot tallennettu.', { icon: 'check-circle' });
      onChanged?.();
    } catch (err) {
      toast(err);
    }
  });

  // A player can leave the league's list when no running group depends on them.
  const removable = (m) => league.status === 'signup' || m.groupNumber == null || (hall && phase === 'between');

  const removeMember = async (m) => {
    const ok = await confirm({
      title: `Poistetaanko ${firstName(m.name)}?`,
      message: hall
        ? `${m.name} poistuu sarjasta. Pelatut ottelut ja tulokset jäävät kierrosten taulukoihin.`
        : `${m.name} poistuu liigan ilmoittautuneista.`,
      confirmLabel: 'Poista pelaaja',
      danger: true,
    });
    if (!ok) return;
    setRemoving(m.id);
    try {
      await api.leagues.removeMember(league.id, m.id);
      toast(`${firstName(m.name)} poistettu.`);
      onChanged?.();
    } catch (err) {
      toast(err);
    } finally {
      setRemoving(null);
    }
  };

  const finish = async () => {
    const ok = await confirm({
      title: 'Päätetäänkö kausi?',
      message: `${hall && phase === 'round' ? `Kierros ${league.currentRound} päättyy samalla. ` : ''}Tuloksia ei voi enää ilmoittaa, ja lopullinen sarjataulukko jää näkyviin.`,
      confirmLabel: 'Päätä kausi',
    });
    if (!ok) return;
    run(async () => {
      try {
        await api.leagues.finish(league.id);
        toast('Kausi päätetty. Kiitos kaudesta! 🏆', { icon: 'trophy' });
        onChanged?.();
        onClose?.();
      } catch (err) {
        toast(err);
      }
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Poistetaanko ${kind} pysyvästi?`,
      message: `${league.seasonLabel} poistuu kaikilta: pelaajat, lohkot, ottelut ja tulokset. Tätä ei voi perua.`,
      confirmLabel: `Poista ${kind}`,
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      try {
        await api.leagues.remove(league.id);
        onDeleted?.();
      } catch (err) {
        toast(err);
      }
    });
  };

  const sharePublic = () => shareLink({
    title: `Sarjataulukko: ${league.seasonLabel}`,
    text: `${league.seasonLabel}, ${league.city} — lohkot ja tulokset`,
    url: appUrl(`/pelaa/liiga/${league.id}`),
  });

  return (
    <Sheet open={open} onClose={onClose} title="Ylläpito" subtitle={league.seasonLabel} size="lg">
      <div className="leagues-adm">
        <div className="leagues-adm-role">
          <span className="leagues-admin-badge" aria-hidden="true"><Icon name="shield" size={18} /></span>
          <p>
            {iCreated
              ? <>Olet {hall ? 'sarjan' : 'liigan'} perustajana sen <strong>ylläpitäjä</strong>. Vain sinä tai Krossin moderaattori voi poistaa {hall ? 'sarjan' : 'liigan'}.</>
              : <>Olet <strong>Krossin moderaattori</strong>. {firstName(league.organizer?.name) || 'Perustaja'} on {hall ? 'sarjan' : 'liigan'} ylläpitäjä; voit muokata ja poistaa sen.</>}
          </p>
        </div>

        <section className="leagues-adm-section">
          <h3 className="leagues-adm-title">Tiedot</h3>
          <Field label={hall ? 'Sarjan nimi' : 'Kauden nimi'} htmlFor="league-adm-name">
            <Input id="league-adm-name" value={form.seasonLabel} maxLength={60} onChange={set('seasonLabel')} />
          </Field>
          {hall && (
            <>
              <Field label="Pelipaikka" optional htmlFor="league-adm-venue">
                <Input id="league-adm-venue" value={form.venue} maxLength={120} placeholder="esim. Kispi-areena tai Janus-areena" onChange={set('venue')} />
              </Field>
              <Field label="Säännöt ja lisätiedot" optional htmlFor="league-adm-desc" hint="Näkyy kaikille pelaajille sarjan sivulla.">
                <Textarea id="league-adm-desc" value={form.description} maxLength={2000} rows={4} onChange={set('description')} />
              </Field>
              <Toggle
                checked={form.isPublic}
                onChange={set('isPublic')}
                icon="eye"
                label="Julkinen sarjataulukko"
                hint='Kuka tahansa linkin saanut näkee lohkot ja tulokset ilman tiliä (nimet muodossa "Mikko V."). Sopii hallin nettisivuille.'
              />
              {league.isPublic && (
                <Button variant="outline" size="sm" icon="link" onClick={sharePublic}>Jaa julkinen linkki</Button>
              )}
            </>
          )}
          <Button variant="dark" icon="check" loading={busy} disabled={!dirty} onClick={save}>Tallenna tiedot</Button>
        </section>

        <section className="leagues-adm-section">
          <h3 className="leagues-adm-title">Pelaajat <span className="leagues-section-count t-num">{league.members.length}</span></h3>
          {league.members.length === 0 ? (
            <p className="leagues-adm-help">Ei vielä pelaajia — jaa linkki.</p>
          ) : (
            <ul className="leagues-adm-members">
              {league.members.map((m) => (
                <li key={m.id} className="leagues-adm-member">
                  <Avatar person={m} size={34} />
                  <span className="leagues-adm-member-text">
                    <span className="leagues-adm-member-name truncate">{m.name}{m.id === meId ? ' (sinä)' : ''}</span>
                    <span className="leagues-adm-member-sub">
                      {m.skillLevel ? levelLabel(m.skillLevel) : 'Taso ei tiedossa'}
                      {hall && m.continues === false ? ', ei jatka' : ''}
                      {hall && league.status !== 'signup' && m.groupNumber == null ? ', odottaa lohkoa' : ''}
                    </span>
                  </span>
                  {m.id === league.createdBy && <Chip tone="lime" size="sm" icon="crown">Ylläpitäjä</Chip>}
                  <IconButton
                    icon="trash"
                    label={`Poista ${m.name}`}
                    size="sm"
                    disabled={!removable(m) || removing === m.id}
                    onClick={() => removeMember(m)}
                  />
                </li>
              ))}
            </ul>
          )}
          {league.status === 'active' && (
            <p className="leagues-adm-help">
              {hall
                ? 'Käynnissä olevan kierroksen lohkosta ei voi poistaa pelaajaa. Kirjaa hänen jäljellä olevat ottelunsa luovutuksiksi ja poista hänet kierroksen jälkeen.'
                : 'Kauden aikana pelaajia ei voi poistaa. Kirjaa jäljellä olevat ottelut luovutuksiksi.'}
            </p>
          )}
        </section>

        {league.status === 'active' && (
          <section className="leagues-adm-section">
            <h3 className="leagues-adm-title">Kausi</h3>
            <p className="leagues-adm-help">
              {hall
                ? `${plural(league.currentRound, 'kierros', 'kierrosta')} pelattu tai käynnissä. Päätä kausi viimeisen kierroksen jälkeen.`
                : 'Päätä kausi, kun ottelut on pelattu. Lopullinen sarjataulukko jää näkyviin.'}
            </p>
            <Button variant="outline" icon="flag" disabled={busy} onClick={finish}>Päätä kausi</Button>
          </section>
        )}

        <section className="leagues-adm-section is-danger">
          <h3 className="leagues-adm-title">Poista {kind}</h3>
          <p className="leagues-adm-help">Poistaa {hall ? 'sarjan' : 'liigan'} kaikkine pelaajineen, otteluineen ja tuloksineen. Tätä ei voi perua.</p>
          <Button variant="danger" icon="trash" disabled={busy} onClick={remove}>Poista {kind}</Button>
        </section>
      </div>
    </Sheet>
  );
}
