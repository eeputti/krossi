// Evästesuostumusbanneri — gate:aa Meta Pixelin lataamisen (ks. window.krossiLoadPixel index.html/app.html:ssä)
(function () {
  var CONSENT_KEY = 'krossi_cookie_consent';

  function getConsent() { return localStorage.getItem(CONSENT_KEY); }
  function setConsent(value) { localStorage.setItem(CONSENT_KEY, value); }

  function applyConsent(value) {
    if (value === 'accepted' && typeof window.krossiLoadPixel === 'function') {
      window.krossiLoadPixel();
    }
  }

  function renderBanner() {
    if (document.getElementById('krossi-cookie-banner')) return;
    var wrap = document.createElement('div');
    wrap.id = 'krossi-cookie-banner';
    wrap.setAttribute('style', [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:9999',
      'max-width:480px', 'margin:0 auto', 'background:#fff', 'color:#111111',
      'border:1px solid #e0ddd6', 'border-radius:16px', 'padding:18px 20px',
      'box-shadow:0 20px 50px -20px rgba(0,0,0,0.35)', 'font-family:inherit',
      'font-size:14px', 'line-height:1.5',
    ].join(';'));
    wrap.innerHTML =
      '<div style="margin-bottom:12px;">' +
        'Käytämme evästeitä kävijäanalytiikkaan ja markkinoinnin kohdentamiseen (Meta). ' +
        'Voit käyttää Krossia myös ilman näitä — kirjautuminen ei vaadi niitä. ' +
        '<a href="/pelaa" style="color:#0E3B2C;font-weight:700;">Lue lisää</a>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="krossi-cookie-reject" type="button" style="flex:1;padding:10px 14px;border-radius:10px;border:1.5px solid #d8d4ca;background:#fff;color:#111;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Vain välttämättömät</button>' +
        '<button id="krossi-cookie-accept" type="button" style="flex:1;padding:10px 14px;border-radius:10px;border:none;background:#0E3B2C;color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;">Hyväksy</button>' +
      '</div>';
    document.body.appendChild(wrap);
    document.getElementById('krossi-cookie-accept').onclick = function () {
      setConsent('accepted'); applyConsent('accepted'); wrap.remove();
    };
    document.getElementById('krossi-cookie-reject').onclick = function () {
      setConsent('rejected'); wrap.remove();
    };
  }

  window.krossiOpenCookieSettings = function () {
    var existing = document.getElementById('krossi-cookie-banner');
    if (existing) existing.remove();
    renderBanner();
  };

  function init() {
    var consent = getConsent();
    if (consent === 'accepted') { applyConsent('accepted'); return; }
    if (consent === 'rejected') { return; }
    renderBanner();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
