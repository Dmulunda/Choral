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
15. `17_budget_v2_reimbursements.sql` — extends Budget Management to
    every department (ported from `main` commit `ee85bf4`): a fund
    request now auto-creates the requesting department's budget on
    Finance approval (or tops up an existing one, if the request points
    at one), a standalone `reimbursement_requests` table for personal
    out-of-pocket spending ("My Budget"), and cross-department audit
    read access for Finance Admins + Pastor via `can_manage_finance()`.
    **Found and fixed a pre-existing multi-tenant bug in
    `can_manage_finance()` while doing this**: its subquery for
    Finance's own `department_id` had no `tenant_id` filter — harmless
    with only one tenant, but the moment a second tenant's own Finance
    department exists, `select id from departments where key='finance'`
    returns more than one row, which Postgres raises as an error in a
    scalar-subquery context, breaking the function platform-wide, not
    just leaking data. Fixed in place (`and tenant_id =
    current_tenant_id()`), since this function is now load-bearing for
    the new audit-read policy. `approve_budget_request()`/
    `approve_reimbursement_request()` are `SECURITY DEFINER` (same
    reasoning as `sync_tenant_stripe_subscription()`), so — unlike
    `can_manage_finance()` alone, which only proves the caller is *a*
    Finance admin somewhere — every row each RPC touches is explicitly
    re-checked against `current_tenant_id()`, not just looked up by id.
    Verified live: `can_manage_finance()` no longer errors, the full
    request → approve → auto-created-budget flow produces the right
    `tenant_id`, and reimbursement approval is blocked without a receipt
    and succeeds once one's attached.
16. No new SQL — client-only, ported from `main` (commit `f76f690`):
    replaced the nested-per-department Budget UI with one centralized
    "Budget" page (`js/budgetPage.js`, `js/components/budgetCentralBoard.js`)
    reached from a top-level nav item next to Service Program, but with
    zero trace for anyone who isn't a department admin/secretary or
    Pastor — no nav button constructed in the DOM at all for a
    disqualifying viewer, not just CSS-hidden like every other
    conditional nav item in `index.html`. Two new exports on
    `departments.js` (`hasFinanceOversight()`, `hasAnyDeptLeadership()`)
    mirror `can_manage_finance()`'s exact composition so what's shown
    client-side tracks what RLS actually allows. Fund Request (submit +
    Finance's inbox) and the per-department budget board moved into the
    new page's two tabs (filterable by month/department, a pending-count
    badge on Fund Request); Reimbursements ("My Budget") stayed nested
    per-department, unchanged, since that restructuring was specifically
    about Fund Request/Budget Report.
17. `18_budget_v3_notes_approval_split.sql` — Budget module punch-list
    round, ported from `main` (commit `2052f28`). `budget_requests.review_note`
    / `reimbursement_requests.review_note` (Finance's note on an
    approval/rejection, shown to the requester) and `budgets.finance_note`
    (a standing annotation Finance can add/edit on any department's
    budget at any time, via a narrow new `set_budget_finance_note()` RPC
    rather than widening the general `budgets` write policy) plus
    `budgets.approved_by` (set by `approve_budget_request()` to
    `auth.uid()`, left null for Finance's own directly-created budgets).
    New `can_approve_finance()` — identical to `can_manage_finance()`
    minus the Finance-department-secretary branch — swapped in for the
    actual approve/reject RLS policies (`"finance can update budget
    requests"`, `"finance can reject reimbursement requests"`) and the
    two approval RPCs, so a Finance secretary keeps full cross-department
    read/audit access but can't act on a request. `approve_budget_request()`/
    `approve_reimbursement_request()` both gain a `p_review_note`
    parameter (old single-arg overloads dropped, so PostgREST has exactly
    one candidate to resolve an RPC call against). Also ported client-side
    (unchanged from `main` beyond the tenant-scoped SQL above): "My
    Budget"/Reimbursements moved into the centralized Budget page's Fund
    Request tab, the review-note UI, the Finance-note section in
    `budgetDetailModal.js`, the active-department scoping fix in
    `budgetCentralBoard.js` (follows `getActiveDepartment()` instead of an
    arbitrary first-led-department pick), the reworked `budgetPdf.js`
    layout (church name/address/approved-by on the left, department/budget
    name/created-by/dates on the right — `churchAddress` uses the same
    `t('memberCard.churchAddress')` placeholder text as `main` until a
    real address is provided; sandbox2 has no per-tenant address field, a
    known gap), and the Finance drill-down into a filtered department's
    live budget board under the aggregate Budget Report totals. Verified
    live: all four new/changed function signatures resolve to exactly one
    overload each, the two approval policies read `can_approve_finance()`,
    and all four new columns exist with the expected types (a live
    impersonation approve/reject-with-note test wasn't possible — this
    project's one populated tenant has no Finance admin/secretary
    membership yet to test against, unlike `16`/`17` which had one).
18. `19_budget_v4_finance_write_parity.sql` — three follow-up fixes from
    the same round, ported from `main` (commit `4dc42b2`). **Finance-admin
    write parity**: widened the `budgets`/`budget_transactions` write RLS
    policies and the `budget-receipts` storage policy to also allow
    `can_approve_finance()`, so a Finance Admin (not a Finance secretary)
    can fully manage any department's budget from the Budget Report
    drill-down — log expenses, attach/view receipts, edit name/
    description, change status — the same actions that department's own
    admin has, instead of the read-only view `17` shipped. Verified live
    (create a throwaway budget in a non-Finance department, `UPDATE`/
    `INSERT` as the Finance admin, confirm success, delete the test row).
    Client: `budgetCentralBoard.js`'s drill-down now passes
    `canManage: canApproveFinance()` instead of a hardcoded `false`.
    **Self-approval + "Approved by" fallback** (client-only, no new SQL):
    Finance creating its own budget directly now sets `approved_by` to
    itself at insert time (`budgetBoard.js`); `budgetDetailModal.js`/
    `budgetPdf.js` now fall back to the creator's name whenever
    `approved_by` is null, so every budget shows an approver — including
    the `18` gap this closes (a Finance-created budget, or any
    pre-`18` row, previously showed nothing). **Church address**:
    `main` hardcoded its real address into `memberCard.churchAddress` —
    deliberately **not** carried over here, since that's one specific
    church's street address and every other tenant would otherwise
    inherit it. Kept blank (`''`) on `sandbox2` instead, and
    `budgetPdf.js` only renders the address line when a tenant actually
    has one set — still the same known gap as `17` (no per-tenant address
    field in `tenants` yet), now handled without leaking `main`'s data
    into the shared template.
19. No new SQL — client-only, ported from `main` (commit `34b5ba6`).
    Finance's Budget Report aggregate rows were plain non-interactive
    `<div>`s; the only route into a department's actual detail (New
    Expense/Edit/receipts, from `18`) was the separate department filter
    dropdown above the table, which wasn't discoverable. Each row is now
    a real `<button>` (oversight only — a plain department's own view has
    just one row, already expanded below) that sets the filter and
    expands that department's drill-down directly beneath it, scrolled
    into view.
20. `20_tenant_address.sql` — `tenants.address text`, editable from a new
    section in `tenantLogoModal.js` (the same Super-Admin-only modal that
    already handles the logo, opened from the header logo or the
    settings menu). Not in `09_tenant_logo.sql`'s privileged-column
    protection list, so the existing "tenant admin can update own
    tenant" UPDATE policy already permits writing it — no RLS/trigger
    changes needed. `tenant.js`'s `loadMyTenant()` now selects it, and
    `budgetPdf.js`'s `churchAddress` reads `getTenant()?.address`
    instead of the blank i18n placeholder it fell back to since the `17`
    port — closing that "known gap" noted in `17`'s README entry. This
    is sandbox2-only: `main` has no equivalent tenant-settings page (a
    single hardcoded church with its real address already in `i18n.js`),
    so there's nothing to port here. Verified live: `tenants.address`
    exists as `text`, and a Super Admin's `UPDATE` on it succeeds under
    the existing policy (tested against a throwaway value, rolled back).
21. `21_pastor_meetings_schema.sql` + `22_pastor_meetings_rpcs.sql` —
    Pastor Meeting Scheduling System, ported from `main` (commit
    `060098b`). New `pastor_availability` (tenant-scoped, RESTRICTIVE
    `tenant_isolation` + a plain policy restricting write to
    `pastor_id = auth.uid()` or `is_super_admin()`); `pastor_meeting_requests`
    extended with `pastor_id`/`availability_id`/`meeting_type`/`guest_name`/
    `guest_email`/`guest_phone`, `user_id` now nullable (guest bookings
    have no profile), `'cancelled'` added to `pastor_meeting_status`.
    **One deviation from the original plan sketch, found only once
    `tenants`' actual write policy was checked live**: settings
    (Manual-vs-Random pastor assignment) did **not** become columns on
    `tenants` as first planned — `tenants`' UPDATE policy is
    super-admin-only, but this setting needs super-admin OR
    church-secretary write access, matching `main`'s gate. Went with a
    real per-tenant `pastor_meeting_settings` table instead
    (`tenant_id` itself as the PK, one row per tenant, RESTRICTIVE
    `tenant_isolation`, its own read/write policies mirroring `main`'s
    exactly) rather than force-fitting a column that couldn't carry the
    right access rule.

    The three RPCs (`get_public_pastor_slots`/`submit_pastor_meeting_booking`
    anon+authenticated, `cancel_pastor_meeting_booking` authenticated-only)
    needed a real design addition beyond tenant-scoping `main`'s
    versions: an **anonymous caller has no session at all**, so no
    `current_tenant_id()` to resolve from. Both public RPCs gained an
    optional `p_tenant_slug` parameter, resolved the same way
    `get_tenant_by_slug()` (`03_signup_rpcs.sql`) already does — an
    authenticated in-app call omits it and gets `current_tenant_id()`
    instead, only the public `booking.html` page (genuinely anonymous)
    supplies it. This is why `booking.html` requires a `?church=<slug>`
    query parameter here — `main`'s single-church version needs no
    identifier at all, since there's only one church to mean.
    `pastorBookingCalendar.js`/`publicBooking.js`/`pastorMeetingsPage.js`
    (the public-link generator in its Settings tab) all diverge from
    `main`'s versions specifically to thread this slug through; every
    other client file (`pastorAvailabilityCalendar.js`, `app.js`,
    `index.html`, `i18n.js`'s key additions) applied as a clean,
    unmodified patch from `main`'s commit.

    Verified live end-to-end (temporarily promoted an existing test
    profile to `pastor_admin`, ran the full flow, restored its original
    role afterward, confirmed no leftover rows): a pastor writes only
    their own availability; a direct anon `SELECT`/`INSERT` against
    `pastor_availability` is rejected; an anon call to
    `get_public_pastor_slots(slug)` sees the real slot and a bogus slug
    raises "Church not found"; an anon guest booking succeeds with the
    correct `tenant_id`/`pastor_id`/`meeting_room`, creates the
    in-app notification, and is rejected on a second attempt at the
    same slot (`FOR UPDATE SKIP LOCKED`); the assigned pastor can see
    the booking via the new `pastor_id = auth.uid()` SELECT clause;
    cancelling reopens the slot immediately (computed availability, no
    stored flag to desync); a Super Admin can write
    `pastor_meeting_settings`, a Pastor Admin can read it but is
    correctly blocked from writing it.
22. `23_pastor_meetings_v2_schema.sql` + `24_pastor_meetings_v2_rpcs.sql` —
    follow-up, ported from `main` (commit `6e295ae`). Three adjustable
    settings rather than fixed behavior, per the user's own framing:
    "we can change it due to time and circumstance."
    - **Bulk slot generation**: `pastorAvailabilityCalendar.js` no
      longer takes one start/end time per submit — a pastor picks a
      time window (e.g. 5:00-6:00) and a meeting length (e.g. 10
      minutes), and every slot in that window is generated client-side
      and written in a single bulk upsert. Optional weekly recurrence
      (checkbox + an end date) materializes the same window/duration
      as concrete rows for every matching day-of-week — not an
      abstract recurrence rule — so every existing booking/query path
      needed zero changes.
    - New `pastor_availability_unique_slot` constraint
      (`pastor_id, date, start_time, end_time`) — bulk generation
      raises real odds of accidentally regenerating an overlapping
      window, and a genuine duplicate row would otherwise be
      independently bookable, letting two people book what looks like
      the same displayed slot. The generator upserts with
      `ignoreDuplicates` against this constraint. `tenant_id` isn't
      part of the constraint — `pastor_id` alone already disambiguates
      tenant, since a pastor belongs to exactly one.
    - New `pastor_meeting_settings.min_booking_notice_hours`
      (default 24, editable in the same Settings tab as the
      assignment-mode toggle): a slot stops being listed **and** stops
      being bookable server-side (not just hidden client-side) once it
      falls within that window of its start time — enforced in both
      `get_public_pastor_slots()` and `submit_pastor_meeting_booking()`,
      both already tenant-aware from `21`/`22` so this only needed a
      `where tenant_id = v_tenant_id` lookup added to the existing
      settings read, no new tenant-resolution logic.

    Verified live (same temporarily-promoted test profile as `21`/`22`,
    restored after): a slot inside the 24h notice window is hidden from
    `get_public_pastor_slots()` and rejected by
    `submit_pastor_meeting_booking()` even when called directly; a slot
    beyond the window is visible and bookable; a duplicate
    `(pastor_id, date, start_time, end_time)` insert is correctly
    rejected by the new constraint; the no-settings-row-yet case
    correctly coalesces to the 24-hour default rather than erroring.

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
