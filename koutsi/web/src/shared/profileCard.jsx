// profileCard.jsx — the card at the top of Profiili, for both roles. Two targets: the photo opens
// the photo menu (Valitse kuva / Ota uusi kuva), everything else opens Muokkaa profiilia.
import { navigate } from '../app/router.js';
import { Avatar, Icon } from '../ui/index.js';
import { useProfilePhoto } from './profilePhoto.jsx';

/**
 *   person, uid, editPath   lines: faint lines under the name (falsy ones are skipped)
 *   bio: the person's own words   addBio: the prompt shown instead when there are none
 *   extra: more under the bio (the coach's experience and specialties)
 */
export function ProfileCard({ person, uid, editPath, lines = [], bio, addBio, extra }) {
  const photo = useProfilePhoto({ uid, person });
  return (
    <div className="card card-default card-pad-md k-profile-card">
      <button type="button" className="k-avatar-edit" onClick={photo.open} disabled={photo.busy} aria-label="Vaihda profiilikuva">
        <Avatar person={person} size={72} ring />
        <span className="k-avatar-edit-badge"><Icon name="camera" size={14} /></span>
      </button>
      <button type="button" className="k-profile-main" onClick={() => navigate(editPath)}>
        <span className="k-profile-text">
          <span className="t-h2 k-profile-name">{person.name}</span>
          {lines.filter(Boolean).map((l) => <span key={l} className="k-faint">{l}</span>)}
          {bio ? <span className="k-profile-bio">{bio}</span> : <span className="k-profile-add"><Icon name="plus" size={14} /> {addBio}</span>}
          {extra}
        </span>
        <span className="k-profile-edit" aria-hidden="true"><Icon name="edit" size={18} /></span>
        <span className="sr-only">Muokkaa profiilia</span>
      </button>
      {photo.sheets}
    </div>
  );
}
