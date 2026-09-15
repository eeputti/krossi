// Deletes another Krossi player account on behalf of a database-authorised administrator.
// The service-role client is created only after the caller's JWT and koutsi_admins row
// have both been checked. The requested target id is never accepted as authority.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// This is an admin-only account-deletion endpoint — no reason for it to be callable from
// an arbitrary origin. Echo back the origin only when it's the real app (or local dev).
const ALLOWED_ORIGINS = [
  'https://krossi.app',
  'https://www.krossi.app',
];
function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'access-control-allow-origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'Origin',
  };
}

const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders(req), 'content-type': 'application/json' } },
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
  storage_bytes?: number;
  files?: ManifestFile[];
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method not allowed' }, 405);

  let targetUserId = '';
  try {
    const body = await req.json();
    targetUserId = typeof body?.user_id === 'string' ? body.user_id : '';
  } catch {
    return json(req, { error: 'Virheellinen pyyntö.' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return json(req, { error: 'Käyttäjää ei löytynyt.' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: callerData, error: callerError } = await asUser.auth.getUser();
  if (callerError || !callerData?.user) return json(req, { error: 'Kirjaudu uudelleen sisään.' }, 401);

  // This SECURITY DEFINER RPC verifies koutsi_admins membership, prevents self-deletion
  // and protects every administrator account before exposing any target details.
  const { data: manifestData, error: manifestError } = await asUser.rpc(
    'krossi_admin_user_deletion_manifest',
    { target_user_id_input: targetUserId },
  );
  if (manifestError || !manifestData) {
    return json(req, { error: manifestError?.message || 'Sinulla ei ole oikeutta tähän.' }, 403);
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

  // Storage remove accepts a path list within one bucket.
  for (const [bucket, paths] of filesByBucket) {
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(index, index + 100));
      if (error) return json(req, { error: `Tiedostojen poisto epäonnistui: ${error.message}` }, 500);
    }
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
  if (deleteError) return json(req, { error: deleteError.message }, 500);

  const { error: auditError } = await admin.from('koutsi_admin_deletions').insert({
    admin_id: callerData.user.id,
    admin_email: callerData.user.email || null,
    target_user_id: targetUserId,
    target_email: manifest.email || null,
    target_name: manifest.name || null,
    target_roles: ['krossi_player'],
    storage_bytes: manifest.storage_bytes || 0,
  });
  if (auditError) console.error('admin deletion audit failed', auditError.message);

  return json(req, { ok: true });
});
