-- Captured from production history: applied directly to the database, no local file
-- existed for it yet.

-- Aiempi "revoke update (paid_at, stripe_customer_id) ... from authenticated" ei tehonnut,
-- koska Postgres antaa taulutason UPDATE-oikeuden ohittaa sarakekohtaiset revoket.
-- Oikea tapa: revoke koko taulun UPDATE ja myönnä se vain nimetyille, käyttäjän aidosti
-- muokkaamille sarakkeille (todennettu app-koodin update/upsert-kutsuista).
revoke update on public.profiles from authenticated, anon;
grant update (id, name, age, gender, area, bio, avatar_url, hidden_from_feed, playing_this_week, is_discoverable)
  on public.profiles to authenticated;
