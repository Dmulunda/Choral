// Church Offering Registration automation (sql/054-055): generates a
// PDF ledger for a closed quarterly report period, and -- separately
// -- emails a church's Super Admin a period's PDF (with attachment)
// once it's 5 years old, then purges that period's individual
// offering rows. A third action hands the Finance team a short-lived
// download link for an already-generated PDF.
//
// Storage is Cloudflare R2, not Supabase Storage -- same reasoning and
// the exact same aws4fetch-based pattern as course-video-r2 (R2 has no
// egress fees, and this keeps all "external storage" in this app on
// one provider). The browser never touches R2 credentials -- the
// download_url action hands back a short-lived presigned GET URL
// after re-checking permission server-side, same as course-video-r2's
// playback_url.
//
// Three different callers, two different auth checks:
//   - generate_quarter / send_retention_email: called only by this
//     project's own pg_cron (via pg_net), authenticated with a shared
//     secret (CRON_SECRET) rather than a user JWT -- there's no signed-
//     in user in that context at all.
//   - download_url / generate_for_period / send_tax_receipt_email:
//     called by a signed-in Finance team member from offeringsBoard.js /
//     offeringsImport.js / taxReceiptsAdminBoard.js, authenticated with
//     their real JWT, then re-checks can_manage_finance()'s logic
//     server-side (mirrors course-video-r2's isSchoolAdmin/enrollment
//     re-check) -- never trusts that the browser only shows this to the
//     right person. generate_for_period is generate_quarter's same
//     PDF-build logic, used when Finance imports historical records
//     into an already-closed month and that month needs a PDF
//     (re)generated on demand instead of waiting for the nightly cron.
//     send_tax_receipt_email (sql/065) emails a guest donor's (no app
//     account) tax receipt -- the PDF is built client-side in Finance's
//     own browser (same code the member-facing download button uses)
//     and handed to this action as base64, nothing generated or stored
//     here.
//
// Deploy: `supabase functions deploy offering-reports --no-verify-jwt`.
// Needs these secrets set (Dashboard -> Edge Functions ->
// offering-reports -> Secrets):
//   - R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//     (can reuse the same R2 account as course-video-r2 -- a separate
//     bucket is recommended so financial records aren't mixed in with
//     course videos, but not required)
//   - RESEND_API_KEY (same one send-booking-email already uses)
//   - OFFERING_EMAIL_FROM (optional -- falls back to
//     BOOKING_EMAIL_FROM, then onboarding@resend.dev)
//   - CRON_SECRET (a random value -- must match the secret the 055
//     migration stored in this project's Vault, given to you
//     separately when that migration was applied)
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Tenant-aware but also works for a single-tenant database: tenant_id
// simply stays null throughout for that database, same pattern as
// church_bookings/offerings' own tables.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const DOWNLOAD_URL_TTL_SECONDS = 3600;
const FINANCE_OVERSIGHT_ROLES = ['super_admin', 'pastor_admin', 'church_secretary'];

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

function getR2({ accountId, accessKeyId, secretAccessKey, bucket }) {
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;
  return { client, endpoint };
}

async function presignGet(client, endpoint, key, ttlSeconds) {
  const url = new URL(`${endpoint}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(ttlSeconds));
  const signed = await client.sign(url, { method: 'GET', aws: { signQuery: true } });
  return signed.url;
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

  // Grouped by currency, never blended into one converted number --
  // same reasoning as offeringsBoard.js's period total.
  const totalsByCurrency = new Map();
  for (const o of offerings) {
    newPageIfNeeded();
    const currencyLabel = o.currency === 'other' && o.currency_other ? o.currency_other : (o.currency || 'CAD');
    draw(o.offering_date, margin);
    draw((o.donor_name || '').slice(0, 36), margin + 80);
    draw(OFFERING_TYPE_LABELS[o.offering_type] || o.offering_type, margin + 290);
    draw(`$${centsToDollars(o.amount_cents)} ${currencyLabel}`, margin + 440);
    totalsByCurrency.set(currencyLabel, (totalsByCurrency.get(currencyLabel) || 0) + o.amount_cents);
    y -= 14;
  }

  y -= 12;
  for (const [currencyLabel, cents] of totalsByCurrency) {
    newPageIfNeeded();
    draw(`Total (${currencyLabel}): $${centsToDollars(cents)}`, margin + 290, true, 12);
    y -= 16;
  }

  return await doc.save();
}

// Guest Donors (sql/065): a real church member who gives but has no
// app account can't download their own receipt the way a signed-in
// member does (taxReceiptsMemberBoard.js's client-side html2canvas +
// jsPDF build) -- Finance builds the exact same PDF in their own
// browser (js/utils/taxReceiptPdf.js, shared with the member board)
// and this action just emails whatever Blob it's handed, base64-
// encoded, to the guest's address on file. No PDF generation or
// storage happens server-side.
async function sendTaxReceiptEmail(admin, callerProfile, body) {
  const { receipt_id, pdf_base64 } = body;
  if (!receipt_id || !pdf_base64) return { error: 'receipt_id and pdf_base64 are required', status: 400 };

  const { data: receipt, error: receiptError } = await admin
    .from('tax_receipts')
    .select('tenant_id, fiscal_year, legal_name_snapshot, guest_donor_id')
    .eq('id', receipt_id)
    .maybeSingle();
  if (receiptError) return { error: receiptError.message, status: 500 };
  if (!receipt) return { error: 'Receipt not found', status: 404 };
  if (receipt.tenant_id !== callerProfile.tenant_id) return { error: 'Not authorized for this receipt', status: 403 };
  if (!receipt.guest_donor_id) return { error: 'This receipt belongs to a member with an account, not a guest donor', status: 400 };

  const { data: guest, error: guestError } = await admin
    .from('guest_donors').select('name, email').eq('id', receipt.guest_donor_id).maybeSingle();
  if (guestError) return { error: guestError.message, status: 500 };
  if (!guest?.email) return { error: 'This guest donor has no email on file', status: 400 };

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return { error: 'RESEND_API_KEY is not configured on this function', status: 500 };
  const fromAddress = Deno.env.get('OFFERING_EMAIL_FROM') || Deno.env.get('BOOKING_EMAIL_FROM') || 'onboarding@resend.dev';

  const html = `
    <p>Hi ${escapeHtml(guest.name || '')},</p>
    <p>Attached is your official tax receipt for ${escapeHtml(String(receipt.fiscal_year))}.</p>
  `;
  const resendResp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromAddress,
      to: [guest.email],
      subject: `Your ${receipt.fiscal_year} Tax Receipt`,
      html,
      attachments: [{ filename: `tax-receipt-${receipt.fiscal_year}.pdf`, content: pdf_base64 }],
    }),
  });
  if (!resendResp.ok) return { error: `Email send failed: ${await resendResp.text()}`, status: 502 };

  return { success: true };
}

async function generateAndStorePeriodPdf(admin, r2, endpoint, periodId) {
  const { data: period, error: periodError } = await admin
    .from('offering_report_periods')
    .select('id, tenant_id, period_start, period_end')
    .eq('id', periodId)
    .maybeSingle();
  if (periodError) return { error: periodError.message, status: 500 };
  if (!period) return { error: 'Period not found', status: 404 };

  let tenantName = null;
  if (period.tenant_id) {
    const { data: tenant } = await admin.from('tenants').select('name').eq('id', period.tenant_id).maybeSingle();
    tenantName = tenant?.name || null;
  }

  const { data: offerings, error: offeringsError } = await admin
    .from('offerings')
    .select('donor_name, offering_date, amount_cents, offering_type, currency, currency_other')
    .eq('report_period_id', periodId)
    .order('offering_date', { ascending: true });
  if (offeringsError) return { error: offeringsError.message, status: 500 };

  const pdfBytes = await buildOfferingPdf({
    tenantName, periodStart: period.period_start, periodEnd: period.period_end, offerings: offerings || [],
  });

  const storageKey = `${period.tenant_id || 'main'}/${period.id}.pdf`;
  const putResp = await r2.fetch(`${endpoint}/${storageKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: pdfBytes,
  });
  if (!putResp.ok) return { error: `R2 upload failed: ${await putResp.text()}`, status: 500 };

  await admin.from('offering_report_periods')
    .update({ pdf_storage_path: storageKey, generated_at: new Date().toISOString(), status: 'closed' })
    .eq('id', periodId);

  return { storage_path: storageKey };
}

// Shared by download_url / generate_for_period: re-derives
// can_manage_finance()'s own logic server-side (service-role client,
// since this isn't a DB session with RLS/auth.uid()) rather than
// trusting that the browser only shows these actions to the right
// person -- same "never trust the client" pattern as course-video-r2's
// isSchoolAdmin/enrollment re-check.
async function resolveFinanceCaller(admin, req) {
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  if (!jwt) return { error: 'Missing authorization', status: 401 };
  const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
  if (callerError || !caller) return { error: 'Invalid session', status: 401 };

  const { data: callerProfile } = await admin.from('profiles').select('tenant_id, global_role').eq('id', caller.id).single();
  if (!callerProfile) return { error: 'Profile not found', status: 404 };

  let canManage = FINANCE_OVERSIGHT_ROLES.includes(callerProfile.global_role);
  if (!canManage) {
    const { data: financeMembership } = await admin
      .from('department_memberships')
      .select('role, departments!inner(key)')
      .eq('user_id', caller.id)
      .eq('status', 'approved')
      .eq('departments.key', 'finance')
      .in('role', ['admin', 'secretary'])
      .maybeSingle();
    canManage = !!financeMembership;
  }
  if (!canManage) return { error: 'Only the Finance team can manage offering reports', status: 403 };

  return { callerProfile };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const action = body?.action;
  const admin = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  // send_tax_receipt_email needs neither a period nor R2 -- it emails a
  // client-built PDF straight through, nothing stored. Every other
  // action below operates on a stored period's PDF, hence R2 + period_id.
  if (action === 'send_tax_receipt_email') {
    const { error, status, callerProfile } = await resolveFinanceCaller(admin, req);
    if (error) return json({ error }, status);
    const result = await sendTaxReceiptEmail(admin, callerProfile, body);
    if (result.error) return json({ error: result.error }, result.status);
    return json(result);
  }

  const periodId = body?.period_id;
  if (!periodId) return json({ error: 'period_id is required' }, 400);

  const accountId = Deno.env.get('R2_ACCOUNT_ID');
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const bucket = Deno.env.get('R2_BUCKET');
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return json({ error: 'R2 is not configured on this function (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET)' }, 500);
  }
  const { client: r2, endpoint } = getR2({ accountId, accessKeyId, secretAccessKey, bucket });

  // ---- Cron-only actions: shared-secret auth, no signed-in user ----
  if (action === 'generate_quarter' || action === 'send_retention_email') {
    const cronSecret = Deno.env.get('CRON_SECRET');
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return json({ error: 'Unauthorized' }, 401);
    }

    if (action === 'generate_quarter') {
      const result = await generateAndStorePeriodPdf(admin, r2, endpoint, periodId);
      if (result.error) return json({ error: result.error }, result.status);
      return json({ success: true, storage_path: result.storage_path });
    }

    // send_retention_email
    const { data: period, error: periodError } = await admin
      .from('offering_report_periods')
      .select('id, tenant_id, period_start, period_end, pdf_storage_path, retention_emailed_at')
      .eq('id', periodId)
      .maybeSingle();
    if (periodError) return json({ error: periodError.message }, 500);
    if (!period) return json({ error: 'Period not found' }, 404);
    if (period.retention_emailed_at) return json({ skipped: 'already emailed' });
    if (!period.pdf_storage_path) return json({ error: 'No PDF generated for this period yet' }, 400);

    let adminQuery = admin.from('profiles').select('id, full_name')
      .eq('global_role', 'super_admin').order('created_at', { ascending: true }).limit(1);
    if (period.tenant_id) adminQuery = adminQuery.eq('tenant_id', period.tenant_id);
    const { data: superAdminProfile } = await adminQuery.maybeSingle();
    if (!superAdminProfile) return json({ error: 'No Super Admin found to email' }, 404);

    const { data: authUserResp, error: authUserError } = await admin.auth.admin.getUserById(superAdminProfile.id);
    const adminEmail = authUserResp?.user?.email;
    if (authUserError || !adminEmail) return json({ error: 'Could not resolve Super Admin email' }, 500);

    const getResp = await r2.fetch(`${endpoint}/${period.pdf_storage_path}`, { method: 'GET' });
    if (!getResp.ok) return json({ error: `R2 download failed: ${await getResp.text()}` }, 500);
    const pdfBuffer = new Uint8Array(await getResp.arrayBuffer());
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
    await r2.fetch(`${endpoint}/${period.pdf_storage_path}`, { method: 'DELETE' });
    await admin.from('offering_report_periods')
      .update({ retention_emailed_at: new Date().toISOString(), pdf_storage_path: null })
      .eq('id', periodId);

    return json({ success: true });
  }

  // ---- Client-facing action: a signed-in Finance team member wants
  // to download an already-generated period's PDF ----
  if (action === 'download_url') {
    const { error, status, callerProfile } = await resolveFinanceCaller(admin, req);
    if (error) return json({ error }, status);

    const { data: period, error: periodError } = await admin
      .from('offering_report_periods')
      .select('tenant_id, pdf_storage_path')
      .eq('id', periodId)
      .maybeSingle();
    if (periodError) return json({ error: periodError.message }, 500);
    if (!period?.pdf_storage_path) return json({ error: 'No PDF available for this period' }, 404);
    if (period.tenant_id && period.tenant_id !== callerProfile.tenant_id) {
      return json({ error: 'Not authorized for this period' }, 403);
    }

    const url = await presignGet(r2, endpoint, period.pdf_storage_path, DOWNLOAD_URL_TTL_SECONDS);
    return json({ url });
  }

  // ---- Client-facing action: a signed-in Finance team member just
  // imported historical records into an already-closed month
  // (offeringsImport.js) and that month's PDF needs to be generated
  // (or regenerated, to include the newly-imported rows) on demand,
  // instead of waiting for the nightly cron. ----
  if (action === 'generate_for_period') {
    const { error, status, callerProfile } = await resolveFinanceCaller(admin, req);
    if (error) return json({ error }, status);

    const { data: period, error: periodError } = await admin
      .from('offering_report_periods')
      .select('tenant_id')
      .eq('id', periodId)
      .maybeSingle();
    if (periodError) return json({ error: periodError.message }, 500);
    if (!period) return json({ error: 'Period not found' }, 404);
    if (period.tenant_id && period.tenant_id !== callerProfile.tenant_id) {
      return json({ error: 'Not authorized for this period' }, 403);
    }

    const result = await generateAndStorePeriodPdf(admin, r2, endpoint, periodId);
    if (result.error) return json({ error: result.error }, result.status);
    return json({ success: true, storage_path: result.storage_path });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
