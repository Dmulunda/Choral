// Emails a single notification to its recipient. The opt-in check
// (notification_preferences.email for that notification's type)
// already happened in the DB trigger that calls this
// (notify_email_on_notification(), sql/095_notification_redesign.sql)
// -- this function trusts that and just sends.
//
// Cron-style shared-secret auth (no Supabase JWT -- called from a
// Postgres trigger via net.http_post, not a signed-in user). Uses its
// own dedicated NOTIFICATION_CRON_SECRET rather than the existing
// shared CRON_SECRET (offering-reports' own) -- Main had no existing
// vault-secret/net.http_post plumbing at all before this, so this
// sets up its own rather than risk touching something already
// working.
//
// Deploy: `supabase functions deploy send-notification-email --no-verify-jwt`
// Needs: RESEND_API_KEY (already configured for other functions on
// this project), NOTIFICATION_CRON_SECRET (new, provisioned once via
// the CLI to match the vault secret of the same name).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-cron-secret',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const { notification_id } = await req.json();
    if (!notification_id) return json({ error: 'notification_id is required' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { data: notification } = await admin
      .from('notifications')
      .select('id, title, body, recipient_id')
      .eq('id', notification_id)
      .maybeSingle();
    if (!notification) return json({ skipped: 'notification not found' });

    const { data: userRes } = await admin.auth.admin.getUserById(notification.recipient_id);
    const toEmail = userRes?.user?.email;
    if (!toEmail) return json({ skipped: 'recipient has no email on file' });

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'RESEND_API_KEY is not configured on this function' }, 500);
    const fromAddress = Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject: notification.title,
        html: `
          <p>${escapeHtml(notification.title)}</p>
          ${notification.body ? `<p>${escapeHtml(notification.body)}</p>` : ''}
          <p style="color:#888;font-size:12px;">Manage which notifications email you from the app's notification settings.</p>
        `,
      }),
    });

    if (!resendResp.ok) {
      const errText = await resendResp.text();
      return json({ error: `Resend error: ${errText}` }, 502);
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
