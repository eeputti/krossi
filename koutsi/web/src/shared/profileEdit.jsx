// profileEdit.jsx — the frame of the "Muokkaa profiilia" page both roles share: the photo on top
// (a tap opens Valitse kuva / Ota uusi kuva), the role's own field cards, Tallenna at the top and
// bottom, and a "Hylätäänkö muutokset?" question before leaving with unsaved changes.
import { useEffect, useRef } from 'react';
import { goBack } from '../app/router.js';
import { Avatar, Button, ChipSelect, Field, Icon, Page, Spinner, TopBar, useConfirm } from '../ui/index.js';
import { AREA_OPTIONS } from '../lib/constants.js';
import { useProfilePhoto } from './profilePhoto.jsx';

export function EditCard({ title, icon, children }) {
  return (
    <section className="profile-edit-card">
      <h2 className="profile-edit-title">
        <span className="profile-edit-title-icon"><Icon name={icon} size={16} /></span>
        {title}
      </h2>
      <div className="profile-edit-fields">{children}</div>
    </section>
  );
}

/** Characters left, shown under a long text field. */
export function Counter({ value, max }) {
  const left = max - String(value || '').length;
  return <span className={`profile-edit-counter t-num${left < 30 ? ' is-low' : ''}`} aria-live="polite">{String(value || '').length}/{max}</span>;
}

/**
 * Home town as chips. The list is the sign-up's; a town written elsewhere (Krossi) stays
 * selectable. Once set it can be changed but not cleared — Krossi needs one.
 */
export function AreaField({ value, onChange }) {
  const options = [...AREA_OPTIONS, ...(value && !AREA_OPTIONS.includes(value) ? [value] : [])].map((a) => ({ value: a, label: a }));
  return (
    <Field label="Kotikaupunki">
      <ChipSelect ariaLabel="Kotikaupunki" options={options} value={value} onChange={(v) => v && onChange(v)} size="sm" />
    </Field>
  );
}

/**
 *   person, uid: whose photo   back: the profile page   photoText: a line under the photo
 *   dirty, canSave, busy, onSave   children: the EditCards
 */
export function ProfileEditPage({ person, uid, back, photoText, dirty, canSave = true, missing = null, busy, onSave, children }) {
  // nothing changed: nothing to save (grey); changed but not valid: the button says what to fix
  const why = dirty && !canSave ? missing || 'Tarkista punaisella merkityt kentät.' : null;
  const confirm = useConfirm();
  const photo = useProfilePhoto({ uid, person });
  const saved = useRef(false);
  const leavingTo = useRef(null); // set while we take that entry back on the way out
  const asking = useRef(false);   // a "Hylätäänkö?" is open: its own Back entry comes and goes

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { if (!saved.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const ask = async () => {
    asking.current = true;
    const ok = await confirm({
      title: 'Hylätäänkö muutokset?',
      message: 'Et ole tallentanut muutoksiasi. Jos poistut nyt, ne menetetään.',
      confirmLabel: 'Hylkää', cancelLabel: 'Jatka muokkausta', danger: true,
    });
    // the dialog takes its own history entry away just after it closes; wait for that
    await new Promise((r) => setTimeout(r, 700));
    asking.current = false;
    return ok;
  };
  // Out of the page: first our own entry (if it is on top), then the page itself.
  const exit = () => {
    if (window.history.state?.pageGuard) {
      leavingTo.current = back;
      window.history.back();
    } else goBack(back);
  };
  // Lives as long as the page (saving can turn `dirty` off before we are out).
  useEffect(() => {
    const onPop = () => {
      if (!leavingTo.current) return;
      const to = leavingTo.current;
      leavingTo.current = null;
      goBack(to);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // The phone's Back (or a swipe) with unsaved changes asks first, like the ✕ of a form does.
  useEffect(() => {
    if (!dirty) return undefined;
    const id = `pe-${Date.now().toString(36)}`;
    const pushGuard = () => window.history.pushState({ ...(window.history.state || {}), pageGuard: id }, '', window.location.href);
    pushGuard();
    const onPop = async () => {
      if (leavingTo.current || asking.current || saved.current) return;
      const st = window.history.state || {};
      if (st.pageGuard === id || st.sheetGuard) return;
      pushGuard(); // stay on the page while asking
      if (await ask()) { saved.current = true; exit(); }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // changes undone: take the entry back so the next Back is not a dead tap
      if (!saved.current && !leavingTo.current && window.history.state?.pageGuard === id) window.history.back();
    };
  }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = async () => {
    if (dirty && !saved.current) {
      if (!(await ask())) return;
      saved.current = true;
    }
    exit();
  };
  const save = async () => {
    if (!canSave || busy) return;
    const ok = await onSave();
    if (ok) { saved.current = true; exit(); }
  };

  return (
    <>
      <TopBar title="Muokkaa profiilia" onBack={leave}
        actions={<Button variant="dark" size="sm" loading={busy} disabled={!dirty} missing={why} onClick={save}>Tallenna</Button>} />
      <Page className="k-page-pad profile-edit">
        <div className="profile-edit-photo">
          <button type="button" className="profile-edit-avatar" onClick={photo.open} disabled={photo.busy} aria-label="Vaihda profiilikuva">
            <Avatar person={person} size={112} />
            <span className="profile-edit-avatar-badge">{photo.busy ? <Spinner size={16} /> : <Icon name="camera" size={18} />}</span>
          </button>
          <Button variant="soft" size="sm" icon="camera" onClick={photo.open} disabled={photo.busy}>
            {person?.avatarUrl ? 'Vaihda kuva' : 'Lisää kuva'}
          </Button>
          {photoText && <p className="profile-edit-photo-sub">{photoText}</p>}
        </div>
        {children}
        <div className="profile-edit-bottom">
          <Button variant="dark" size="lg" block icon="check" loading={busy} disabled={!dirty} missing={why} onClick={save}>Tallenna muutokset</Button>
        </div>
      </Page>
      {photo.sheets}
    </>
  );
}
