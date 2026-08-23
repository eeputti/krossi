// Deletes another Koutsi account on behalf of a database-authorised administrator.
// The service-role client is created only after the caller's JWT and koutsi_admins row
// have both been checked. The requested target id is never accepted as authority.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...CORS, 'content-type': 'application/json' } },
);

type ManifestFile = {
  bucket: string;
  path: string;
  size_bytes?: number;
};

type DeletionManifest = {
  user_id: string;
  email?: string | null;
  name?: string | null;
  is_coach?: boolean;
  is_player?: boolean;
  storage_bytes?: number;
  files?: ManifestFile[];
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let targetUserId = '';
  try {
    const body = await req.json();
    targetUserId = typeof body?.user_id === 'string' ? body.user_id : '';
  } catch {
    return json({ error: 'Virheellinen pyyntö.' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return json({ error: 'Käyttäjää ei löytynyt.' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: callerData, error: callerError } = await asUser.auth.getUser();
  if (callerError || !callerData?.user) return json({ error: 'Kirjaudu uudelleen sisään.' }, 401);

  // This SECURITY DEFINER RPC verifies koutsi_admins membership, prevents self-deletion
  // and protects every administrator account before exposing any target details.
  const { data: manifestData, error: manifestError } = await asUser.rpc(
    'koutsi_admin_user_deletion_manifest',
    { target_user_id_input: targetUserId },
  );
  if (manifestError || !manifestData) {
    return json({ error: manifestError?.message || 'Sinulla ei ole oikeutta tähän.' }, 403);
  }
  const manifest = manifestData as DeletionManifest;

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const filesByBucket = new Map<string, string[]>();
  for (const file of manifest.files || []) {
    if (!file?.bucket || !file?.path) continue;
    const paths = filesByBucket.get(file.bucket) || [];
    paths.push(file.path);
    filesByBucket.set(file.bucket, paths);
  }

  // Storage remove accepts a path list within one bucket. Small batches keep this safe
  // for established coaches with a long video history.
  for (const [bucket, paths] of filesByBucket) {
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
      if (error) return json({ error: `Tiedostojen poisto epäonnistui: ${error.message}` }, 500);
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
  if (deleteError) return json({ error: deleteError.message }, 500);

  const roles = [
    manifest.is_coach ? 'coach' : null,
    manifest.is_player ? 'player' : null,
  ].filter(Boolean);
  const { error: auditError } = await admin.from('koutsi_admin_deletions').insert({
    admin_id: callerData.user.id,
    admin_email: callerData.user.email || null,
    target_user_id: targetUserId,
    target_email: manifest.email || null,
    target_name: manifest.name || null,
    target_roles: roles,
    storage_bytes: manifest.storage_bytes || 0,
  });
  if (auditError) console.error('admin deletion audit failed', auditError.message);

  return json({ ok: true });
});
