// emailPrefs.js — which Koutsi e-mails a person can turn off one by one (Profiili → Sähköpostit).
// The ids are the categories the database knows (public.koutsi_email_category): an e-mail whose
// category is in koutsi_notification_prefs.email_off is not sent; the bell in the app still shows it.

export const EMAIL_CHOICES = {
  player: [
    { id: 'valmentaja', label: 'Valmentajan huomiot, kotiläksyt ja videot' },
    { id: 'tiedotteet', label: 'Tiedotteet', hint: 'Käytännön asiat, esim. vaihtuva kenttä' },
    { id: 'treenit', label: 'Treenien muutokset', hint: 'Uudet, siirretyt ja perutut treenit' },
    { id: 'muistutus', label: 'Muistutus treenipäivän aamuna', hint: 'Aika, teema ja paikka' },
    { id: 'mitenmeni', label: 'Miten meni? treenin jälkeen', hint: 'Fiilis yhdellä napautuksella ja toive valmentajalle' },
    // Vapaat ajat: shown only to a player whose coach has published free times for them (`only`)
    { id: 'vapaat', label: 'Vapaat ajat', hint: 'Kun valmentajasi julkaisee vapaita aikoja', only: 'openSlots' },
  ],
  coach: [
    { id: 'poissaolot', label: 'Pelaajien poissaolot', hint: 'Kun pelaaja ilmoittaa, ettei pääse treeniin' },
    { id: 'ottelut', label: 'Pelaajien ottelumuistiinpanot' },
  ],
};

/** The list of turned-off categories after switching one on (true) or off (false). */
export function withChoice(off, id, on) {
  const set = new Set(off || []);
  if (on) set.delete(id); else set.add(id);
  return [...set].sort();
}
