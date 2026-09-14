// koutsi-delete-account — GDPR erasure endpoint called from the app's profile screen.
//
// Two steps that cannot both happen in the browser: delete_my_koutsi_data() runs as the
// caller (so RLS and auth.uid() still scope it to their own rows), then the auth.users
// row is removed with the service role. The caller's JWT is verified by the platform
// (verify_jwt), and the user id comes from that token — never from the request body — so
// this can only ever delete the account that called it.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;

  // acts as the signed-in user
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }
  const uid = userData.user.id;

  const { error: dataErr } = await asUser.rpc('delete_my_koutsi_data');
  if (dataErr) {
    return new Response(JSON.stringify({ error: dataErr.message }), {
      status: 500, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  // avatars live outside the tables delete_my_koutsi_data() clears
  const { data: avatarFiles } = await admin.storage.from('profile-avatars').list(uid);
  if (avatarFiles?.length) {
    await admin.storage.from('profile-avatars').remove(avatarFiles.map((f) => `${uid}/${f.name}`));
  }
  const { data: videoFiles } = await admin.storage.from('koutsi-videos').list(uid);
  if (videoFiles?.length) {
    await admin.storage.from('koutsi-videos').remove(videoFiles.map((f) => `${uid}/${f.name}`));
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    return new Response(JSON.stringify({ error: delErr.message }), {
      status: 500, headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, 'content-type': 'application/json' },
  });
});
