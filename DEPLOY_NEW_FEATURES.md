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

## Guest portal and member privacy (November 2026)

Already done on the database:
- sql/157_profile_privacy.sql: guests (no approved department, no global
  role, not marked member) only see their own profile; small groups are
  members-only; get_profiles_private() and get_card_pastor_signature().
- Edge function `public-portal` (public program, public events, sermons,
  social media links).
- sql/159_church_social_links.sql: website, Facebook, YouTube, Instagram,
  TikTok and WhatsApp links on church_branding (edited in Super Admin
  Home -> Change Info).

To finish after `git push origin main` is live:
1. Apply sql/158_profile_private_columns.sql. It hides address, birth
   place, legal name and signature from direct reads. Apply it only
   after the new app code is live (older code reads those columns
   directly and would show "permission denied").
2. Share https://app.eglisevpd.com/welcome.html (QR code at the entrance,
   social media).
