// Site Admin "Churches" tab: R2 storage usage, attributed per tenant.
// Supabase Storage usage is computed entirely in SQL instead
// (list_all_tenants_for_site_admin(), sql/060) since storage.objects
// is a real, queryable Postgres table -- R2 is the one piece that
// genuinely needs an Edge Function, since it lives outside Postgres
// entirely and has to be listed via the S3 API.
//
// Two R2 "areas" today, both read from the one shared R2_BUCKET secret
// (Supabase Edge Function secrets are project-wide, not per-function --
// course-video-r2 and offering-reports already read the exact same
// R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET this
// function does, with nothing new to configure):
//   - course videos: keys are `${lesson_id}/...` -- attributed via a
//     join through `lessons.tenant_id`.
//   - offering report PDFs: keys are `${tenant_id}/${period_id}.pdf`
//     (or `main/...` for a single-tenant DB) -- attributed directly
//     from the key's own prefix.
// Told apart by key shape (a lesson id vs. a tenant id/"main"), not by
// which secret found them, since they're the same bucket either way.
//
// Auth: JWT-authenticated, re-checks is_site_admin() server-side via
// the service-role client (same "never trust the client" pattern as
// offering-reports' resolveFinanceCaller) -- there is no cron/shared-
// secret path here, this is only ever called from the Site Admin
// dashboard by a signed-in person.
//
// Deploy: `supabase functions deploy site-admin-usage --no-verify-jwt`.
// No new secrets needed -- R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/
// R2_SECRET_ACCESS_KEY/R2_BUCKET and RESEND_API_KEY are already set
// project-wide from course-video-r2/offering-reports.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const FINANCE_OVERSIGHT_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function getR2(bucket) {
  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  return { client, endpoint };
}

// Lists every object in a bucket via S3 ListObjectsV2, following
// continuation tokens -- returns [{ key, size }].
async function listAllObjects(r2) {
  const objects = [];
  let continuationToken = null;
  do {
    const url = new URL(r2.endpoint);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('max-keys', '1000');
    if (continuationToken) url.searchParams.set('continuation-token', continuationToken);
    const resp = await r2.client.fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`R2 list failed: ${await resp.text()}`);
    const xml = await resp.text();

    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1];
      const key = block.match(/<Key>(.*?)<\/Key>/)?.[1];
      const size = block.match(/<Size>(\d+)<\/Size>/)?.[1];
      if (key && size) objects.push({ key: decodeXmlEntities(key), size: Number(size) });
    }
    const isTruncated = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/)?.[1] === 'true';
    continuationToken = isTruncated ? xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1] : null;
  } while (continuationToken);
  return objects;
}

function decodeXmlEntities(str) {
  return str.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'");
}

// A website_inquiries submitter is anonymous (no account, pre-signup
// lead) -- there's no in-app notification to send them, so a reply
// has to go out by email instead. Reuses the exact Resend call shape
// already proven in offering-reports' retention email.
async function replyToInquiry(admin, body) {
  const { inquiry_id, reply } = body;
  if (!inquiry_id || !reply) return { error: 'inquiry_id and reply are required', status: 400 };

  const { data: inquiry, error: inquiryError } = await admin
    .from('website_inquiries').select('name, email, topic').eq('id', inquiry_id).maybeSingle();
  if (inquiryError) return { error: inquiryError.message, status: 500 };
  if (!inquiry) return { error: 'Inquiry not found', status: 404 };

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return { error: 'RESEND_API_KEY is not configured on this function', status: 500 };
  const fromAddress = Deno.env.get('OFFERING_EMAIL_FROM') || Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';

  const html = `
    <p>Hi ${escapeHtml(inquiry.name || '')},</p>
    <p>${escapeHtml(reply).replaceAll('\n', '<br>')}</p>
  `;
  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress, to: [inquiry.email], subject: 'Re: your message to ChurchOnPoint', html }),
  });
  if (!resendResp.ok) return { error: `Email send failed: ${await resendResp.text()}`, status: 502 };

  await admin.from('website_inquiries').update({ site_admin_reply: reply, replied_at: new Date().toISOString() }).eq('id', inquiry_id);
  return { success: true };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  let body = {};
  try { body = await req.json(); } catch { /* usage has no body */ }

  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!jwt) return json({ error: 'Missing authorization' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
  if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

  const { data: isSiteAdmin } = await admin.from('platform_admins').select('user_id').eq('user_id', caller.id).maybeSingle();
  if (!isSiteAdmin) return json({ error: 'Only a Site Admin can do this' }, 403);

  if (body.action === 'reply_to_inquiry') {
    const result = await replyToInquiry(admin, body);
    if (result.error) return json({ error: result.error }, result.status);
    return json(result);
  }

  const byTenant = {};
  let unattributedBytes = 0;

  function addBytes(tenantId, bytes) {
    if (!tenantId) { unattributedBytes += bytes; return; }
    byTenant[tenantId] = (byTenant[tenantId] || 0) + bytes;
  }

  // One shared bucket holds both course-video-r2's `${lesson_id}/...`
  // keys and offering-reports' `${tenant_id}/${period_id}.pdf` (or
  // `main/...`) keys, mixed together -- told apart per object by
  // checking its first path segment against both lessons and tenants,
  // not by which secret found it (there's only the one R2_BUCKET).
  const r2 = getR2(Deno.env.get('R2_BUCKET'));
  if (r2) {
    const objects = await listAllObjects(r2);
    const firstSegments = [...new Set(objects.map((o) => o.key.split('/')[0]))];

    const { data: lessons } = await admin.from('lessons').select('id, tenant_id').in('id', firstSegments);
    const tenantByLesson = new Map((lessons || []).map((l) => [l.id, l.tenant_id]));

    const { data: tenants } = await admin.from('tenants').select('id').in('id', firstSegments);
    const tenantIds = new Set((tenants || []).map((t) => t.id));

    for (const o of objects) {
      const prefix = o.key.split('/')[0];
      if (tenantByLesson.has(prefix)) addBytes(tenantByLesson.get(prefix), o.size);
      else if (tenantIds.has(prefix)) addBytes(prefix, o.size);
      else addBytes(null, o.size); // "main" (single-tenant offering-reports) or unrecognized
    }
  }

  const platformTotal = Object.values(byTenant).reduce((sum, b) => sum + b, 0) + unattributedBytes;
  return json({ byTenant, unattributedBytes, platformTotal });
});
