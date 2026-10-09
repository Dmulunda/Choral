// Stripe webhook -- applies a completed checkout, plan change, or
// cancellation to tenants.status/plan_id via sync_tenant_stripe_subscription()
// (sql/saas_platform/15_stripe_billing.sql), which wraps the
// protect_tenant_privileged_columns bypass flag so this write doesn't
// get rejected by that trigger like a normal client update would be.
//
// Different trust model from every other function in this app: Stripe
// calls this directly, with no Supabase JWT at all. Authenticity is a
// signature header verified against STRIPE_WEBHOOK_SECRET, not a
// session. Must be deployed with --no-verify-jwt (Supabase's default
// JWT gate would otherwise reject every call with 401 before this code
// ever runs):
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Then register the deployed URL as a Stripe webhook endpoint (Stripe
// Dashboard -> Developers -> Webhooks), listening for at least:
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted
// which gives you the signing secret to set below.
//
// Needs two secrets — Dashboard -> Edge Functions -> stripe-webhook -> Secrets:
//   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@17?target=deno';

// Stripe subscription statuses -> this app's tenants.status enum
// ('trial','active','past_due','canceled','trial_expired'). 'unpaid' and
// 'incomplete_expired' both mean Stripe has given up collecting payment --
// treated the same as a real cancellation. 'trialing' is a card-on-file
// trial (stripe-billing's create_checkout_session passes
// subscription_data.trial_end for any tenant still within its own
// trial window) -- maps back to this app's own 'trial' status, same
// meaning either way. 'incomplete' isn't expected here, but falls back
// to 'past_due' rather than silently doing nothing.
function toIso(unixSeconds) {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;
}

function mapSubscriptionStatus(stripeStatus) {
  if (stripeStatus === 'active') return 'active';
  if (stripeStatus === 'trialing') return 'trial';
  if (stripeStatus === 'past_due') return 'past_due';
  if (stripeStatus === 'canceled' || stripeStatus === 'unpaid' || stripeStatus === 'incomplete_expired') return 'canceled';
  return 'past_due';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!stripeSecretKey || !webhookSecret) {
    return new Response('Stripe is not configured on this function (STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET)', { status: 500 });
  }
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  let event;
  try {
    // Async variant -- Deno's SubtleCrypto-backed webhook verification
    // needs it (the sync constructEvent relies on Node's crypto module).
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    return new Response(`Webhook signature verification failed: ${err instanceof Error ? err.message : err}`, { status: 400 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  );

  async function planIdForPrice(stripePriceId) {
    if (!stripePriceId) return null;
    const { data: plan } = await admin.from('plans').select('id').eq('stripe_price_id', stripePriceId).maybeSingle();
    return plan?.id ?? null;
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.mode === 'subscription' && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const planId = await planIdForPrice(subscription.items.data[0]?.price?.id);
        await admin.rpc('sync_tenant_stripe_subscription', {
          p_stripe_customer_id: session.customer,
          p_stripe_subscription_id: subscription.id,
          p_status: mapSubscriptionStatus(subscription.status),
          p_plan_id: planId,
          p_current_period_end: toIso(subscription.current_period_end),
        });

        // A promo code was attached at checkout (stripe-billing's
        // create_checkout_session put everything needed to record it
        // straight into this session's own metadata) -- only recorded
        // now that payment has actually completed, never for an
        // abandoned checkout, and upserted on stripe_subscription_id
        // so a Stripe webhook retry can never double-count it.
        const meta = session.metadata;
        if (meta?.promo_code_id) {
          await admin.from('promo_code_redemptions').upsert({
            promo_code_id: meta.promo_code_id,
            tenant_id: meta.tenant_id,
            stripe_subscription_id: subscription.id,
            discount_percent: Number(meta.discount_percent),
            original_price_cents: Number(meta.original_price_cents),
            discounted_price_cents: Number(meta.discounted_price_cents),
            duration: meta.duration,
            duration_in_months: meta.duration_in_months ? Number(meta.duration_in_months) : null,
          }, { onConflict: 'stripe_subscription_id', ignoreDuplicates: true });
        }
      }
    } else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object;
      const planId = await planIdForPrice(subscription.items.data[0]?.price?.id);
      const status = mapSubscriptionStatus(subscription.status);
      await admin.rpc('sync_tenant_stripe_subscription', {
        p_stripe_customer_id: subscription.customer,
        p_stripe_subscription_id: subscription.id,
        p_status: status,
        p_plan_id: status === 'canceled' ? null : planId,
        p_current_period_end: status === 'canceled' ? null : toIso(subscription.current_period_end),
      });
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await admin.rpc('sync_tenant_stripe_subscription', {
        p_stripe_customer_id: subscription.customer,
        p_stripe_subscription_id: null,
        p_status: 'canceled',
        p_plan_id: null,
        p_current_period_end: null,
      });
    }
    // Any other event type: acknowledged (200) without action -- Stripe
    // retries on non-2xx, and this app doesn't need every event kind.

    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    // Non-2xx here makes Stripe retry -- correct behavior for a real
    // transient failure (e.g. a DB blip), not just logged and swallowed.
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unexpected error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
