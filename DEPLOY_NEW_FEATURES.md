# New features on Main (app.eglisevpd.com)

The 15 features built on SaaS, adapted for Main (one church, no tenants).

## Already done (Nov 17, 2026)
- **Database** (`ezrwmplohjvttwosqvrn`): `sql/144` → `sql/156` applied.
  Daily jobs: `send-due-reminders` (8:00 Toronto) and
  `send-pastoral-visit-reminders` (8:05).
- **Server functions deployed:** `broadcast`, `calendar-feed`,
  `online-giving`, `online-giving-webhook`, `event-payment`, `event-emails`.
- **Stripe:** a Connect webhook "VPD Main (app.eglisevpd.com)" points to
  `.../functions/v1/online-giving-webhook` on this project.

## Still needed for card payments (giving + paid events)
In Supabase → this project → Edge Functions → Secrets:
- `STRIPE_SECRET_KEY` — the same Stripe secret key the SaaS project uses.
- `STRIPE_CONNECT_WEBHOOK_SECRET` — the signing secret of the Stripe webhook
  **"VPD Main (app.eglisevpd.com)"** (Stripe → Developers → Webhooks → Reveal).
Optional: `CHURCH_NAME` (default "La Voix de la Puissance Divine").

## Not switched on
- AI writing help (code present, server function not deployed → buttons hidden).
- SMS / WhatsApp (need Twilio secrets).
- Phone push (`send-push` + VAPID keys were never set up on Main).

## Publish
`git push origin main`
