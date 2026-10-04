// AdminUserCard — one user in Ylläpito: summary row that expands to details, event rights and deletion.
import { useState } from 'react';
import { Avatar, Button, Chip, ChipSelect, Icon } from '../../ui/index.js';
import { CITIES } from '../../lib/constants.js';
import { firstName, plural } from '../../lib/format.js';
import { ago, shortDate, toneFor } from './adminData.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const CITY_OPTIONS = CITIES.map((c) => ({ value: c, label: c }));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** What the right side shows depends on the active sort, so the list reads like a ranking. */
function sideInfo(user, sort) {
  if (sort === 'signin') return { value: ago(user.lastSignInAt), caption: 'kirjautui' };
  if (sort === 'opens') return { value: `${user.appOpenCount}×`, caption: 'avauksia' };
  return { value: dayLabel(user.joinedAt), caption: 'liittyi' };
}

/** 18.9. this year, 18.9.2025 before that. */
function dayLabel(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.getFullYear() === new Date().getFullYear() ? `${d.getDate()}.${d.getMonth() + 1}.` : shortDate(iso);
}

/**
 * AdminUserCard
 *   user: AdminUser, sort: current sort key, isSelf: the signed-in admin
 *   open / onToggle: expanded state (controlled by the list so only one is open at a time)
 *   onSaveCities(user, cities) -> Promise<boolean>, onDelete(user) -> Promise<boolean>  (never reject)
 */
export function AdminUserCard({ user, sort, isSelf, open, onToggle, onSaveCities, onDelete, index = 0 }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(user.adminCities);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const name = user.name || 'Nimetön pelaaja';
  const side = sideInfo(user, sort);
  const canManage = !user.isAdmin && !isSelf;
  const dirty = !sameSet(draft, user.adminCities);
  const bodyId = `admin-user-${user.id}`;

  const startEdit = () => { setDraft(user.adminCities); setEditing(true); };
  const cancelEdit = () => { setDraft(user.adminCities); setEditing(false); };
  // The parent toasts errors and resolves to true/false, so nothing rejects here.
  const save = async () => {
    setSaving(true);
    const ok = await onSaveCities(user, draft);
    setSaving(false);
    if (ok) setEditing(false);
  };
  const remove = async () => {
    setDeleting(true);
    await onDelete(user);
    setDeleting(false);
  };

  return (
    <article className={cx('admin-user', open && 'is-open')} style={{ '--i': index }}>
      <button type="button" className="admin-user-head" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}>
        <Avatar name={name} color={toneFor(user.id)} size={44} />
        <span className="admin-user-main">
          <span className="admin-user-name truncate">{name}</span>
          <span className="admin-user-email truncate">
            {user.email || 'ei sähköpostia'}
            {user.area ? ` · ${user.area}` : ''}
          </span>
        </span>
        <span className="admin-user-side">
          <span className="admin-user-side-value t-num">{side.value}</span>
          <span className="admin-user-side-caption">{side.caption}</span>
        </span>
        <Icon name="chevron-down" size={18} className="admin-user-chevron" />
        {(isSelf || user.isAdmin || user.adminCities.length > 0 || user.hiddenFromFeed || user.paidAt) && (
          <span className="admin-user-chips">
            {isSelf && <Chip size="sm" tone="outline">Sinä</Chip>}
            {user.isAdmin && <Chip size="sm" tone="green" icon="shield">Ylläpitäjä</Chip>}
            {user.adminCities.length > 0 && (
              <Chip size="sm" tone="lime" icon="flag" className="admin-user-chip-cities">
                <span className="truncate">Tapahtuma-admin: {user.adminCities.join(', ')}</span>
              </Chip>
            )}
            {user.paidAt && <Chip size="sm" tone="success" icon="check">Maksanut</Chip>}
            {user.hiddenFromFeed && <Chip size="sm" tone="neutral" icon="eye-off">Piilotettu</Chip>}
          </span>
        )}
      </button>

      {open && (
        <div className="admin-user-body" id={bodyId}>
          <dl className="admin-user-facts">
            <div><dt>Liittyi</dt><dd>{shortDate(user.joinedAt)}</dd></div>
            <div><dt>Kirjautunut</dt><dd>{ago(user.lastSignInAt)}</dd></div>
            <div>
              <dt>Avannut</dt>
              <dd>{user.appOpenCount}×{user.appOpenCount > 0 ? <span className="admin-user-fact-sub"> · {ago(user.lastAppOpenAt)}</span> : null}</dd>
            </div>
            <div><dt>Luonut</dt><dd>{plural(user.challengesCreated, 'peli', 'peliä')}</dd></div>
            <div><dt>Tuloksia</dt><dd className="t-num">{user.matchesRecorded}</dd></div>
            <div><dt>Maksanut</dt><dd>{user.paidAt ? shortDate(user.paidAt) : 'ei'}</dd></div>
          </dl>

          {!canManage && (
            <p className="admin-user-note">
              <Icon name="shield" size={16} />
              {isSelf ? 'Tämä on oma tilisi.' : 'Ylläpitäjällä on jo kaikki oikeudet, eikä tiliä voi poistaa täältä.'}
            </p>
          )}

          {canManage && editing && (
            <div className="admin-user-cities">
              <div className="admin-user-cities-head">
                <span className="admin-user-cities-title">Tapahtuma-oikeudet</span>
                <span className="admin-user-cities-hint">
                  {draft.length ? `${firstName(name)} voi luoda tapahtumia: ${draft.length} kaupunki${draft.length === 1 ? '' : 'a'}` : `Valitse kaupungit, joihin ${firstName(name)} saa luoda tapahtumia.`}
                </span>
              </div>
              <ChipSelect multiple size="sm" options={CITY_OPTIONS} value={draft} onChange={setDraft} ariaLabel="Tapahtuma-oikeuksien kaupungit" />
              <div className="admin-user-actions">
                <Button variant="dark" size="sm" icon="check" loading={saving} disabled={!dirty} onClick={save}>Tallenna</Button>
                <Button variant="ghost" size="sm" disabled={saving} onClick={cancelEdit}>Peruuta</Button>
                {draft.length > 0 && (
                  <button type="button" className="admin-user-clear" disabled={saving} onClick={() => setDraft([])}>Poista kaikki</button>
                )}
              </div>
            </div>
          )}

          {canManage && !editing && (
            <div className="admin-user-actions">
              <Button variant="soft" size="sm" icon="flag" onClick={startEdit}>Muokkaa tapahtuma-oikeuksia</Button>
              <Button variant="ghost" size="sm" icon="trash" className="admin-user-delete" loading={deleting} onClick={remove}>Poista tili</Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
