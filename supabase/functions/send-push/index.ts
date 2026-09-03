// Sends Web Push notifications to a department's approved members, or
// to everyone (sql/078). Re-derives the recipient list and re-checks
// permission server-side — never trusts a client-supplied user list —
// same pattern as every other sensitive action in this app.
//
// Deploy: Supabase Dashboard -> Edge Functions -> deploy this file as
// "send-push" (or `supabase functions deploy send-push`). Needs two
// secrets set manually — Dashboard -> Edge Functions -> send-push ->
// Secrets -> VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Generate a pair
// with `npx web-push generate-vapid-keys`; the public half must also
// be pasted into js/pushNotifications.js (VAPID_PUBLIC_KEY) — it's not
// a secret, it just has to match on both sides.
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GLOBAL_REACH_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
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

    const { department_id, global: isGlobal, title, body } = await req.json();
    if (!title) return json({ error: 'title is required' }, 400);

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('global_role, can_post_global_announcements')
      .eq('id', caller.id)
      .single();
    const hasGlobalReach = GLOBAL_REACH_ROLES.includes(callerProfile?.global_role) || !!callerProfile?.can_post_global_announcements;

    let targetUserIds = [];

    if (department_id) {
      const { data: callerMembership } = await admin
        .from('department_memberships')
        .select('role')
        .eq('department_id', department_id)
        .eq('user_id', caller.id)
        .eq('status', 'approved')
        .maybeSingle();
      const isDeptPoster = ['admin', 'secretary'].includes(callerMembership?.role);
      if (!isDeptPoster && !hasGlobalReach) return json({ error: 'Not allowed to notify this department' }, 403);

      const { data: members } = await admin
        .from('department_memberships')
        .select('user_id')
        .eq('department_id', department_id)
        .eq('status', 'approved');
      targetUserIds = (members ?? []).map((m) => m.user_id);
    } else if (isGlobal) {
      if (!hasGlobalReach) return json({ error: 'Not allowed to send a church-wide notification' }, 403);
      const { data: everyone } = await admin.from('profiles').select('id').is('removed_at', null);
      targetUserIds = (everyone ?? []).map((p) => p.id);
    } else {
      return json({ error: 'Specify department_id or global' }, 400);
    }

    if (targetUserIds.length === 0) return json({ sent: 0, failed: 0 });

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', targetUserIds);

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
    if (!vapidPublic || !vapidPrivate) return json({ error: 'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured on this function' }, 500);
    webpush.setVapidDetails('mailto:admin@eglisevpd.com', vapidPublic, vapidPrivate);

    const payload = JSON.stringify({ title, body: body ?? '', url: './' });

    let sent = 0;
    let failed = 0;
    const staleIds = [];

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        failed++;
        // 404/410 means the browser dropped this subscription (uninstalled,
        // permission revoked, etc.) — stop trying to reach it.
        if (err?.statusCode === 404 || err?.statusCode === 410) staleIds.push(sub.id);
      }
    }

    if (staleIds.length > 0) await admin.from('push_subscriptions').delete().in('id', staleIds);

    return json({ sent, failed });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
