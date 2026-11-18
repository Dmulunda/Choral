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

- Live services: edge function `live-status` + sql/160_live_status_cache.sql.
  It reads the YouTube link from Change Info, checks the channel's /live
  page (cached 60 s) and returns live / upcoming / video id. Pages:
  live.html (dedicated live page), a live banner on welcome.html, and a
  red banner at the top of the member app. (`live-status-debug` was a
  temporary test function; it now returns 410 and can be deleted from
  the Supabase dashboard.)

- AI writing help: sql/161_ai_writer.sql (usage log, 40 requests per
  person per day) and edge function `ai-writer` (Claude Haiku 5.5).
  Needs the ANTHROPIC_API_KEY secret on this project. The "✨ AI help"
  buttons appear by themselves for leaders once the key is set.

- Landing: index.html sends visitors who are not signed in to
  welcome.html (links with ?query or #hash are left alone; the guest
  page's Member sign-in uses index.html?signin=1). Back button on the
  public pages (js/publicBack.js).
- Live countdown: sql/162_live_schedule.sql (Wed 19:00, Fri 18:30,
  Sun 10:30, America/Toronto; edited in Change Info). live-status only
  counts a stream as live when YouTube shows "watching now" (an old
  scheduled waiting room no longer counts).

To finish after `git push origin main` is live:
1. Apply sql/158_profile_private_columns.sql. It hides address, birth
   place, legal name and signature from direct reads. Apply it only
   after the new app code is live (older code reads those columns
   directly and would show "permission denied").
2. Share https://app.eglisevpd.com/welcome.html (QR code at the entrance,
   social media).

## Member app redesign — step 1 (app-wide look)

- New `css/brand.css`, loaded last in index.html: navy/gold/cream palette, Inter + Fraunces, warm card borders, navy primary buttons, gold focus ring.
- Header: navy, logo pill on phones (fixes the header running off the screen); Theme and Help move into the phone menu.
- Sidebar/drawer: navy, gold bar on the active row, coloured initials for ministries, Mode switch reads "Super Admin / Membre".
- Bottom bar: line icons with labels — Home, Schedule, Live (live.html), Directory, Menu. Quick access and Settings moved into the drawer.
- Watermark logo behind the content removed. Brand name unified to "La Voix de la Puissance Divine".
- Saved theme (Change appearance): to match, set it to primary #0B1F3A, text #1B2433, background #F6F4EF, font Inter — the old saved grey background (#8b8b89) overrides the new cream otherwise.

## Member app redesign — step 2 (Home page)

- `sql/163_home_my_services.sql` (applied): `get_my_upcoming_services()` returns the signed-in person's own upcoming serving dates from every board (shifts, Choir, Media & Tech, Sunday school, moderating, preaching); `confirm_my_service()` sets the caller's own pending row to approved. Declining still goes through each board's own flow (it asks for a reason): "Indisponible" opens that department's schedule.
- New `js/components/homeFeed.js`; `js/superAdminHome.js` lays out the page: greeting, next service with Je confirme / Indisponible, quick actions, announcements, this week's program (with live times), live countdown card, and for leaders Gestion (counts) + À traiter + membership requests (the black duplicate block is gone).
- Home widgets use the new card style; the emoji in widget titles are removed.

## Member app redesign — step 3 (page polish)

- Documents: card titles take the full width on phones (were one word per line).
- Wide tables (events, registrations, reports…) keep a readable width and scroll sideways on phones.
- Academy tabs scroll instead of wrapping; the "Créer un planning pour" picker no longer pushes the page wider than the screen.
- Calendar day headings: "Mercredi 18 novembre" (was "Mercredi 18 Novembre").
- Card titles use the display font; form fields get the warm border and gold focus ring.
- offline.html: church logo and gold button, no more ChurchOnPoint; the logo is cached for offline use (sw.js). ChurchOnPoint wording removed from the SMS and online-giving help texts.

## Calendar vs Service teams, Planning button, theme label, online-only services

- `sql/164_calendar_program_and_online_only.sql` (applied):
  - `get_church_calendar()` now includes the Church Program (`church_program_dates`) at the weekly service time with the church address or "Online (YouTube)", and no longer lists department duty rosters (`department_shifts`, Choir service plans) except for departments flagged `is_public_calendar`.
  - `live_schedule` slots carry `online_only`; Wednesday 19:00 is online only, Friday and Sunday at the church.
- Calendar: "Programme" kind, sentence-case titles, intro line. Service Program renamed "Équipes de service / Service teams" with an intro line.
- Phone bottom bar "Planning" from Home: opens the schedule of the department you serve in next (else your first department, else the calendar).
- Theme button: shows what it switches to, with "Mode sombre / Mode clair" in the phone menu and as a label on wide screens.
- Place shown on the Home live card and this week, the guest page countdown and the live page; Change Info has an "Online only" box per service time.

## Monthly schedule clean-up

- `sql/165_cleanup_old_schedules.sql` (applied): `cleanup_old_schedules()` + pg_cron job `cleanup-old-schedules` (1st of each month, 04:15 UTC). Deletes schedules dated more than one month ago: department shifts/assignments, Media & Tech, Ecodem worker assignments (sessions and children's check-ins kept), preaching schedule, Choir service plans, availability. Program, events, attendance, offerings and sermons are kept.
- To stop it: `select cron.unschedule('cleanup-old-schedules');`
