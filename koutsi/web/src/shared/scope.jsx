// scope.jsx — who a form opened from a session or a group is for, on top of the form: the group
// (or player) as a dark card and a line like "Pe 23.10. klo 17:00 · 6 paikalla ollutta pelaajaa".
// scope: { name, text, icon? }
import { Icon } from '../ui/index.js';

export function ScopeLine({ scope }) {
  if (!scope) return null;
  return (
    <div className="k-scope">
      <span className="k-scope-label">Vain {scope.icon === 'user' ? 'tälle pelaajalle' : 'tälle ryhmälle'}</span>
      <span className="k-scope-row">
        <span className="k-scope-pill"><Icon name={scope.icon || 'users'} size={14} />{scope.name}</span>
        {scope.text && <span className="k-scope-text">{scope.text}</span>}
      </span>
    </div>
  );
}

/** The same players, in any order. */
export const sameIds = (a = [], b = []) => a.length === b.length && a.every((id) => b.includes(id));
