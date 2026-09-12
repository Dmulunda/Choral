// Stripe Checkout + Billing Portal session creation for a tenant's own
// plan (sql/saas_platform/15_stripe_billing.sql). Uses Stripe's hosted
// pages for both -- no Stripe.js/publishable key anywhere client-side,
// just a redirect out and a redirect back, which fits this app's
// no-build-step vanilla-JS shape. Actually applying a completed
// checkout/cancellation to tenants.status/plan_id happens in
// stripe-webhook, not here -- this function only ever hands back a URL.
//
// Two actions, dispatched by `action` in the request body:
//   'create_checkout_session' — { plan_key }. Super Admin only. Basic
//     has no stripe_price_id (it's the "no active subscription" state,
//     not a real Stripe object -- see the migration's header comment),
//     so this 404s for it; only paid plans are checkout-able.
//   'create_portal_session' — Super Admin only, and only once the
//     tenant has ever checked out at least once (has a
//     stripe_customer_id) -- there's nothing to manage before that.
//
// Deploy: `supabase functions deploy stripe-billing`. Needs one secret
// — Dashboard -> Edge Functions -> stripe-billing -> Secrets:
//   STRIPE_SECRET_KEY
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('tenant_id, global_role')
      .eq('id', caller.id)
      .single();
    if (!callerProfile || callerProfile.global_role !== 'super_admin') {
      return json({ error: 'Only a Super Admin can manage billing' }, 403);
    }

    const { data: tenant } = await admin
      .from('tenants')
      .select('id, name, stripe_customer_id')
      .eq('id', callerProfile.tenant_id)
      .single();
    if (!tenant) return json({ error: 'Tenant not found' }, 404);

    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) return json({ error: 'Stripe is not configured on this function (STRIPE_SECRET_KEY)' }, 500);
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    // origin/referer since this function has no fixed notion of "the app's
    // URL" -- redirects always land back wherever the request came from.
    const appUrl = req.headers.get('origin') || new URL(req.headers.get('referer') || req.url).origin;
    const { action, plan_key } = await req.json();

    if (action === 'create_checkout_session') {
      if (!plan_key) return json({ error: 'plan_key is required' }, 400);

      const { data: plan } = await admin
        .from('plans')
        .select('id, stripe_price_id')
        .eq('key', plan_key)
        .single();
      if (!plan || !plan.stripe_price_id) return json({ error: 'This plan is not available for checkout' }, 404);

      let stripeCustomerId = tenant.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          name: tenant.name,
          metadata: { tenant_id: tenant.id },
        });
        stripeCustomerId = customer.id;
        await admin.rpc('set_tenant_stripe_customer', { p_tenant_id: tenant.id, p_stripe_customer_id: stripeCustomerId });
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: stripeCustomerId,
        line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
        success_url: `${appUrl}/?checkout=success`,
        cancel_url: `${appUrl}/?checkout=cancel`,
      });

      return json({ url: session.url });
    }

    if (action === 'create_portal_session') {
      if (!tenant.stripe_customer_id) return json({ error: 'No billing account yet -- upgrade to a paid plan first' }, 404);

      const session = await stripe.billingPortal.sessions.create({
        customer: tenant.stripe_customer_id,
        return_url: `${appUrl}/`,
      });

      return json({ url: session.url });
    }

    return json({ error: 'action must be "create_checkout_session" or "create_portal_session"' }, 400);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
