// Bridges course lesson videos to Cloudflare R2 instead of Supabase
// Storage (sql/079) — R2 charges nothing for egress, which matters
// here since lesson videos get streamed by every enrolled student,
// potentially rewatched. Uses aws4fetch (a small, dependency-free
// library built specifically for signing S3-compatible requests from
// edge runtimes like this one) rather than the full AWS SDK — the SDK
// pulls in a large Node-oriented dependency tree that doesn't reliably
// boot in Deno's edge environment; aws4fetch is the standard choice
// for R2 from exactly this kind of function. The browser never
// touches R2 credentials — it only ever gets a short-lived presigned
// URL from here, generated after this function has already
// re-checked permission server-side (same pattern as every other
// sensitive action in this app).
//
// Three actions, dispatched by `action` in the request body:
//   'upload_url'   — School Admin only. Returns a presigned PUT URL
//                     the browser uploads the file to directly (so a
//                     multi-GB video never has to pass through this
//                     function itself).
//   'playback_url' — Any enrolled student (or a School Admin). Checks
//                     course_enrollments before ever generating a URL,
//                     same enrollment gate the Supabase Storage path
//                     already enforces via RLS.
//   'delete'       — School Admin only. Deletes directly (no need to
//                     hand back a presigned URL for a server-side action).
//
// Deploy: Supabase Dashboard -> Edge Functions -> deploy this file as
// "course-video-r2". Needs four secrets — Dashboard -> Edge Functions
// -> course-video-r2 -> Secrets:
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UPLOAD_URL_TTL_SECONDS = 3600; // an hour to actually finish uploading a large file
const PLAYBACK_URL_TTL_SECONDS = 3600; // matches the existing Supabase Storage signed-URL TTL

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function sanitizeFilename(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.\-_]+/g, '-')
    .replace(/-+/g, '-');
}

function getR2({ accountId, accessKeyId, secretAccessKey, bucket }) {
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  return { client, endpoint };
}

async function presign(client, url, method, extraHeaders = {}) {
  const signed = await client.sign(url, {
    method,
    headers: extraHeaders,
    aws: { signQuery: true },
  });
  return signed.url;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    const accountId = Deno.env.get('R2_ACCOUNT_ID');
    const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
    const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const bucket = Deno.env.get('R2_BUCKET');
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      return json({ error: 'R2 is not configured on this function (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET)' }, 500);
    }
    const { client, endpoint } = getR2({ accountId, accessKeyId, secretAccessKey, bucket });

    const { action, lesson_id, file_name, content_type, object_key } = await req.json();

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_school_admin, global_role')
      .eq('id', caller.id)
      .single();
    const isSchoolAdmin = callerProfile?.is_school_admin || callerProfile?.global_role === 'super_admin';

    if (action === 'upload_url') {
      if (!isSchoolAdmin) return json({ error: 'Only a School Admin can upload lesson videos' }, 403);
      if (!lesson_id || !file_name) return json({ error: 'lesson_id and file_name are required' }, 400);

      const objectKey = `${lesson_id}/${Date.now()}-${sanitizeFilename(file_name)}`;
      const resolvedContentType = content_type || 'application/octet-stream';
      const url = new URL(`${endpoint}/${objectKey}`);
      url.searchParams.set('X-Amz-Expires', String(UPLOAD_URL_TTL_SECONDS));
      // Content-Type is part of the signature here, so the browser's
      // PUT must send this exact same header back (see
      // lessonEditorModal.js) — otherwise the signature won't match.
      const uploadUrl = await presign(client, url, 'PUT', { 'content-type': resolvedContentType });

      return json({ upload_url: uploadUrl, object_key: objectKey, content_type: resolvedContentType });
    }

    if (action === 'playback_url') {
      if (!lesson_id) return json({ error: 'lesson_id is required' }, 400);

      const { data: lesson } = await admin
        .from('lessons')
        .select('video_storage_path, video_provider, module_id, course_modules!module_id ( course_id )')
        .eq('id', lesson_id)
        .single();
      if (!lesson || lesson.video_provider !== 'r2' || !lesson.video_storage_path) {
        return json({ error: 'No R2 video found for this lesson' }, 404);
      }

      if (!isSchoolAdmin) {
        const { data: enrollment } = await admin
          .from('course_enrollments')
          .select('status')
          .eq('user_id', caller.id)
          .eq('course_id', lesson.course_modules.course_id)
          .eq('status', 'approved')
          .maybeSingle();
        if (!enrollment) return json({ error: 'Not enrolled in this course' }, 403);
      }

      const url = new URL(`${endpoint}/${lesson.video_storage_path}`);
      url.searchParams.set('X-Amz-Expires', String(PLAYBACK_URL_TTL_SECONDS));
      const playbackUrl = await presign(client, url, 'GET');

      return json({ url: playbackUrl });
    }

    if (action === 'delete') {
      if (!isSchoolAdmin) return json({ error: 'Only a School Admin can delete lesson videos' }, 403);
      if (!object_key) return json({ error: 'object_key is required' }, 400);

      const deleteResponse = await client.fetch(`${endpoint}/${object_key}`, { method: 'DELETE' });
      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        return json({ error: `R2 delete failed (HTTP ${deleteResponse.status})` }, 500);
      }
      return json({ deleted: true });
    }

    return json({ error: 'action must be "upload_url", "playback_url", or "delete"' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
