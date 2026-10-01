// Church Offering Registration automation (sql/054-055): generates a
// PDF ledger for a closed quarterly report period, and -- separately
// -- emails a church's Super Admin a period's PDF (with attachment)
// once it's 5 years old, then purges that period's individual
// offering rows. Both actions are invoked by pg_cron via pg_net (see
// 055_offering_report_automation.sql), never directly by a client --
// protected by a shared secret (CRON_SECRET) rather than requiring
// deploy with JWT verification on, since the caller is Postgres
// itself, not a signed-in user.
//
// Deploy: `supabase functions deploy offering-reports --no-verify-jwt`.
// Needs these secrets set (Dashboard -> Edge Functions ->
// offering-reports -> Secrets):
//   - RESEND_API_KEY (same one send-booking-email already uses)
//   - OFFERING_EMAIL_FROM (optional -- falls back to
//     BOOKING_EMAIL_FROM, then onboarding@resend.dev)
//   - CRON_SECRET (a random value -- must match the secret the
//     055 migration stored in this project's Vault, given to you
//     separately when that migration was applied)
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// Also needs a public Storage bucket... actually a PRIVATE bucket
// named "offering-reports" (created by 055_offering_report_automation.sql)
// -- this function uses the service-role client, which bypasses its RLS.
//
// Tenant-aware but also works for a single-tenant database: tenant_id
// simply stays null throughout for that database, same pattern as
// church_bookings/offerings' own tables.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const OFFERING_TYPE_LABELS = {
  tithe: 'Tithe',
  general: 'General Offering',
  sacrifice: 'Sacrifice',
  construction: 'Construction',
  other: 'Other',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function centsToDollars(cents) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function buildOfferingPdf({ tenantName, periodStart, periodEnd, offerings }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  let page = doc.addPage([612, 792]); // US Letter
  let y = 742;

  function draw(text, x, bold = false, size = 10) {
    page.drawText(String(text ?? ''), { x, y, size, font: bold ? boldFont : font, color: rgb(0, 0, 0) });
  }
  function newPageIfNeeded() {
    if (y < 70) {
      page = doc.addPage([612, 792]);
      y = 742;
    }
  }

  draw(`Offering Report${tenantName ? ` — ${tenantName}` : ''}`, margin, true, 16);
  y -= 22;
  draw(`${periodStart} to ${periodEnd}`, margin, false, 11);
  y -= 28;

  draw('Date', margin, true);
  draw('Name', margin + 80, true);
  draw('Type', margin + 290, true);
  draw('Amount', margin + 440, true);
  y -= 16;

  let total = 0;
  for (const o of offerings) {
    newPageIfNeeded();
    draw(o.offering_date, margin);
    draw((o.donor_name || '').slice(0, 36), margin + 80);
    draw(OFFERING_TYPE_LABELS[o.offering_type] || o.offering_type, margin + 290);
    draw(`$${centsToDollars(o.amount_cents)}`, margin + 440);
    total += o.amount_cents;
    y -= 14;
  }

  y -= 12;
  newPageIfNeeded();
  draw(`Total: $${centsToDollars(total)}`, margin + 290, true, 12);

  return await doc.save();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const action = body?.action;
  const periodId = body?.period_id;
  if (!periodId) return json({ error: 'period_id is required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  if (action === 'generate_quarter') {
    const { data: period, error: periodError } = await admin
      .from('offering_report_periods')
      .select('id, tenant_id, period_start, period_end')
      .eq('id', periodId)
      .maybeSingle();
    if (periodError) return json({ error: periodError.message }, 500);
    if (!period) return json({ error: 'Period not found' }, 404);

    let tenantName = null;
    if (period.tenant_id) {
      const { data: tenant } = await admin.from('tenants').select('name').eq('id', period.tenant_id).maybeSingle();
      tenantName = tenant?.name || null;
    }

    const { data: offerings, error: offeringsError } = await admin
      .from('offerings')
      .select('donor_name, offering_date, amount_cents, offering_type')
      .eq('report_period_id', periodId)
      .order('offering_date', { ascending: true });
    if (offeringsError) return json({ error: offeringsError.message }, 500);

    const pdfBytes = await buildOfferingPdf({
      tenantName, periodStart: period.period_start, periodEnd: period.period_end, offerings: offerings || [],
    });

    const storagePath = `${period.tenant_id || 'main'}/${period.id}.pdf`;
    const { error: uploadError } = await admin.storage
      .from('offering-reports')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) return json({ error: uploadError.message }, 500);

    await admin.from('offering_report_periods')
      .update({ pdf_storage_path: storagePath, generated_at: new Date().toISOString(), status: 'closed' })
      .eq('id', periodId);

    return json({ success: true, storage_path: storagePath });
  }

  if (action === 'send_retention_email') {
    const { data: period, error: periodError } = await admin
      .from('offering_report_periods')
      .select('id, tenant_id, period_start, period_end, pdf_storage_path, retention_emailed_at')
      .eq('id', periodId)
      .maybeSingle();
    if (periodError) return json({ error: periodError.message }, 500);
    if (!period) return json({ error: 'Period not found' }, 404);
    if (period.retention_emailed_at) return json({ skipped: 'already emailed' });
    if (!period.pdf_storage_path) return json({ error: 'No PDF generated for this period yet' }, 400);

    // The admin to email: that tenant's (or, for a single-tenant
    // database, the church's) longest-standing Super Admin.
    let adminQuery = admin.from('profiles').select('id, full_name')
      .eq('global_role', 'super_admin').order('created_at', { ascending: true }).limit(1);
    if (period.tenant_id) adminQuery = adminQuery.eq('tenant_id', period.tenant_id);
    const { data: superAdminProfile } = await adminQuery.maybeSingle();
    if (!superAdminProfile) return json({ error: 'No Super Admin found to email' }, 404);

    const { data: authUserResp, error: authUserError } = await admin.auth.admin.getUserById(superAdminProfile.id);
    const adminEmail = authUserResp?.user?.email;
    if (authUserError || !adminEmail) return json({ error: 'Could not resolve Super Admin email' }, 500);

    const { data: pdfFile, error: downloadError } = await admin.storage.from('offering-reports').download(period.pdf_storage_path);
    if (downloadError) return json({ error: downloadError.message }, 500);
    const pdfBuffer = new Uint8Array(await pdfFile.arrayBuffer());
    let binary = '';
    for (const byte of pdfBuffer) binary += String.fromCharCode(byte);
    const pdfBase64 = btoa(binary);

    let tenantName = null;
    if (period.tenant_id) {
      const { data: tenant } = await admin.from('tenants').select('name').eq('id', period.tenant_id).maybeSingle();
      tenantName = tenant?.name || null;
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ error: 'RESEND_API_KEY is not configured on this function' }, 500);
    const fromAddress = Deno.env.get('OFFERING_EMAIL_FROM') || Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';

    const html = `
      <p>Hi ${escapeHtml(superAdminProfile.full_name || '')},</p>
      <p>Your church's offering records for <strong>${escapeHtml(period.period_start)} to ${escapeHtml(period.period_end)}</strong>${tenantName ? ` (${escapeHtml(tenantName)})` : ''} have reached the 5-year retention limit.</p>
      <p>The full PDF report is attached for your records. Once this email is sent, the individual offering entries for this period are removed from the system — this email and its attachment become the only remaining copy, so please save it somewhere safe.</p>
    `;

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: [adminEmail],
        subject: `Offering report archive: ${period.period_start} to ${period.period_end}`,
        html,
        attachments: [{ filename: `offering-report-${period.period_start}-to-${period.period_end}.pdf`, content: pdfBase64 }],
      }),
    });
    if (!resendResp.ok) {
      const errText = await resendResp.text();
      return json({ success: false, error: errText }, 502);
    }

    // Purge: the email attachment is now the only copy, per design --
    // delete the individual offering rows and the stored PDF, but
    // keep the period row itself as a lightweight "this quarter
    // existed and was archived on this date" marker.
    await admin.from('offerings').delete().eq('report_period_id', periodId);
    await admin.storage.from('offering-reports').remove([period.pdf_storage_path]);
    await admin.from('offering_report_periods')
      .update({ retention_emailed_at: new Date().toISOString(), pdf_storage_path: null })
      .eq('id', periodId);

    return json({ success: true });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
