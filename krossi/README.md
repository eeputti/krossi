# Krossi

Krossi on tennissovellus, jolla löydät pelikavereita ja sovit pelit. Tämä kansio sisältää
Krossin pelaajapuolen. (Krossi Koutsi — valmennustuote osoitteessa koutsi.krossi.app — on
erillinen tuote ja elää repon juuressa omissa `koutsi*`-tiedostoissaan.)

```
krossi/
  web/       krossi.app — etusivu (landing/) ja selainsovellus /pelaa (src/). Prioriteetti nyt.
  ios/       iOS-sovellus (App Store)
  android/   Android-sovellus (Google Play)
```

Kaikki kolme käyttävät samaa Supabase-projektia (`hhybjpgrvlbazbqiaaao`), joten pelaajat,
pelit, viestit ja liigat näkyvät samoina kaikilla alustoilla.

- Web: ks. [web/ARCHITECTURE.md](web/ARCHITECTURE.md) — `npm run dev:krossi` → http://localhost:4400/demo
- Julkaisu: `npm run deploy:cloudflare` (repon juuresta; julkaisee sekä krossi.app:n että Koutsin)
