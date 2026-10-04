-- Korjaus: tapahtumat (challenges.challenge_type = 'event') eivät ole koskaan voineet
-- tallentua tuotantokantaan.
--
-- Fix: events (challenges.challenge_type = 'event') could never be stored in production.
--
-- 20260915130000_krossi_city_admins_and_events lisäsi tapahtumille INSERT-policyn
-- ("authenticated users can create challenges": challenge_type = 'event' AND
-- krossi_can_manage_city(city)) ja tarkistuksen challenges_event_requires_fields, mutta
-- jätti vanhan tyyppitarkistuksen ennalleen:
--   challenges_challenge_type_check  CHECK (challenge_type IN ('open', 'direct'))
-- Siksi jokainen tapahtuman luonti (uusi ja vanha web-sovellus) kaatuu
-- check_violation-virheeseen, eikä krossi_public_challenge_preview:n 'event'-haara tai
-- krossi-notify:n new_area_event-ilmoitus voi koskaan toteutua.
--
-- Tämä vain laajentaa sallittuja arvoja ('open', 'direct' säilyvät), joten kaikki
-- nykyiset rivit läpäisevät uuden tarkistuksen. Tapahtuman muut ehdot (kaupunki,
-- max_players >= 2, kaupungin admin) pysyvät ennallaan omissa tarkistuksissaan ja
-- policyssa. Koutsi ei lue eikä kirjoita public.challenges-taulua.
--
-- Pudotus ja lisäys samassa ALTER TABLE -lauseessa: ei hetkeä ilman tarkistusta.
alter table public.challenges
  drop constraint if exists challenges_challenge_type_check,
  add constraint challenges_challenge_type_check
    check (challenge_type in ('open', 'direct', 'event'));

-- Korjaus: Krossi tarjoaa kotikaupungeiksi myös Rovaniemen ja Mikkelin, mutta pelien
-- kaupunkitarkistus hylkäsi ne, joten niissä asuva pelaaja ei voinut luoda yhtään peliä.
-- Fix: the app offers Rovaniemi and Mikkeli as home cities but games there were rejected.
-- Vain sallittujen arvojen laajennus; nykyiset rivit läpäisevät tarkistuksen.
alter table public.challenges
  drop constraint if exists challenges_city_check,
  add constraint challenges_city_check
    check (city is null or city in ('Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio', 'Rovaniemi', 'Mikkeli'));
