# SaaS platform database

Schema for the new multi-tenant SaaS product, applied to Supabase project
`towlqbxvhftzjfrtepsy` (separate account/org from the live single-church app,
which is untouched and stays on its own project). Local-only for now — this
`sandbox2` branch is the working copy until it's split into its own repo.

## Migration files, in order

1. `01_schema.sql` — extensions, enum types, `tenants` table +
   `current_tenant_id()`, all ~58 app tables (with `tenant_id`), constraints,
   indexes, functions (`handle_new_user()` patched to set `tenant_id` from
   signup metadata), triggers, RLS. Reconstructed via `pg_catalog`
   introspection (no `pg_dump`/Docker available) — structure only, zero rows
   of real data copied anywhere.
2. `02_storage_and_auth.sql` — storage buckets, storage policies, the
   `auth.users` signup/login triggers, the one `pg_cron` job. Outside the
   `public` schema, so a plain schema dump misses them.
3. `03_signup_rpcs.sql` — `create_tenant_for_signup()` (anon-callable, the
   only path around `tenants` having no client-facing INSERT policy) and
   `claim_tenant_admin()` (lets the founding user become their tenant's
   `super_admin`, exactly once per tenant). Also patches
   `protect_global_role()` with a transaction-local bypass flag, since that
   pre-existing trigger otherwise blocks `claim_tenant_admin()` even though
   it's `SECURITY DEFINER` (triggers fire regardless of calling role).
4. `04_help_documents.sql` + `05_help_documents_languages.sql` — the "Help &
   Training" feature: a `help_documents` table + `help-docs` bucket. Extended
   to support per-language docs and a **global default** per language
   (`tenant_id IS NULL`, readable by every tenant, writable only outside the
   app) so every church gets a working guide from day one with nothing to
   upload. A tenant's own upload for a language takes priority over the
   default for that language.
5. `06_rpc_tenant_fixes.sql` — **Phase 1.5**: audited all 22 client-callable
   `SECURITY DEFINER` RPCs. Since these bypass RLS entirely (not just
   restrict role/permission), most only checked "is the caller an admin,"
   never "does the row this id points at belong to the caller's own
   tenant" — patched every one that acts on an existing row by id (mark
   prayer request prayed, reassign department admin, reinstate/remove a
   user, review course approvals/enrollments, transfer guest/member cases,
   etc.). Verified live: cross-tenant attempts get a generic "not found"
   (existence isn't leaked), same-tenant operations still work.
6. `07_trial_expiry.sql` — daily `pg_cron` job flips `trial` →
   `trial_expired` once `trial_ends_at` passes. Status-only; never touches
   data.
7. `08_plans_and_features.sql` — `plans`/`features`/`plan_features` +
   `has_feature(key)` + `get_my_features()`. Trial = every feature,
   regardless of plan. Enforced in both layers: RESTRICTIVE RLS policies on
   the gated tables themselves (not just a hidden button) plus the frontend
   read via `get_my_features()`. Seeded with Basic/Pro/Enterprise and one
   concrete example gate (`vpd_academy`, Pro+) to prove the pattern
   end-to-end; verified live across trial/no-plan/pro/basic tenants,
   including that an unentitled tenant's raw `INSERT` into `courses` is
   actually rejected by RLS, not just hidden client-side.
8. `09_tenant_logo.sql` — `tenants.logo_url` + `tenant-logos` bucket (public
   read, tenant-admin-only write). Free for every tenant regardless of
   plan/trial (explicit product decision, not gated). Added a general
   `tenants` UPDATE policy scoped to that tenant's own `super_admin`, plus a
   `protect_tenant_privileged_columns` trigger (same bypass-flag pattern as
   `protect_global_role`) so that policy can't be used to self-change
   `status`/`trial_ends_at`/`plan_id`/`slug` — only `logo_url`/`name`.
   Verified live: same-tenant logo update works, status self-change is
   blocked, cross-tenant update matches zero rows.

## Client-side pieces (in `js/`, not this directory)

- `tenant.js` — loads the caller's tenant row, `getTrialDaysLeft()`.
- `entitlements.js` — loads `get_my_features()` once per session,
  `hasFeature(key)` — display-layer only, RLS is the real boundary.
- `app.js` — trial banner (dismissible per-day, non-dismissible once
  expired), per-tenant logo in the header (falls back to the default "VPD"
  placeholder), VPD Academy nav item shows a 🔒 Upgrade badge and an
  upgrade prompt instead of navigating when not entitled.
- `components/helpModal.js`, `components/tenantLogoModal.js`,
  `components/authScreen.js` ("New Church" signup tab).

9. `10_invite_links.sql` — `tenants.allow_self_signup` (default `true`) +
   `get_tenant_by_slug()` (anon-callable, minimal columns only — the one
   place a pre-auth visitor can read anything about a tenant). Powers
   `?join=<slug>` invite links in `authScreen.js`.
10. `11_default_departments.sql`, superseded by `12_all_default_departments.sql`
    — `create_tenant_for_signup()` now seeds the **full standard set of 14
    departments** (all of `js/departments.js`'s `DEPARTMENT_KEYS`) for
    every new tenant, not just the ones with bespoke boards. Choir gets
    `kind='choir'` (its own separate top-level tab set — see `isChoir` in
    `js/app.js`); everything else is `kind='lightweight'`, including
    Preaching & Moderation, Media & Tech, and Ecodem/Sunday School, whose
    special scheduling boards route by `key` in `deptScheduling.js`
    regardless of `kind`. Backfilled onto the existing test tenant too,
    which had zero departments before this. `department.ecodem` was also
    renamed in `js/i18n.js`: "Sunday School" / "École du dimanche" (was
    "Ecodem" in both languages).
11. `13_expire_past_schedules.sql` — daily `pg_cron` job (`expire-past-schedules`)
    ported over from the live single-church app: purges
    `department_shifts`/`preaching_schedule`/`media_tech_assignments`/
    `ecodem_sessions` the day after their date passes, and Choir's
    `service_plans` after 8 days. No tenant filtering needed — it deletes
    by date across every tenant, which is safe (nothing read, nothing
    leaked) and matches what every tenant already expects.
12. `14_service_program.sql` — `get_service_program(date)`, ported from
    the live single-church app's "Service Program" roster page (one page
    showing every department's assignments for a single date, with
    department/personal highlighting client-side). This one **does**
    need tenant filtering, unlike the cleanup job above — it's a
    `SECURITY DEFINER` function that deliberately reads across every
    department's tables (each normally RLS-restricted to its own
    department's members), so every single table reference inside it is
    explicitly scoped to `current_tenant_id()`. Verified live via
    impersonation (`current_tenant_id()` resolves correctly under a real
    session, function returns clean empty JSON for the test tenant, which
    has no scheduling data yet). New client files: `js/serviceProgram.js`,
    `js/components/serviceProgramBoard.js`; new unconditional sidebar tab
    next to VPD Academy (not plan-gated).
13. `15_stripe_billing.sql` — real Stripe billing on top of the existing
    plan/feature model. Adds `plans.stripe_price_id` and
    `tenants.stripe_customer_id`/`stripe_subscription_id`, plus two
    `SECURITY DEFINER` functions: `set_tenant_stripe_customer()` (sets
    the customer id on first checkout) and
    `sync_tenant_stripe_subscription()` (the only thing that ever writes
    `status`/`plan_id` after this — wraps the
    `protect_tenant_privileged_columns` bypass flag from
    `09_tenant_logo.sql`, `set_config('app.bypass_tenant_column_protection',
    'on', true)`, so the trigger that blocks a tenant's own super_admin
    from self-changing those columns doesn't also block this legitimate
    write). Verified live: a raw `update tenants set status = ...` is
    correctly rejected by the trigger; the RPC path correctly bypasses
    it and reverts cleanly. Basic ($0) intentionally has no
    `stripe_price_id` — a `plan_id = null` tenant already has zero
    gated features today, so Basic needs no Stripe object at all;
    "downgrading" is just canceling via the Billing Portal.
    New Edge Functions: `stripe-billing` (Checkout + Billing Portal
    session creation, JWT-verified, Super Admin only) and
    `stripe-webhook` (applies `checkout.session.completed`/
    `customer.subscription.updated`/`.deleted` — different trust model
    from every other function here, verified via Stripe's signature
    header rather than a Supabase JWT, must deploy with
    `--no-verify-jwt`). `plansModal.js`'s old `mailto:` "Request
    Upgrade" is now a real Stripe Checkout redirect; a "Manage Billing"
    button (Billing Portal) appears once a tenant has ever checked out.
    No Stripe.js/publishable key anywhere client-side — both flows are
    plain redirects to Stripe's hosted pages and back.
14. `16_budget_management.sql` — Finance: Budget Management, ported from
    `main` (commit `c948eeb`). New `budgets`/`budget_transactions`
    tables, RLS via the same `can_read_department()`/
    `can_write_department()` helpers every other department table
    already uses, plus a `RESTRICTIVE tenant_isolation` policy on both —
    the standard Phase 1 two-layer pattern, confirmed identical to
    `department_shifts`' actual live policy set before writing this.
    New private `budget-receipts` storage bucket, same
    folder-scoped-by-`department_id` shape as `uniform-photos` (no
    tenant-id path segment needed — confirmed live that `uniform-photos`
    itself doesn't use one either, since `department_id` is already
    tenant-unique). Verified live via impersonation: a Finance admin's
    insert correctly auto-fills `tenant_id` via the column default, and
    the `tenant_isolation` policy is present with the expected
    expression (a true cross-tenant negative test wasn't possible — this
    project's one populated tenant only has a single profile in it).
    Client files ported unmodified except `budgetPdf.js`'s church-name
    text, which now reads `getTenant()?.name` (falling back to
    `t('app.brand')`) instead of the live app's hardcoded name — same
    pattern as `memberIdCard.js`'s header, the one other place in this
    app that prints the org's name as text rather than just a logo.

## Other client-side fixes from this session

- `userCreatorModal.js` and `peopleImportModal.js` ("+ New Member" and
  bulk import) were both silently broken — neither passed `tenant_id` in
  `signUp()`'s metadata, so `handle_new_user()` failed on the `NOT NULL`
  constraint. Fixed: both now pass the creating admin's own `getTenantId()`.
- Header/sidebar brand text ("VPD Church Organisation") and the small
  header logo now reflect the actual signed-in tenant (`applyTenantBranding()`
  in `app.js`, kept in sync across language switches). The header logo is
  clickable for a Super Admin, opening the upload tool directly.
- `memberIdCard.js` now renders the tenant's actual logo and name as real
  text on the card header, rather than assuming the logo image itself
  contains the church's name (true only of the original VPD wordmark).
  `certificate.js` and `disciplinaryLetters.js` still hardcode the default
  logo — not yet switched over.
- Plans & Pricing (`plansModal.js`) is now reachable only by `super_admin`
  — the sidebar menu item, the trial banner (hidden entirely for every
  other role), and the "locked feature" upgrade prompt (other roles get
  an "ask your admin" message instead of the pricing page). Billing is a
  super-admin-only concern; self-signup was already gated the same way.
- Ported over a batch of app-layer fixes made directly on `main` (the live
  single-church app) this session, adapted where the tenant-branding work
  here had already diverged (`memberIdCard.js`'s header/logo): profile
  photo upload fix, signature-wipe race fix, signature recolored white on
  the ID card's navy back instead of invisible navy-on-navy, QR code moved
  from card front to back, native share sheet for ID card PNG/PDF export,
  "My Profile" form collapsed behind a toggle with the ID card shown
  first, delete access added to every department's scheduling board
  (previously only Preaching & Moderation had it), and approved/declined
  service requests & assignments now drop out of view instead of lingering
  (also see `13_expire_past_schedules.sql` above for the matching DB-side
  cleanup-job port).

## Known gaps / next steps

- **Edge Functions patched, still not deployed.** `admin-reset-password`,
  `send-push`, and `course-video-r2` have now had the same tenant-scoping
  treatment as the RPCs in `06_rpc_tenant_fixes.sql` (each fetches the
  caller's `tenant_id` once and verifies every target row against it
  before acting — `course-video-r2` was the most serious gap: a School
  Admin could previously overwrite or delete another tenant's course
  video by id/key alone). Still not deployed to the new project at all
  (confirmed via a 404 on the functions endpoint) — needs the Supabase
  CLI (`npx supabase functions deploy <name> --project-ref
  towlqbxvhftzjfrtepsy`) and a personal access token (`supabase login`
  or `SUPABASE_ACCESS_TOKEN`), neither available in-session yet. Not
  urgent to actually deploy — neither push notifications nor course
  video playback is in use yet — but the code is ready whenever a token
  is provided.
- ~~Logo branding still hardcoded in `certificate.js` and
  `disciplinaryLetters.js`~~ — done. Both now use `getTenant()?.logo_url`,
  same fallback pattern as `memberIdCard.js`/the header. The remaining
  hardcoded `img/vpd-logo.png` references (`authScreen.js`,
  `passwordRecovery.js`, `index.html`'s splash/watermark/favicon) are all
  pre-login surfaces where no tenant is known yet — left as the generic
  platform logo on purpose, not an oversight.
- **Billing integration coded, not deployed.** `15_stripe_billing.sql` +
  `stripe-billing`/`stripe-webhook` (see above) are ready but need three
  things none of which exist in-session yet: the Supabase CLI login
  (same blocker as the other Edge Functions), a real Stripe account
  (test mode is fine) for `STRIPE_SECRET_KEY` and the two paid plans'
  Price ids, and — only obtainable after `stripe-webhook` is deployed —
  registering its URL in the Stripe dashboard to get
  `STRIPE_WEBHOOK_SECRET`.
- Globally-unique constraints fixed in `01_schema.sql`: `menu_labels`,
  `app_theme` (old boolean `id` singleton PK dropped for `tenant_id`),
  `departments`, `projection_schedules`, `ecodem_sessions`. `bible_books`/
  `bible_verses` deliberately stayed global (shared reference data).
