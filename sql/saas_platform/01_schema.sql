-- Multi-tenant schema for the new SaaS platform, seeded from a schema-only
-- introspection of the live single-church app (structure only, zero rows
-- of real data anywhere in this file), with tenant_id baked into every
-- table from creation (this database is empty, so no backfill is needed --
-- much simpler than retrofitting a live database).
-- Ordering: extensions -> enums -> tenants + current_tenant_id() -> tables
--           (tenant_id included) -> constraints -> indexes -> functions ->
--           triggers -> RLS (copied policies + new tenant_isolation policies).

begin;

-- ==================== EXTENSIONS ====================
create extension if not exists "pg_cron";
create extension if not exists "pg_stat_statements";
create extension if not exists "pgcrypto";
create extension if not exists "supabase_vault";
create extension if not exists "uuid-ossp";

-- ==================== ENUM TYPES ====================
do $$ begin
  create type public."availability_status" as enum ('available', 'unavailable');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."budget_request_status" as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."course_approval_status" as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."course_enrollment_status" as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."department_role" as enum ('admin', 'member', 'secretary');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."disciplinary_letter_status" as enum ('draft', 'sent', 'acknowledged', 'disputed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."disciplinary_letter_type" as enum ('warning', 'suspension');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."ecodem_age_group" as enum ('group_1', 'group_2', 'group_3');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."global_role" as enum ('super_admin', 'super_viewer', 'pastor_admin', 'church_secretary');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."guest_follow_up_status" as enum ('new_guest', 'contacted', 'assigned_to_department');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."letter_signer_role" as enum ('pastor', 'member');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."media_tech_role" as enum ('stream_operator', 'sound_operator', 'media_inventory', 'camera_operator', 'slides_operator', 'video_content_creator', 'photo_editor');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."member_case_status" as enum ('open', 'in_progress', 'resolved');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."membership_status" as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."notification_type" as enum ('absence', 'app_suggestion', 'announcement', 'call_invite', 'disciplinary_letter');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."pastor_meeting_status" as enum ('pending', 'confirmed', 'declined');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."plan_status" as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."prayer_request_status" as enum ('pending', 'prayed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."quiz_question_type" as enum ('multiple_choice', 'true_false');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."replacement_status" as enum ('open', 'claimed', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."rsvp_status" as enum ('pending', 'approved', 'declined');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."service_type" as enum ('sunday_service', 'midweek_service', 'special_service');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."song_category" as enum ('praise', 'worship');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."user_role" as enum ('admin', 'singer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."video_source" as enum ('upload', 'external');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public."voice_part" as enum ('Leader', 'Soprano', 'Alto', 'Tenor', 'Instrumentalist', 'Pianist', 'Bassist', 'Guitarist', 'Drummer');
exception when duplicate_object then null; end $$;

-- ==================== TENANTS ====================
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])$'),
  status text not null default 'trial' check (status in ('trial','active','past_due','canceled','trial_expired')),
  trial_ends_at timestamptz,
  plan_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==================== TABLES ====================
create table if not exists public."absence_reports" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "absence_date" date not null,
  "reason" text,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."app_suggestions" (
  "id" uuid default gen_random_uuid() not null,
  "submitted_by" uuid,
  "message" text not null,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."app_theme" (
  "primary_color" text default '#4f46e5'::text not null,
  "text_color" text default '#1e293b'::text not null,
  "background_color" text default '#f1f5f9'::text not null,
  "font_family" text default 'default'::text not null,
  "updated_by" uuid,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."attendance_records" (
  "id" uuid default gen_random_uuid() not null,
  "service_date" date not null,
  "service_type" service_type not null,
  "service_label" text,
  "member_id" uuid,
  "guest_name" text,
  "recorded_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "guest_phone" text,
  "guest_email" text,
  "guest_city" text,
  "guest_referral_source" text,
  "guest_referred_by_name" text,
  "guest_age_range" text,
  "guest_prayer_request" text,
  "guest_wants_pastor_meeting" boolean default false not null,
  "guest_home_church" text,
  "tenant_id" uuid not null
);

create table if not exists public."availability" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "date" date not null,
  "status" availability_status not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."bible_books" (
  "number" smallint not null,
  "name_en" text not null,
  "name_fr" text not null
);

create table if not exists public."bible_verses" (
  "translation" text not null,
  "book_number" smallint not null,
  "chapter" smallint not null,
  "verse" smallint not null,
  "text" text not null
);

create table if not exists public."budget_requests" (
  "id" uuid default gen_random_uuid() not null,
  "requesting_department_id" uuid not null,
  "requested_by" uuid not null,
  "title" text not null,
  "amount" numeric(12,2),
  "description" text,
  "status" budget_request_status default 'pending'::budget_request_status not null,
  "created_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "request_month" date default (date_trunc('month'::text, now()))::date not null,
  "tenant_id" uuid not null
);

create table if not exists public."church_program_dates" (
  "id" uuid default gen_random_uuid() not null,
  "program_id" uuid not null,
  "date" date not null,
  "tenant_id" uuid not null
);

create table if not exists public."church_programs" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "description" text,
  "is_special" boolean default false not null,
  "flyer_storage_path" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."course_approvals" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "course_id" uuid not null,
  "status" course_approval_status default 'pending'::course_approval_status not null,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."course_enrollments" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "course_id" uuid not null,
  "status" course_enrollment_status default 'pending'::course_enrollment_status not null,
  "requested_at" timestamp with time zone default now() not null,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "tenant_id" uuid not null
);

create table if not exists public."course_modules" (
  "id" uuid default gen_random_uuid() not null,
  "course_id" uuid not null,
  "title" text not null,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."course_questions" (
  "id" uuid default gen_random_uuid() not null,
  "course_id" uuid not null,
  "user_id" uuid not null,
  "question_text" text not null,
  "answer_text" text,
  "answered_by" uuid,
  "answered_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."courses" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "description" text,
  "published" boolean default false not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."department_announcements" (
  "id" uuid default gen_random_uuid() not null,
  "department_id" uuid not null,
  "title" text not null,
  "body" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."department_headcounts" (
  "id" uuid default gen_random_uuid() not null,
  "department_id" uuid not null,
  "date" date not null,
  "men_count" integer default 0 not null,
  "women_count" integer default 0 not null,
  "kids_count" integer default 0 not null,
  "total_count" integer generated always as (((men_count + women_count) + kids_count)) stored,
  "recorded_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."department_memberships" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "department_id" uuid not null,
  "role" department_role default 'member'::department_role not null,
  "status" membership_status default 'pending'::membership_status not null,
  "requested_at" timestamp with time zone default now() not null,
  "approved_at" timestamp with time zone,
  "approved_by" uuid,
  "tenant_id" uuid not null
);

create table if not exists public."department_monthly_reports" (
  "id" uuid default gen_random_uuid() not null,
  "department_id" uuid not null,
  "report_month" date not null,
  "notes" text,
  "needs" text,
  "updated_by" uuid,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."department_shift_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "shift_id" uuid not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "status" text default 'approved'::text not null,
  "reason" text,
  "working_department_id" uuid,
  "responded_at" timestamp with time zone,
  "tenant_id" uuid not null
);

create table if not exists public."department_shifts" (
  "id" uuid default gen_random_uuid() not null,
  "department_id" uuid not null,
  "date" date not null,
  "title" text not null,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."department_uniforms" (
  "id" uuid default gen_random_uuid() not null,
  "department_id" uuid not null,
  "date" date not null,
  "description" text,
  "image_path" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."departments" (
  "id" uuid default gen_random_uuid() not null,
  "key" text not null,
  "name" text not null,
  "kind" text default 'lightweight'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "is_public_calendar" boolean default false not null,
  "meeting_link" text,
  "tenant_id" uuid not null
);

create table if not exists public."direct_calls" (
  "id" uuid default gen_random_uuid() not null,
  "caller_id" uuid not null,
  "recipient_id" uuid not null,
  "room" text not null,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."direct_messages" (
  "id" uuid default gen_random_uuid() not null,
  "sender_id" uuid not null,
  "recipient_id" uuid not null,
  "body" text not null,
  "related_replacement_request_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "read_at" timestamp with time zone,
  "tenant_id" uuid not null
);

create table if not exists public."disciplinary_letters" (
  "id" uuid default gen_random_uuid() not null,
  "member_id" uuid not null,
  "type" disciplinary_letter_type not null,
  "reason" text not null,
  "issued_by" uuid,
  "issued_at" timestamp with time zone default now() not null,
  "suspension_start" date,
  "suspension_end" date,
  "status" disciplinary_letter_status default 'draft'::disciplinary_letter_status not null,
  "tenant_id" uuid not null
);

create table if not exists public."ecodem_session_workers" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "status" text default 'approved'::text not null,
  "reason" text,
  "working_department_id" uuid,
  "responded_at" timestamp with time zone,
  "tenant_id" uuid not null
);

create table if not exists public."ecodem_sessions" (
  "id" uuid default gen_random_uuid() not null,
  "date" date not null,
  "age_group" ecodem_age_group not null,
  "topic" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."guest_follow_up_transfers" (
  "id" uuid default gen_random_uuid() not null,
  "guest_follow_up_id" uuid not null,
  "from_department_id" uuid,
  "to_department_id" uuid not null,
  "note" text,
  "transferred_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."guest_follow_ups" (
  "id" uuid default gen_random_uuid() not null,
  "full_name" text not null,
  "phone" text,
  "email" text,
  "user_id" uuid,
  "status" guest_follow_up_status default 'new_guest'::guest_follow_up_status not null,
  "assigned_department_id" uuid,
  "notes" text,
  "source" text default 'manual'::text not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "city" text,
  "referral_source" text,
  "referred_by_name" text,
  "age_range" text,
  "prayer_request" text,
  "wants_pastor_meeting" boolean default false not null,
  "home_church" text,
  "tenant_id" uuid not null
);

create table if not exists public."lesson_progress" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "lesson_id" uuid not null,
  "watched_ratio" numeric default 0 not null,
  "quiz_score" integer,
  "quiz_attempts" integer default 0 not null,
  "completed" boolean default false not null,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."lessons" (
  "id" uuid default gen_random_uuid() not null,
  "module_id" uuid not null,
  "title" text not null,
  "video_source" video_source,
  "video_url" text,
  "video_storage_path" text,
  "pdf_storage_path" text,
  "pdf_file_name" text,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "video_provider" text default 'supabase'::text not null,
  "tenant_id" uuid not null
);

create table if not exists public."letter_signatures" (
  "id" uuid default gen_random_uuid() not null,
  "letter_id" uuid not null,
  "signer_id" uuid not null,
  "signer_role" letter_signer_role not null,
  "signed_at" timestamp with time zone default now() not null,
  "signature_data" text not null,
  "tenant_id" uuid not null
);

create table if not exists public."login_events" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "logged_in_at" timestamp with time zone not null,
  "tenant_id" uuid not null
);

create table if not exists public."media_tech_assignments" (
  "id" uuid default gen_random_uuid() not null,
  "date" date not null,
  "role" media_tech_role not null,
  "user_id" uuid not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "status" text default 'approved'::text not null,
  "reason" text,
  "working_department_id" uuid,
  "responded_at" timestamp with time zone,
  "tenant_id" uuid not null
);

create table if not exists public."member_case_transfers" (
  "id" uuid default gen_random_uuid() not null,
  "member_case_id" uuid not null,
  "from_department_id" uuid,
  "to_department_id" uuid not null,
  "note" text,
  "transferred_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."member_cases" (
  "id" uuid default gen_random_uuid() not null,
  "subject_user_id" uuid not null,
  "note" text not null,
  "status" member_case_status default 'open'::member_case_status not null,
  "assigned_department_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."menu_labels" (
  "key" text not null,
  "label_en" text not null,
  "label_fr" text not null,
  "updated_by" uuid,
  "updated_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."notifications" (
  "id" uuid default gen_random_uuid() not null,
  "recipient_id" uuid not null,
  "type" notification_type not null,
  "title" text not null,
  "body" text,
  "source_user_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "read_at" timestamp with time zone,
  "tenant_id" uuid not null
);

create table if not exists public."pastor_meeting_requests" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "note" text,
  "status" pastor_meeting_status default 'pending'::pastor_meeting_status not null,
  "confirmed_by" uuid,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "meeting_room" text,
  "tenant_id" uuid not null
);

create table if not exists public."prayer_requests" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "request_text" text not null,
  "status" prayer_request_status default 'pending'::prayer_request_status not null,
  "handled_by" uuid,
  "handled_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."preaching_schedule" (
  "id" uuid default gen_random_uuid() not null,
  "date" date not null,
  "moderator_id" uuid,
  "preacher_name" text,
  "sermon_theme" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "guest_name" text,
  "moderator_status" text default 'approved'::text not null,
  "moderator_reason" text,
  "moderator_working_department_id" uuid,
  "moderator_responded_at" timestamp with time zone,
  "preacher_id" uuid,
  "bible_verse" text,
  "tenant_id" uuid not null
);

create table if not exists public."profile_emails" (
  "id" uuid not null,
  "email" text not null,
  "tenant_id" uuid not null
);

create table if not exists public."profiles" (
  "id" uuid not null,
  "full_name" text not null,
  "role" user_role default 'singer'::user_role not null,
  "instrument_name" text,
  "created_at" timestamp with time zone default now() not null,
  "voice_parts" voice_part[] default '{}'::voice_part[] not null,
  "global_role" global_role,
  "phone" text,
  "removed_at" timestamp with time zone,
  "removed_by" uuid,
  "permanently_deleted_at" timestamp with time zone,
  "is_primary_admin" boolean default false not null,
  "is_school_admin" boolean default false not null,
  "can_view_all_departments" boolean default false not null,
  "can_manage_pastoral_cases" boolean default false not null,
  "can_post_global_announcements" boolean default false not null,
  "can_message_any_member" boolean default false not null,
  "can_approve_any_membership" boolean default false not null,
  "media_tech_skills" text[] default '{}'::text[] not null,
  "photo_path" text,
  "address" text,
  "member_code" text,
  "sex" text,
  "member_title" text,
  "parish" text,
  "birth_date" date,
  "birth_country" text,
  "birth_city" text,
  "principal_department_id" uuid,
  "card_issued_at" date default CURRENT_DATE not null,
  "card_revoked_at" timestamp with time zone,
  "signature_data" text,
  "tenant_id" uuid not null
);
comment on table public."profiles" is 'One row per member, keyed to auth.users.id';

create table if not exists public."projection_schedule_items" (
  "id" uuid default gen_random_uuid() not null,
  "schedule_id" uuid not null,
  "position" integer not null,
  "kind" text not null,
  "label" text not null,
  "payload" jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."projection_schedules" (
  "id" uuid default gen_random_uuid() not null,
  "service_date" date not null,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" uuid,
  "tenant_id" uuid not null
);

create table if not exists public."projection_settings" (
  "id" boolean default true not null,
  "backdrop_path" text,
  "updated_at" timestamp with time zone default now() not null,
  "updated_by" uuid,
  "tenant_id" uuid not null
);

create table if not exists public."push_subscriptions" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "endpoint" text not null,
  "p256dh" text not null,
  "auth" text not null,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."quiz_questions" (
  "id" uuid default gen_random_uuid() not null,
  "quiz_id" uuid not null,
  "question_text" text not null,
  "type" quiz_question_type not null,
  "options" jsonb,
  "correct_answer" text not null,
  "position" integer default 0 not null,
  "tenant_id" uuid not null
);

create table if not exists public."quizzes" (
  "id" uuid default gen_random_uuid() not null,
  "lesson_id" uuid not null,
  "passing_score" integer default 8 not null,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."replacement_requests" (
  "id" uuid default gen_random_uuid() not null,
  "service_plan_id" uuid not null,
  "requested_by" uuid not null,
  "voice_part" voice_part not null,
  "target_singer_id" uuid,
  "status" replacement_status default 'open'::replacement_status not null,
  "claimed_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  "tenant_id" uuid not null
);

create table if not exists public."rules_documents" (
  "id" uuid default gen_random_uuid() not null,
  "department_id" uuid,
  "title" text not null,
  "storage_path" text not null,
  "file_name" text not null,
  "uploaded_by" uuid,
  "uploaded_at" timestamp with time zone default now() not null,
  "version" integer default 1 not null,
  "is_current" boolean default true not null,
  "tenant_id" uuid not null
);

create table if not exists public."rules_signatures" (
  "id" uuid default gen_random_uuid() not null,
  "rules_document_id" uuid not null,
  "member_id" uuid not null,
  "signed_at" timestamp with time zone default now() not null,
  "signature_data" text not null,
  "tenant_id" uuid not null
);

create table if not exists public."service_plan_singers" (
  "id" uuid default gen_random_uuid() not null,
  "service_plan_id" uuid not null,
  "singer_id" uuid not null,
  "voice_part" voice_part not null,
  "created_at" timestamp with time zone default now() not null,
  "tenant_id" uuid not null
);

create table if not exists public."service_plan_songs" (
  "id" uuid default gen_random_uuid() not null,
  "service_plan_id" uuid not null,
  "song_id" uuid not null,
  "category" song_category not null,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "note" text,
  "tenant_id" uuid not null
);

create table if not exists public."service_plans" (
  "id" uuid default gen_random_uuid() not null,
  "date" date not null,
  "choir_leader_id" uuid,
  "song_ids" uuid[] default '{}'::uuid[] not null,
  "status" plan_status default 'draft'::plan_status not null,
  "created_at" timestamp with time zone default now() not null,
  "title" text,
  "tenant_id" uuid not null
);

create table if not exists public."service_rsvps" (
  "id" uuid default gen_random_uuid() not null,
  "service_plan_id" uuid not null,
  "singer_id" uuid not null,
  "status" rsvp_status default 'pending'::rsvp_status not null,
  "responded_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "reason" text,
  "working_department_id" uuid,
  "tenant_id" uuid not null
);

create table if not exists public."songs" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "key" text,
  "lyrics" text,
  "youtube_url" text,
  "audio_lead_track" text,
  "created_at" timestamp with time zone default now() not null,
  "audio_soprano_track" text,
  "audio_alto_track" text,
  "audio_tenor_track" text,
  "video_track" text,
  "tenant_id" uuid not null
);

-- ==================== CONSTRAINTS ====================
alter table public."absence_reports" add constraint "absence_reports_pkey" PRIMARY KEY (id);
alter table public."app_suggestions" add constraint "app_suggestions_pkey" PRIMARY KEY (id);
alter table public."app_theme" add constraint "app_theme_pkey" PRIMARY KEY (tenant_id);
alter table public."attendance_records" add constraint "attendance_records_pkey" PRIMARY KEY (id);
alter table public."availability" add constraint "availability_pkey" PRIMARY KEY (id);
alter table public."bible_books" add constraint "bible_books_pkey" PRIMARY KEY (number);
alter table public."bible_verses" add constraint "bible_verses_pkey" PRIMARY KEY (translation, book_number, chapter, verse);
alter table public."budget_requests" add constraint "budget_requests_pkey" PRIMARY KEY (id);
alter table public."church_program_dates" add constraint "church_program_dates_pkey" PRIMARY KEY (id);
alter table public."church_programs" add constraint "church_programs_pkey" PRIMARY KEY (id);
alter table public."course_approvals" add constraint "course_approvals_pkey" PRIMARY KEY (id);
alter table public."course_enrollments" add constraint "course_enrollments_pkey" PRIMARY KEY (id);
alter table public."course_modules" add constraint "course_modules_pkey" PRIMARY KEY (id);
alter table public."course_questions" add constraint "course_questions_pkey" PRIMARY KEY (id);
alter table public."courses" add constraint "courses_pkey" PRIMARY KEY (id);
alter table public."department_announcements" add constraint "department_announcements_pkey" PRIMARY KEY (id);
alter table public."department_headcounts" add constraint "department_headcounts_pkey" PRIMARY KEY (id);
alter table public."department_memberships" add constraint "department_memberships_pkey" PRIMARY KEY (id);
alter table public."department_monthly_reports" add constraint "department_monthly_reports_pkey" PRIMARY KEY (id);
alter table public."department_shift_assignments" add constraint "department_shift_assignments_pkey" PRIMARY KEY (id);
alter table public."department_shifts" add constraint "department_shifts_pkey" PRIMARY KEY (id);
alter table public."department_uniforms" add constraint "department_uniforms_pkey" PRIMARY KEY (id);
alter table public."departments" add constraint "departments_pkey" PRIMARY KEY (id);
alter table public."direct_calls" add constraint "direct_calls_pkey" PRIMARY KEY (id);
alter table public."direct_messages" add constraint "direct_messages_pkey" PRIMARY KEY (id);
alter table public."disciplinary_letters" add constraint "disciplinary_letters_pkey" PRIMARY KEY (id);
alter table public."ecodem_session_workers" add constraint "ecodem_session_workers_pkey" PRIMARY KEY (id);
alter table public."ecodem_sessions" add constraint "ecodem_sessions_pkey" PRIMARY KEY (id);
alter table public."guest_follow_up_transfers" add constraint "guest_follow_up_transfers_pkey" PRIMARY KEY (id);
alter table public."guest_follow_ups" add constraint "guest_follow_ups_pkey" PRIMARY KEY (id);
alter table public."lesson_progress" add constraint "lesson_progress_pkey" PRIMARY KEY (id);
alter table public."lessons" add constraint "lessons_pkey" PRIMARY KEY (id);
alter table public."letter_signatures" add constraint "letter_signatures_pkey" PRIMARY KEY (id);
alter table public."login_events" add constraint "login_events_pkey" PRIMARY KEY (id);
alter table public."media_tech_assignments" add constraint "media_tech_assignments_pkey" PRIMARY KEY (id);
alter table public."member_case_transfers" add constraint "member_case_transfers_pkey" PRIMARY KEY (id);
alter table public."member_cases" add constraint "member_cases_pkey" PRIMARY KEY (id);
alter table public."menu_labels" add constraint "menu_labels_pkey" PRIMARY KEY (tenant_id, key);
alter table public."notifications" add constraint "notifications_pkey" PRIMARY KEY (id);
alter table public."pastor_meeting_requests" add constraint "pastor_meeting_requests_pkey" PRIMARY KEY (id);
alter table public."prayer_requests" add constraint "prayer_requests_pkey" PRIMARY KEY (id);
alter table public."preaching_schedule" add constraint "preaching_schedule_pkey" PRIMARY KEY (id);
alter table public."profile_emails" add constraint "profile_emails_pkey" PRIMARY KEY (id);
alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
alter table public."projection_schedule_items" add constraint "projection_schedule_items_pkey" PRIMARY KEY (id);
alter table public."projection_schedules" add constraint "projection_schedules_pkey" PRIMARY KEY (id);
alter table public."projection_settings" add constraint "projection_settings_pkey" PRIMARY KEY (id);
alter table public."push_subscriptions" add constraint "push_subscriptions_pkey" PRIMARY KEY (id);
alter table public."quiz_questions" add constraint "quiz_questions_pkey" PRIMARY KEY (id);
alter table public."quizzes" add constraint "quizzes_pkey" PRIMARY KEY (id);
alter table public."replacement_requests" add constraint "replacement_requests_pkey" PRIMARY KEY (id);
alter table public."rules_documents" add constraint "rules_documents_pkey" PRIMARY KEY (id);
alter table public."rules_signatures" add constraint "rules_signatures_pkey" PRIMARY KEY (id);
alter table public."service_plan_singers" add constraint "service_plan_singers_pkey" PRIMARY KEY (id);
alter table public."service_plan_songs" add constraint "service_plan_songs_pkey" PRIMARY KEY (id);
alter table public."service_plans" add constraint "service_plans_pkey" PRIMARY KEY (id);
alter table public."service_rsvps" add constraint "service_rsvps_pkey" PRIMARY KEY (id);
alter table public."songs" add constraint "songs_pkey" PRIMARY KEY (id);
alter table public."availability" add constraint "availability_user_id_date_key" UNIQUE (user_id, date);
alter table public."church_program_dates" add constraint "church_program_dates_program_id_date_key" UNIQUE (program_id, date);
alter table public."course_approvals" add constraint "course_approvals_user_id_course_id_key" UNIQUE (user_id, course_id);
alter table public."course_enrollments" add constraint "course_enrollments_user_id_course_id_key" UNIQUE (user_id, course_id);
alter table public."department_headcounts" add constraint "department_headcounts_department_id_date_key" UNIQUE (department_id, date);
alter table public."department_memberships" add constraint "department_memberships_user_id_department_id_key" UNIQUE (user_id, department_id);
alter table public."department_monthly_reports" add constraint "department_monthly_reports_department_id_report_month_key" UNIQUE (department_id, report_month);
alter table public."department_shift_assignments" add constraint "department_shift_assignments_shift_id_user_id_key" UNIQUE (shift_id, user_id);
alter table public."department_uniforms" add constraint "department_uniforms_department_id_date_key" UNIQUE (department_id, date);
alter table public."departments" add constraint "departments_key_key" UNIQUE (tenant_id, key);
alter table public."ecodem_session_workers" add constraint "ecodem_session_workers_session_id_user_id_key" UNIQUE (session_id, user_id);
alter table public."ecodem_sessions" add constraint "ecodem_sessions_date_age_group_key" UNIQUE (tenant_id, date, age_group);
alter table public."guest_follow_ups" add constraint "guest_follow_ups_user_id_key" UNIQUE (user_id);
alter table public."lesson_progress" add constraint "lesson_progress_user_id_lesson_id_key" UNIQUE (user_id, lesson_id);
alter table public."letter_signatures" add constraint "letter_signatures_letter_id_signer_role_key" UNIQUE (letter_id, signer_role);
alter table public."media_tech_assignments" add constraint "media_tech_assignments_date_role_user_id_key" UNIQUE (date, role, user_id);
alter table public."profiles" add constraint "profiles_member_code_key" UNIQUE (member_code);
alter table public."projection_schedules" add constraint "projection_schedules_service_date_key" UNIQUE (tenant_id, service_date);
alter table public."push_subscriptions" add constraint "push_subscriptions_endpoint_key" UNIQUE (endpoint);
alter table public."quizzes" add constraint "quizzes_lesson_id_key" UNIQUE (lesson_id);
alter table public."rules_signatures" add constraint "rules_signatures_rules_document_id_member_id_key" UNIQUE (rules_document_id, member_id);
alter table public."service_plan_singers" add constraint "service_plan_singers_service_plan_id_singer_id_key" UNIQUE (service_plan_id, singer_id);
alter table public."service_plan_songs" add constraint "service_plan_songs_service_plan_id_song_id_key" UNIQUE (service_plan_id, song_id);
alter table public."service_rsvps" add constraint "service_rsvps_service_plan_id_singer_id_key" UNIQUE (service_plan_id, singer_id);
alter table public."attendance_records" add constraint "attendance_records_guest_referral_source_check" CHECK ((guest_referral_source = ANY (ARRAY['social_media'::text, 'vpd_elsewhere'::text, 'word_of_mouth'::text])));
alter table public."attendance_records" add constraint "attendance_records_person_check" CHECK ((((member_id IS NOT NULL) AND (guest_name IS NULL)) OR ((member_id IS NULL) AND (guest_name IS NOT NULL))));
alter table public."attendance_records" add constraint "attendance_records_guest_age_range_check" CHECK ((guest_age_range = ANY (ARRAY['under_18'::text, '18_29'::text, '30_40'::text, '40_50'::text, '50_plus'::text])));
alter table public."department_headcounts" add constraint "department_headcounts_kids_count_check" CHECK ((kids_count >= 0));
alter table public."department_headcounts" add constraint "department_headcounts_women_count_check" CHECK ((women_count >= 0));
alter table public."department_headcounts" add constraint "department_headcounts_men_count_check" CHECK ((men_count >= 0));
alter table public."department_shift_assignments" add constraint "department_shift_assignments_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])));
alter table public."departments" add constraint "departments_key_format" CHECK ((key ~ '^[a-z][a-z0-9_]*$'::text));
alter table public."departments" add constraint "departments_kind_check" CHECK ((kind = ANY (ARRAY['choir'::text, 'lightweight'::text, 'custom'::text])));
alter table public."disciplinary_letters" add constraint "disciplinary_letters_suspension_dates" CHECK (((type <> 'suspension'::disciplinary_letter_type) OR ((suspension_start IS NOT NULL) AND (suspension_end IS NOT NULL) AND (suspension_end >= suspension_start))));
alter table public."ecodem_session_workers" add constraint "ecodem_session_workers_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])));
alter table public."guest_follow_ups" add constraint "guest_follow_ups_referral_source_check" CHECK ((referral_source = ANY (ARRAY['social_media'::text, 'vpd_elsewhere'::text, 'word_of_mouth'::text])));
alter table public."guest_follow_ups" add constraint "guest_follow_ups_age_range_check" CHECK ((age_range = ANY (ARRAY['under_18'::text, '18_29'::text, '30_40'::text, '40_50'::text, '50_plus'::text])));
alter table public."lesson_progress" add constraint "lesson_progress_watched_ratio_check" CHECK (((watched_ratio >= (0)::numeric) AND (watched_ratio <= (1)::numeric)));
alter table public."lessons" add constraint "lessons_video_check" CHECK ((((video_source IS NULL) AND (video_url IS NULL) AND (video_storage_path IS NULL)) OR ((video_source = 'external'::video_source) AND (video_url IS NOT NULL) AND (video_storage_path IS NULL)) OR ((video_source = 'upload'::video_source) AND (video_storage_path IS NOT NULL) AND (video_url IS NULL))));
alter table public."lessons" add constraint "lessons_video_provider_check" CHECK ((video_provider = ANY (ARRAY['supabase'::text, 'r2'::text])));
alter table public."media_tech_assignments" add constraint "media_tech_assignments_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])));
alter table public."preaching_schedule" add constraint "preaching_schedule_moderator_status_check" CHECK ((moderator_status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])));
alter table public."profiles" add constraint "profiles_member_title_check" CHECK (((member_title IS NULL) OR (member_title = ANY (ARRAY['pastor_principal'::text, 'department_head'::text, 'member'::text]))));
alter table public."profiles" add constraint "media_tech_skills_valid" CHECK ((media_tech_skills <@ ARRAY['stream_operator'::text, 'sound_operator'::text, 'media_inventory'::text, 'camera_operator'::text, 'slides_operator'::text, 'video_content_creator'::text, 'photo_editor'::text]));
alter table public."profiles" add constraint "profiles_sex_check" CHECK ((sex = ANY (ARRAY['M'::text, 'F'::text])));
alter table public."projection_schedule_items" add constraint "projection_schedule_items_kind_check" CHECK ((kind = ANY (ARRAY['bible'::text, 'song'::text, 'image'::text, 'video'::text])));
alter table public."projection_settings" add constraint "projection_settings_singleton" CHECK (id);
alter table public."quiz_questions" add constraint "quiz_questions_options_check" CHECK ((((type = 'multiple_choice'::quiz_question_type) AND (jsonb_array_length(options) = 4)) OR ((type = 'true_false'::quiz_question_type) AND (options IS NULL))));
alter table public."absence_reports" add constraint "absence_reports_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."app_suggestions" add constraint "app_suggestions_submitted_by_fkey" FOREIGN KEY (submitted_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."app_theme" add constraint "app_theme_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."attendance_records" add constraint "attendance_records_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."attendance_records" add constraint "attendance_records_member_id_fkey" FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."availability" add constraint "availability_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."bible_verses" add constraint "bible_verses_book_number_fkey" FOREIGN KEY (book_number) REFERENCES bible_books(number);
alter table public."budget_requests" add constraint "budget_requests_resolved_by_fkey" FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."budget_requests" add constraint "budget_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."budget_requests" add constraint "budget_requests_requesting_department_id_fkey" FOREIGN KEY (requesting_department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."church_program_dates" add constraint "church_program_dates_program_id_fkey" FOREIGN KEY (program_id) REFERENCES church_programs(id) ON DELETE CASCADE;
alter table public."church_programs" add constraint "church_programs_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."course_approvals" add constraint "course_approvals_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."course_approvals" add constraint "course_approvals_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."course_approvals" add constraint "course_approvals_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public."course_enrollments" add constraint "course_enrollments_decided_by_fkey" FOREIGN KEY (decided_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."course_enrollments" add constraint "course_enrollments_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public."course_enrollments" add constraint "course_enrollments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."course_modules" add constraint "course_modules_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public."course_questions" add constraint "course_questions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."course_questions" add constraint "course_questions_course_id_fkey" FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE;
alter table public."course_questions" add constraint "course_questions_answered_by_fkey" FOREIGN KEY (answered_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."courses" add constraint "courses_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."department_announcements" add constraint "department_announcements_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."department_announcements" add constraint "department_announcements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."department_headcounts" add constraint "department_headcounts_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."department_headcounts" add constraint "department_headcounts_recorded_by_fkey" FOREIGN KEY (recorded_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."department_memberships" add constraint "department_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."department_memberships" add constraint "department_memberships_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."department_memberships" add constraint "department_memberships_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."department_monthly_reports" add constraint "department_monthly_reports_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."department_monthly_reports" add constraint "department_monthly_reports_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."department_shift_assignments" add constraint "department_shift_assignments_shift_id_fkey" FOREIGN KEY (shift_id) REFERENCES department_shifts(id) ON DELETE CASCADE;
alter table public."department_shift_assignments" add constraint "department_shift_assignments_working_department_id_fkey" FOREIGN KEY (working_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."department_shift_assignments" add constraint "department_shift_assignments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."department_shifts" add constraint "department_shifts_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."department_shifts" add constraint "department_shifts_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."department_uniforms" add constraint "department_uniforms_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."department_uniforms" add constraint "department_uniforms_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."direct_calls" add constraint "direct_calls_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."direct_calls" add constraint "direct_calls_caller_id_fkey" FOREIGN KEY (caller_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."direct_messages" add constraint "direct_messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."direct_messages" add constraint "direct_messages_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."direct_messages" add constraint "direct_messages_related_replacement_request_id_fkey" FOREIGN KEY (related_replacement_request_id) REFERENCES replacement_requests(id) ON DELETE SET NULL;
alter table public."disciplinary_letters" add constraint "disciplinary_letters_issued_by_fkey" FOREIGN KEY (issued_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."disciplinary_letters" add constraint "disciplinary_letters_member_id_fkey" FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."ecodem_session_workers" add constraint "ecodem_session_workers_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."ecodem_session_workers" add constraint "ecodem_session_workers_session_id_fkey" FOREIGN KEY (session_id) REFERENCES ecodem_sessions(id) ON DELETE CASCADE;
alter table public."ecodem_session_workers" add constraint "ecodem_session_workers_working_department_id_fkey" FOREIGN KEY (working_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."ecodem_sessions" add constraint "ecodem_sessions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."guest_follow_up_transfers" add constraint "guest_follow_up_transfers_to_department_id_fkey" FOREIGN KEY (to_department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."guest_follow_up_transfers" add constraint "guest_follow_up_transfers_transferred_by_fkey" FOREIGN KEY (transferred_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."guest_follow_up_transfers" add constraint "guest_follow_up_transfers_from_department_id_fkey" FOREIGN KEY (from_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."guest_follow_up_transfers" add constraint "guest_follow_up_transfers_guest_follow_up_id_fkey" FOREIGN KEY (guest_follow_up_id) REFERENCES guest_follow_ups(id) ON DELETE CASCADE;
alter table public."guest_follow_ups" add constraint "guest_follow_ups_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."guest_follow_ups" add constraint "guest_follow_ups_assigned_department_id_fkey" FOREIGN KEY (assigned_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."guest_follow_ups" add constraint "guest_follow_ups_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."lesson_progress" add constraint "lesson_progress_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."lesson_progress" add constraint "lesson_progress_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
alter table public."lessons" add constraint "lessons_module_id_fkey" FOREIGN KEY (module_id) REFERENCES course_modules(id) ON DELETE CASCADE;
alter table public."letter_signatures" add constraint "letter_signatures_signer_id_fkey" FOREIGN KEY (signer_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."letter_signatures" add constraint "letter_signatures_letter_id_fkey" FOREIGN KEY (letter_id) REFERENCES disciplinary_letters(id) ON DELETE CASCADE;
alter table public."login_events" add constraint "login_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."media_tech_assignments" add constraint "media_tech_assignments_working_department_id_fkey" FOREIGN KEY (working_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."media_tech_assignments" add constraint "media_tech_assignments_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."media_tech_assignments" add constraint "media_tech_assignments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."member_case_transfers" add constraint "member_case_transfers_to_department_id_fkey" FOREIGN KEY (to_department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."member_case_transfers" add constraint "member_case_transfers_transferred_by_fkey" FOREIGN KEY (transferred_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."member_case_transfers" add constraint "member_case_transfers_member_case_id_fkey" FOREIGN KEY (member_case_id) REFERENCES member_cases(id) ON DELETE CASCADE;
alter table public."member_case_transfers" add constraint "member_case_transfers_from_department_id_fkey" FOREIGN KEY (from_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."member_cases" add constraint "member_cases_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."member_cases" add constraint "member_cases_subject_user_id_fkey" FOREIGN KEY (subject_user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."member_cases" add constraint "member_cases_assigned_department_id_fkey" FOREIGN KEY (assigned_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."menu_labels" add constraint "menu_labels_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."notifications" add constraint "notifications_source_user_id_fkey" FOREIGN KEY (source_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."notifications" add constraint "notifications_recipient_id_fkey" FOREIGN KEY (recipient_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."pastor_meeting_requests" add constraint "pastor_meeting_requests_confirmed_by_fkey" FOREIGN KEY (confirmed_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."pastor_meeting_requests" add constraint "pastor_meeting_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."prayer_requests" add constraint "prayer_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."prayer_requests" add constraint "prayer_requests_handled_by_fkey" FOREIGN KEY (handled_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."preaching_schedule" add constraint "preaching_schedule_moderator_working_department_id_fkey" FOREIGN KEY (moderator_working_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."preaching_schedule" add constraint "preaching_schedule_preacher_id_fkey" FOREIGN KEY (preacher_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."preaching_schedule" add constraint "preaching_schedule_created_by_fkey" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."preaching_schedule" add constraint "preaching_schedule_moderator_id_fkey" FOREIGN KEY (moderator_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."profile_emails" add constraint "profile_emails_id_fkey" FOREIGN KEY (id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."profiles" add constraint "profiles_principal_department_id_fkey" FOREIGN KEY (principal_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."profiles" add constraint "profiles_removed_by_fkey" FOREIGN KEY (removed_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public."projection_schedule_items" add constraint "projection_schedule_items_schedule_id_fkey" FOREIGN KEY (schedule_id) REFERENCES projection_schedules(id) ON DELETE CASCADE;
alter table public."projection_schedules" add constraint "projection_schedules_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id);
alter table public."projection_settings" add constraint "projection_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES profiles(id);
alter table public."push_subscriptions" add constraint "push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."quiz_questions" add constraint "quiz_questions_quiz_id_fkey" FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE;
alter table public."quizzes" add constraint "quizzes_lesson_id_fkey" FOREIGN KEY (lesson_id) REFERENCES lessons(id) ON DELETE CASCADE;
alter table public."replacement_requests" add constraint "replacement_requests_target_singer_id_fkey" FOREIGN KEY (target_singer_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."replacement_requests" add constraint "replacement_requests_service_plan_id_fkey" FOREIGN KEY (service_plan_id) REFERENCES service_plans(id) ON DELETE CASCADE;
alter table public."replacement_requests" add constraint "replacement_requests_claimed_by_fkey" FOREIGN KEY (claimed_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."replacement_requests" add constraint "replacement_requests_requested_by_fkey" FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."rules_documents" add constraint "rules_documents_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."rules_documents" add constraint "rules_documents_department_id_fkey" FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
alter table public."rules_signatures" add constraint "rules_signatures_member_id_fkey" FOREIGN KEY (member_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."rules_signatures" add constraint "rules_signatures_rules_document_id_fkey" FOREIGN KEY (rules_document_id) REFERENCES rules_documents(id) ON DELETE CASCADE;
alter table public."service_plan_singers" add constraint "service_plan_singers_singer_id_fkey" FOREIGN KEY (singer_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."service_plan_singers" add constraint "service_plan_singers_service_plan_id_fkey" FOREIGN KEY (service_plan_id) REFERENCES service_plans(id) ON DELETE CASCADE;
alter table public."service_plan_songs" add constraint "service_plan_songs_service_plan_id_fkey" FOREIGN KEY (service_plan_id) REFERENCES service_plans(id) ON DELETE CASCADE;
alter table public."service_plan_songs" add constraint "service_plan_songs_song_id_fkey" FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE;
alter table public."service_plans" add constraint "service_plans_choir_leader_id_fkey" FOREIGN KEY (choir_leader_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."service_rsvps" add constraint "service_rsvps_working_department_id_fkey" FOREIGN KEY (working_department_id) REFERENCES departments(id) ON DELETE SET NULL;
alter table public."service_rsvps" add constraint "service_rsvps_service_plan_id_fkey" FOREIGN KEY (service_plan_id) REFERENCES service_plans(id) ON DELETE CASCADE;
alter table public."service_rsvps" add constraint "service_rsvps_singer_id_fkey" FOREIGN KEY (singer_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- tenant_id foreign keys (RESTRICT, never CASCADE -- a tenant delete must
-- never silently cascade-erase every table's data for that tenant).
alter table public."absence_reports" add constraint "absence_reports_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."app_suggestions" add constraint "app_suggestions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."app_theme" add constraint "app_theme_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."attendance_records" add constraint "attendance_records_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."availability" add constraint "availability_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."budget_requests" add constraint "budget_requests_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."church_program_dates" add constraint "church_program_dates_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."church_programs" add constraint "church_programs_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."course_approvals" add constraint "course_approvals_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."course_enrollments" add constraint "course_enrollments_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."course_modules" add constraint "course_modules_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."course_questions" add constraint "course_questions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."courses" add constraint "courses_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."department_announcements" add constraint "department_announcements_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."department_headcounts" add constraint "department_headcounts_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."department_memberships" add constraint "department_memberships_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."department_monthly_reports" add constraint "department_monthly_reports_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."department_shift_assignments" add constraint "department_shift_assignments_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."department_shifts" add constraint "department_shifts_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."department_uniforms" add constraint "department_uniforms_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."departments" add constraint "departments_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."direct_calls" add constraint "direct_calls_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."direct_messages" add constraint "direct_messages_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."disciplinary_letters" add constraint "disciplinary_letters_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."ecodem_session_workers" add constraint "ecodem_session_workers_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."ecodem_sessions" add constraint "ecodem_sessions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."guest_follow_up_transfers" add constraint "guest_follow_up_transfers_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."guest_follow_ups" add constraint "guest_follow_ups_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."lesson_progress" add constraint "lesson_progress_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."lessons" add constraint "lessons_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."letter_signatures" add constraint "letter_signatures_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."login_events" add constraint "login_events_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."media_tech_assignments" add constraint "media_tech_assignments_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."member_case_transfers" add constraint "member_case_transfers_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."member_cases" add constraint "member_cases_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."menu_labels" add constraint "menu_labels_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."notifications" add constraint "notifications_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."pastor_meeting_requests" add constraint "pastor_meeting_requests_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."prayer_requests" add constraint "prayer_requests_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."preaching_schedule" add constraint "preaching_schedule_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."profile_emails" add constraint "profile_emails_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."profiles" add constraint "profiles_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."projection_schedule_items" add constraint "projection_schedule_items_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."projection_schedules" add constraint "projection_schedules_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."projection_settings" add constraint "projection_settings_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."push_subscriptions" add constraint "push_subscriptions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."quiz_questions" add constraint "quiz_questions_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."quizzes" add constraint "quizzes_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."replacement_requests" add constraint "replacement_requests_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."rules_documents" add constraint "rules_documents_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."rules_signatures" add constraint "rules_signatures_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."service_plan_singers" add constraint "service_plan_singers_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."service_plan_songs" add constraint "service_plan_songs_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."service_plans" add constraint "service_plans_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."service_rsvps" add constraint "service_rsvps_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public."songs" add constraint "songs_tenant_id_fkey" foreign key (tenant_id) references public.tenants(id) on delete restrict;

-- ==================== INDEXES ====================
CREATE INDEX absence_reports_user_idx ON public.absence_reports USING btree (user_id);
CREATE INDEX attendance_records_date_idx ON public.attendance_records USING btree (service_date);
CREATE UNIQUE INDEX attendance_records_member_unique ON public.attendance_records USING btree (service_date, service_type, member_id) WHERE (member_id IS NOT NULL);
CREATE INDEX availability_date_idx ON public.availability USING btree (date);
CREATE INDEX bible_verses_lookup ON public.bible_verses USING btree (translation, book_number, chapter);
CREATE INDEX budget_requests_department_idx ON public.budget_requests USING btree (requesting_department_id);
CREATE INDEX budget_requests_status_idx ON public.budget_requests USING btree (status);
CREATE INDEX church_program_dates_date_idx ON public.church_program_dates USING btree (date);
CREATE INDEX church_program_dates_program_idx ON public.church_program_dates USING btree (program_id);
CREATE INDEX course_approvals_user_idx ON public.course_approvals USING btree (user_id);
CREATE INDEX course_enrollments_course_idx ON public.course_enrollments USING btree (course_id);
CREATE INDEX course_modules_course_idx ON public.course_modules USING btree (course_id);
CREATE INDEX course_questions_course_idx ON public.course_questions USING btree (course_id);
CREATE INDEX department_announcements_dept_idx ON public.department_announcements USING btree (department_id);
CREATE INDEX department_headcounts_date_idx ON public.department_headcounts USING btree (date);
CREATE INDEX department_memberships_dept_idx ON public.department_memberships USING btree (department_id);
CREATE INDEX department_memberships_user_idx ON public.department_memberships USING btree (user_id);
CREATE INDEX department_monthly_reports_dept_idx ON public.department_monthly_reports USING btree (department_id);
CREATE INDEX department_shift_assignments_shift_idx ON public.department_shift_assignments USING btree (shift_id);
CREATE INDEX department_shifts_date_idx ON public.department_shifts USING btree (date);
CREATE INDEX department_shifts_dept_idx ON public.department_shifts USING btree (department_id);
CREATE INDEX department_uniforms_date_idx ON public.department_uniforms USING btree (date);
CREATE INDEX department_uniforms_dept_idx ON public.department_uniforms USING btree (department_id);
CREATE INDEX direct_calls_recipient_idx ON public.direct_calls USING btree (recipient_id);
CREATE INDEX direct_messages_recipient_idx ON public.direct_messages USING btree (recipient_id);
CREATE INDEX direct_messages_sender_idx ON public.direct_messages USING btree (sender_id);
CREATE INDEX disciplinary_letters_member_idx ON public.disciplinary_letters USING btree (member_id);
CREATE INDEX ecodem_session_workers_session_idx ON public.ecodem_session_workers USING btree (session_id);
CREATE INDEX ecodem_sessions_date_idx ON public.ecodem_sessions USING btree (date);
CREATE INDEX guest_follow_up_transfers_lead_idx ON public.guest_follow_up_transfers USING btree (guest_follow_up_id);
CREATE INDEX lesson_progress_user_idx ON public.lesson_progress USING btree (user_id);
CREATE INDEX lessons_module_idx ON public.lessons USING btree (module_id);
CREATE INDEX letter_signatures_letter_idx ON public.letter_signatures USING btree (letter_id);
CREATE INDEX login_events_logged_in_at_idx ON public.login_events USING btree (logged_in_at DESC);
CREATE INDEX login_events_user_idx ON public.login_events USING btree (user_id);
CREATE INDEX media_tech_assignments_date_idx ON public.media_tech_assignments USING btree (date);
CREATE INDEX member_case_transfers_case_idx ON public.member_case_transfers USING btree (member_case_id);
CREATE INDEX member_cases_subject_idx ON public.member_cases USING btree (subject_user_id);
CREATE INDEX notifications_recipient_idx ON public.notifications USING btree (recipient_id);
CREATE INDEX pastor_meeting_requests_user_idx ON public.pastor_meeting_requests USING btree (user_id);
CREATE INDEX prayer_requests_user_idx ON public.prayer_requests USING btree (user_id);
CREATE INDEX preaching_schedule_date_idx ON public.preaching_schedule USING btree (date);
CREATE UNIQUE INDEX profiles_single_primary_admin ON public.profiles USING btree (is_primary_admin) WHERE is_primary_admin;
CREATE INDEX projection_schedule_items_order ON public.projection_schedule_items USING btree (schedule_id, "position");
CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);
CREATE INDEX quiz_questions_quiz_idx ON public.quiz_questions USING btree (quiz_id);
CREATE INDEX replacement_requests_plan_idx ON public.replacement_requests USING btree (service_plan_id);
CREATE INDEX replacement_requests_status_idx ON public.replacement_requests USING btree (status);
CREATE INDEX rules_signatures_document_idx ON public.rules_signatures USING btree (rules_document_id);
CREATE INDEX rules_signatures_member_idx ON public.rules_signatures USING btree (member_id);
CREATE INDEX service_plan_singers_plan_idx ON public.service_plan_singers USING btree (service_plan_id);
CREATE INDEX service_plan_songs_plan_idx ON public.service_plan_songs USING btree (service_plan_id);
CREATE INDEX service_plans_date_idx ON public.service_plans USING btree (date);
CREATE INDEX service_rsvps_plan_idx ON public.service_rsvps USING btree (service_plan_id);
CREATE INDEX service_rsvps_singer_idx ON public.service_rsvps USING btree (singer_id);

create index if not exists "absence_reports_tenant_id_idx" on public."absence_reports" (tenant_id);
create index if not exists "app_suggestions_tenant_id_idx" on public."app_suggestions" (tenant_id);
create index if not exists "app_theme_tenant_id_idx" on public."app_theme" (tenant_id);
create index if not exists "attendance_records_tenant_id_idx" on public."attendance_records" (tenant_id);
create index if not exists "availability_tenant_id_idx" on public."availability" (tenant_id);
create index if not exists "budget_requests_tenant_id_idx" on public."budget_requests" (tenant_id);
create index if not exists "church_program_dates_tenant_id_idx" on public."church_program_dates" (tenant_id);
create index if not exists "church_programs_tenant_id_idx" on public."church_programs" (tenant_id);
create index if not exists "course_approvals_tenant_id_idx" on public."course_approvals" (tenant_id);
create index if not exists "course_enrollments_tenant_id_idx" on public."course_enrollments" (tenant_id);
create index if not exists "course_modules_tenant_id_idx" on public."course_modules" (tenant_id);
create index if not exists "course_questions_tenant_id_idx" on public."course_questions" (tenant_id);
create index if not exists "courses_tenant_id_idx" on public."courses" (tenant_id);
create index if not exists "department_announcements_tenant_id_idx" on public."department_announcements" (tenant_id);
create index if not exists "department_headcounts_tenant_id_idx" on public."department_headcounts" (tenant_id);
create index if not exists "department_memberships_tenant_id_idx" on public."department_memberships" (tenant_id);
create index if not exists "department_monthly_reports_tenant_id_idx" on public."department_monthly_reports" (tenant_id);
create index if not exists "department_shift_assignments_tenant_id_idx" on public."department_shift_assignments" (tenant_id);
create index if not exists "department_shifts_tenant_id_idx" on public."department_shifts" (tenant_id);
create index if not exists "department_uniforms_tenant_id_idx" on public."department_uniforms" (tenant_id);
create index if not exists "departments_tenant_id_idx" on public."departments" (tenant_id);
create index if not exists "direct_calls_tenant_id_idx" on public."direct_calls" (tenant_id);
create index if not exists "direct_messages_tenant_id_idx" on public."direct_messages" (tenant_id);
create index if not exists "disciplinary_letters_tenant_id_idx" on public."disciplinary_letters" (tenant_id);
create index if not exists "ecodem_session_workers_tenant_id_idx" on public."ecodem_session_workers" (tenant_id);
create index if not exists "ecodem_sessions_tenant_id_idx" on public."ecodem_sessions" (tenant_id);
create index if not exists "guest_follow_up_transfers_tenant_id_idx" on public."guest_follow_up_transfers" (tenant_id);
create index if not exists "guest_follow_ups_tenant_id_idx" on public."guest_follow_ups" (tenant_id);
create index if not exists "lesson_progress_tenant_id_idx" on public."lesson_progress" (tenant_id);
create index if not exists "lessons_tenant_id_idx" on public."lessons" (tenant_id);
create index if not exists "letter_signatures_tenant_id_idx" on public."letter_signatures" (tenant_id);
create index if not exists "login_events_tenant_id_idx" on public."login_events" (tenant_id);
create index if not exists "media_tech_assignments_tenant_id_idx" on public."media_tech_assignments" (tenant_id);
create index if not exists "member_case_transfers_tenant_id_idx" on public."member_case_transfers" (tenant_id);
create index if not exists "member_cases_tenant_id_idx" on public."member_cases" (tenant_id);
create index if not exists "menu_labels_tenant_id_idx" on public."menu_labels" (tenant_id);
create index if not exists "notifications_tenant_id_idx" on public."notifications" (tenant_id);
create index if not exists "pastor_meeting_requests_tenant_id_idx" on public."pastor_meeting_requests" (tenant_id);
create index if not exists "prayer_requests_tenant_id_idx" on public."prayer_requests" (tenant_id);
create index if not exists "preaching_schedule_tenant_id_idx" on public."preaching_schedule" (tenant_id);
create index if not exists "profile_emails_tenant_id_idx" on public."profile_emails" (tenant_id);
create index if not exists "profiles_tenant_id_idx" on public."profiles" (tenant_id);
create index if not exists "projection_schedule_items_tenant_id_idx" on public."projection_schedule_items" (tenant_id);
create index if not exists "projection_schedules_tenant_id_idx" on public."projection_schedules" (tenant_id);
create index if not exists "projection_settings_tenant_id_idx" on public."projection_settings" (tenant_id);
create index if not exists "push_subscriptions_tenant_id_idx" on public."push_subscriptions" (tenant_id);
create index if not exists "quiz_questions_tenant_id_idx" on public."quiz_questions" (tenant_id);
create index if not exists "quizzes_tenant_id_idx" on public."quizzes" (tenant_id);
create index if not exists "replacement_requests_tenant_id_idx" on public."replacement_requests" (tenant_id);
create index if not exists "rules_documents_tenant_id_idx" on public."rules_documents" (tenant_id);
create index if not exists "rules_signatures_tenant_id_idx" on public."rules_signatures" (tenant_id);
create index if not exists "service_plan_singers_tenant_id_idx" on public."service_plan_singers" (tenant_id);
create index if not exists "service_plan_songs_tenant_id_idx" on public."service_plan_songs" (tenant_id);
create index if not exists "service_plans_tenant_id_idx" on public."service_plans" (tenant_id);
create index if not exists "service_rsvps_tenant_id_idx" on public."service_rsvps" (tenant_id);
create index if not exists "songs_tenant_id_idx" on public."songs" (tenant_id);

-- ==================== CURRENT_TENANT_ID() ====================
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select tenant_id from public.profiles where id = auth.uid();
$$;
revoke execute on function public.current_tenant_id() from public;
grant execute on function public.current_tenant_id() to authenticated;

alter table public."absence_reports" alter column tenant_id set default public.current_tenant_id();
alter table public."app_suggestions" alter column tenant_id set default public.current_tenant_id();
alter table public."app_theme" alter column tenant_id set default public.current_tenant_id();
alter table public."attendance_records" alter column tenant_id set default public.current_tenant_id();
alter table public."availability" alter column tenant_id set default public.current_tenant_id();
alter table public."budget_requests" alter column tenant_id set default public.current_tenant_id();
alter table public."church_program_dates" alter column tenant_id set default public.current_tenant_id();
alter table public."church_programs" alter column tenant_id set default public.current_tenant_id();
alter table public."course_approvals" alter column tenant_id set default public.current_tenant_id();
alter table public."course_enrollments" alter column tenant_id set default public.current_tenant_id();
alter table public."course_modules" alter column tenant_id set default public.current_tenant_id();
alter table public."course_questions" alter column tenant_id set default public.current_tenant_id();
alter table public."courses" alter column tenant_id set default public.current_tenant_id();
alter table public."department_announcements" alter column tenant_id set default public.current_tenant_id();
alter table public."department_headcounts" alter column tenant_id set default public.current_tenant_id();
alter table public."department_memberships" alter column tenant_id set default public.current_tenant_id();
alter table public."department_monthly_reports" alter column tenant_id set default public.current_tenant_id();
alter table public."department_shift_assignments" alter column tenant_id set default public.current_tenant_id();
alter table public."department_shifts" alter column tenant_id set default public.current_tenant_id();
alter table public."department_uniforms" alter column tenant_id set default public.current_tenant_id();
alter table public."departments" alter column tenant_id set default public.current_tenant_id();
alter table public."direct_calls" alter column tenant_id set default public.current_tenant_id();
alter table public."direct_messages" alter column tenant_id set default public.current_tenant_id();
alter table public."disciplinary_letters" alter column tenant_id set default public.current_tenant_id();
alter table public."ecodem_session_workers" alter column tenant_id set default public.current_tenant_id();
alter table public."ecodem_sessions" alter column tenant_id set default public.current_tenant_id();
alter table public."guest_follow_up_transfers" alter column tenant_id set default public.current_tenant_id();
alter table public."guest_follow_ups" alter column tenant_id set default public.current_tenant_id();
alter table public."lesson_progress" alter column tenant_id set default public.current_tenant_id();
alter table public."lessons" alter column tenant_id set default public.current_tenant_id();
alter table public."letter_signatures" alter column tenant_id set default public.current_tenant_id();
alter table public."login_events" alter column tenant_id set default public.current_tenant_id();
alter table public."media_tech_assignments" alter column tenant_id set default public.current_tenant_id();
alter table public."member_case_transfers" alter column tenant_id set default public.current_tenant_id();
alter table public."member_cases" alter column tenant_id set default public.current_tenant_id();
alter table public."menu_labels" alter column tenant_id set default public.current_tenant_id();
alter table public."notifications" alter column tenant_id set default public.current_tenant_id();
alter table public."pastor_meeting_requests" alter column tenant_id set default public.current_tenant_id();
alter table public."prayer_requests" alter column tenant_id set default public.current_tenant_id();
alter table public."preaching_schedule" alter column tenant_id set default public.current_tenant_id();
alter table public."profile_emails" alter column tenant_id set default public.current_tenant_id();
alter table public."profiles" alter column tenant_id set default public.current_tenant_id();
alter table public."projection_schedule_items" alter column tenant_id set default public.current_tenant_id();
alter table public."projection_schedules" alter column tenant_id set default public.current_tenant_id();
alter table public."projection_settings" alter column tenant_id set default public.current_tenant_id();
alter table public."push_subscriptions" alter column tenant_id set default public.current_tenant_id();
alter table public."quiz_questions" alter column tenant_id set default public.current_tenant_id();
alter table public."quizzes" alter column tenant_id set default public.current_tenant_id();
alter table public."replacement_requests" alter column tenant_id set default public.current_tenant_id();
alter table public."rules_documents" alter column tenant_id set default public.current_tenant_id();
alter table public."rules_signatures" alter column tenant_id set default public.current_tenant_id();
alter table public."service_plan_singers" alter column tenant_id set default public.current_tenant_id();
alter table public."service_plan_songs" alter column tenant_id set default public.current_tenant_id();
alter table public."service_plans" alter column tenant_id set default public.current_tenant_id();
alter table public."service_rsvps" alter column tenant_id set default public.current_tenant_id();
alter table public."songs" alter column tenant_id set default public.current_tenant_id();

alter table public.tenants enable row level security;
create policy tenants_select_own on public.tenants for select
  using (id = (select public.current_tenant_id()));

-- ==================== FUNCTIONS ====================
CREATE OR REPLACE FUNCTION public.answer_course_question(p_question_id uuid, p_answer_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can answer a course question';
  end if;

  update public.course_questions
  set answer_text = p_answer_text, answered_by = auth.uid(), answered_at = now()
  where id = p_question_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.auto_add_church_program_membership()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_church_program_id uuid;
begin
  if new.status is distinct from 'approved' then
    return new;
  end if;
  if TG_OP = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;

  select id into v_church_program_id from public.departments where key = 'church_program';
  if v_church_program_id is null or new.department_id = v_church_program_id then
    return new;
  end if;

  insert into public.department_memberships (user_id, department_id, role, status, approved_at)
  values (new.user_id, v_church_program_id, 'member', 'approved', now())
  on conflict (user_id, department_id) do nothing;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.availability_unavailable_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.sync_schedule_conflicts_for_unavailable(new.user_id, new.date);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_approve_department_membership(dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or coalesce((select can_approve_any_membership from public.profiles where id = auth.uid()), false)
    or public.can_write_department(dept_id);
$function$
;

CREATE OR REPLACE FUNCTION public.can_create_users()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and role = 'admin' and status = 'approved'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_department(dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and department_id = dept_id and status = 'approved' and role in ('admin', 'secretary')
    );
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_finance()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or public.can_write_department((select id from public.departments where key = 'finance'))
    or public.is_department_secretary((select id from public.departments where key = 'finance'));
$function$
;

CREATE OR REPLACE FUNCTION public.can_post_department_announcement(dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or coalesce((select can_post_global_announcements from public.profiles where id = auth.uid()), false)
    or public.can_write_department(dept_id)
    or public.is_department_secretary(dept_id);
$function$
;

CREATE OR REPLACE FUNCTION public.can_read_department(dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_super_viewer()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or coalesce((select can_view_all_departments from public.profiles where id = auth.uid()), false)
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and department_id = dept_id and status = 'approved'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.can_record_attendance()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or exists (
      select 1 from public.department_memberships dm
      join public.departments d on d.id = dm.department_id
      where dm.user_id = auth.uid() and dm.status = 'approved'
        and dm.role in ('admin', 'secretary') and d.key = 'ushers'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.can_submit_suggestions()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and status = 'approved' and role in ('admin', 'secretary')
    );
$function$
;

CREATE OR REPLACE FUNCTION public.can_write_department(dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and department_id = dept_id and role = 'admin' and status = 'approved'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.check_course_completion(p_course_id uuid, p_user_id uuid DEFAULT auth.uid())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
  from public.lessons l
  join public.course_modules m on m.id = l.module_id
  where m.course_id = p_course_id
    and l.id not in (
      select lesson_id from public.lesson_progress
      where user_id = p_user_id and completed
    );

  if v_remaining = 0 then
    insert into public.course_approvals (user_id, course_id, status)
    values (p_user_id, p_course_id, 'pending')
    on conflict (user_id, course_id) do update set
      status = case when public.course_approvals.status = 'rejected' then 'pending' else public.course_approvals.status end;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_replacement(request_id uuid)
 RETURNS replacement_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req public.replacement_requests;
  caller_voice_parts public.voice_part[];
  v_full_name text;
begin
  select voice_parts into caller_voice_parts from public.profiles where id = auth.uid();

  select * into req from public.replacement_requests where id = request_id for update;

  if req.id is null then
    raise exception 'Request not found';
  end if;

  if req.status <> 'open' then
    raise exception 'This request has already been resolved';
  end if;

  if req.requested_by = auth.uid() then
    raise exception 'You cannot claim your own request';
  end if;

  if req.target_singer_id is not null and req.target_singer_id <> auth.uid() then
    raise exception 'This request is targeted at a specific member';
  end if;

  if caller_voice_parts is null or not (req.voice_part = any (caller_voice_parts)) then
    raise exception 'You do not cover this voice part';
  end if;

  update public.replacement_requests
    set status = 'claimed', claimed_by = auth.uid(), resolved_at = now()
    where id = request_id
    returning * into req;

  update public.service_plan_singers
    set singer_id = auth.uid()
    where service_plan_id = req.service_plan_id
      and singer_id = req.requested_by
      and voice_part = req.voice_part;

  select full_name into v_full_name from public.profiles where id = auth.uid();
  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  values (
    req.requested_by,
    'replacement_response',
    v_full_name || ' accepted your replacement request',
    v_full_name || ' will cover for you.',
    auth.uid()
  );

  return req;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.force_server_timestamp_approved_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    if new.approved_at is not null then new.approved_at := now(); end if;
  elsif new.approved_at is distinct from old.approved_at then
    new.approved_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.force_server_timestamp_moderator_responded_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    if new.moderator_responded_at is not null then new.moderator_responded_at := now(); end if;
  elsif new.moderator_responded_at is distinct from old.moderator_responded_at then
    new.moderator_responded_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.force_server_timestamp_read_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    if new.read_at is not null then new.read_at := now(); end if;
  elsif new.read_at is distinct from old.read_at then
    new.read_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.force_server_timestamp_resolved_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    if new.resolved_at is not null then new.resolved_at := now(); end if;
  elsif new.resolved_at is distinct from old.resolved_at then
    new.resolved_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.force_server_timestamp_responded_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    if new.responded_at is not null then new.responded_at := now(); end if;
  elsif new.responded_at is distinct from old.responded_at then
    new.responded_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.force_server_timestamp_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if TG_OP = 'INSERT' then
    if new.updated_at is not null then new.updated_at := now(); end if;
  elsif new.updated_at is distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_member_code()
 RETURNS text
 LANGUAGE sql
AS $function$
  select upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8));
$function$
;

CREATE OR REPLACE FUNCTION public.get_quiz_questions_for_student(p_lesson_id uuid)
 RETURNS TABLE(id uuid, question_text text, type quiz_question_type, options jsonb, "position" integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select m.course_id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;

  return query
    select qq.id, qq.question_text, qq.type, qq.options, qq.position
    from public.quiz_questions qq
    join public.quizzes qz on qz.id = qq.quiz_id
    where qz.lesson_id = p_lesson_id
    order by qq.position;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_recent_login_activity()
 RETURNS TABLE(user_id uuid, full_name text, logged_in_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.full_name, le.logged_in_at
  from (
    select user_id, logged_in_at,
           row_number() over (partition by user_id order by logged_in_at desc) as rn,
           max(logged_in_at) over (partition by user_id) as most_recent
    from public.login_events
  ) le
  join public.profiles p on p.id = le.user_id
  where le.rn <= 3
    and public.is_pastoral_team()
  order by le.most_recent desc, p.full_name, le.logged_in_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_schedule_conflicts(p_user_id uuid, p_date date, p_exclude_department_id uuid)
 RETURNS TABLE(department_name text, context text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and department_id = p_exclude_department_id
        and role in ('admin', 'secretary') and status = 'approved'
    )
  ) then
    return;
  end if;

  return query
  select d.name, 'Choir (' || sps.voice_part::text || ')'
  from public.service_plan_singers sps
  join public.service_plans sp on sp.id = sps.service_plan_id
  join public.departments d on d.key = 'choir'
  where sps.singer_id = p_user_id and sp.date = p_date and sp.status <> 'draft'
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Preaching (moderator)'
  from public.preaching_schedule ps
  join public.departments d on d.key = 'preaching'
  where ps.moderator_id = p_user_id and ps.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Media & Tech (' || mta.role::text || ')'
  from public.media_tech_assignments mta
  join public.departments d on d.key = 'media_tech'
  where mta.user_id = p_user_id and mta.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Ecodem (' || es.age_group::text || ')'
  from public.ecodem_session_workers esw
  join public.ecodem_sessions es on es.id = esw.session_id
  join public.departments d on d.key = 'ecodem'
  where esw.user_id = p_user_id and es.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, ds.title
  from public.department_shift_assignments dsa
  join public.department_shifts ds on ds.id = dsa.shift_id
  join public.departments d on d.id = ds.department_id
  where dsa.user_id = p_user_id and ds.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select null::text, 'reported absent'
  where exists (
    select 1 from public.absence_reports
    where user_id = p_user_id and absence_date = p_date
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.grant_lesson_credit(p_user_id uuid, p_lesson_id uuid, p_score integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
  v_quiz_id uuid;
  v_passing_score integer;
  v_final_score integer;
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can grant course credit';
  end if;

  select m.course_id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;
  if v_course_id is null then
    raise exception 'Lesson not found';
  end if;

  select id, passing_score into v_quiz_id, v_passing_score from public.quizzes where lesson_id = p_lesson_id;
  v_final_score := case when v_quiz_id is not null then coalesce(p_score, v_passing_score) else null end;

  insert into public.course_enrollments (user_id, course_id, status, decided_by, decided_at)
  values (p_user_id, v_course_id, 'approved', auth.uid(), now())
  on conflict (user_id, course_id) do update set
    status = 'approved', decided_by = auth.uid(), decided_at = now()
  where public.course_enrollments.status is distinct from 'approved';

  insert into public.lesson_progress (user_id, lesson_id, watched_ratio, quiz_score, quiz_attempts, completed, completed_at)
  values (p_user_id, p_lesson_id, 1, v_final_score, case when v_quiz_id is not null then 1 else 0 end, true, now())
  on conflict (user_id, lesson_id) do update set
    watched_ratio = 1,
    quiz_score = coalesce(v_final_score, public.lesson_progress.quiz_score),
    quiz_attempts = greatest(public.lesson_progress.quiz_attempts, case when v_quiz_id is not null then 1 else 0 end),
    completed = true,
    completed_at = coalesce(public.lesson_progress.completed_at, now());

  perform public.check_course_completion(v_course_id, p_user_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.grant_module_credit(p_user_id uuid, p_module_id uuid, p_score integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lesson record;
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can grant course credit';
  end if;

  for v_lesson in select id from public.lessons where module_id = p_module_id loop
    perform public.grant_lesson_credit(p_user_id, v_lesson.id, p_score);
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- tenant_id comes from auth.signUp()'s options.data (same convention as
  -- full_name below) -- the signup flow is responsible for creating the
  -- tenants row and passing its id through before/at signUp() time.
  insert into public.profiles (id, full_name, role, tenant_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'singer',
    (new.raw_user_meta_data->>'tenant_id')::uuid
  );

  insert into public.profile_emails (id, email, tenant_id)
  values (new.id, new.email, (new.raw_user_meta_data->>'tenant_id')::uuid);

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.hard_delete_expired_removed_users()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  with expired as (
    update public.profiles
    set full_name = 'Deleted User', phone = null, permanently_deleted_at = now()
    where removed_at is not null
      and removed_at < now() - interval '60 days'
      and permanently_deleted_at is null
    returning id
  )
  delete from public.profile_emails where id in (select id from expired);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.has_approved_enrollment(p_course_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_school_admin()
    or exists (
      select 1 from public.course_enrollments
      where course_id = p_course_id and user_id = auth.uid() and status = 'approved'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.can_write_department((select id from public.departments where key = 'choir'));
$function$
;

CREATE OR REPLACE FUNCTION public.is_any_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and role = 'admin' and status = 'approved'
    );
$function$
;

CREATE OR REPLACE FUNCTION public.is_church_secretary()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and global_role = 'church_secretary'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_department_secretary(dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.department_memberships
    where user_id = auth.uid() and department_id = dept_id and role = 'secretary' and status = 'approved'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_moderator_for_date(target_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.preaching_schedule
    where date = target_date and moderator_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_moderator_for_song(target_song_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.service_plan_songs sps
    join public.service_plans sp on sp.id = sps.service_plan_id
    where sps.song_id = target_song_id and public.is_moderator_for_date(sp.date)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_pastor_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and global_role = 'pastor_admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_pastoral_team()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or coalesce((select can_manage_pastoral_cases from public.profiles where id = auth.uid()), false);
$function$
;

CREATE OR REPLACE FUNCTION public.is_school_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_super_admin() or coalesce((select is_school_admin from public.profiles where id = auth.uid()), false);
$function$
;

CREATE OR REPLACE FUNCTION public.is_slides_operator_for_date(target_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.media_tech_assignments
    where date = target_date and role = 'slides_operator' and user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and global_role = 'super_admin'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_super_viewer()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and global_role = 'super_viewer'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.log_member_case_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.assigned_department_id is not null then
    insert into public.member_case_transfers (member_case_id, from_department_id, to_department_id, note, transferred_by)
    values (new.id, null, new.assigned_department_id, 'Case opened', new.created_by);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.log_user_login()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.login_events (user_id, logged_in_at)
  values (new.id, new.last_sign_in_at);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_lesson_viewed(p_lesson_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
  v_has_quiz boolean;
  v_has_video boolean;
  v_watched_ratio numeric;
begin
  select m.course_id, exists (select 1 from public.quizzes where lesson_id = p_lesson_id), l.video_source is not null
  into v_course_id, v_has_quiz, v_has_video
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;
  if v_has_quiz then
    raise exception 'This lesson has a quiz — complete it to finish the lesson';
  end if;

  if v_has_video then
    select watched_ratio into v_watched_ratio from public.lesson_progress where user_id = auth.uid() and lesson_id = p_lesson_id;
    if coalesce(v_watched_ratio, 0) < 0.9 then
      raise exception 'Watch at least 90%% of the video first';
    end if;
  end if;

  insert into public.lesson_progress (user_id, lesson_id, completed, completed_at)
  values (auth.uid(), p_lesson_id, true, now())
  on conflict (user_id, lesson_id) do update set
    completed = true,
    completed_at = coalesce(public.lesson_progress.completed_at, now());

  perform public.check_course_completion(v_course_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_prayer_request_prayed(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (
    public.is_pastoral_team()
    or public.can_manage_department((select id from public.departments where key = 'intercession'))
  ) then
    raise exception 'You do not have access to handle prayer requests';
  end if;

  update public.prayer_requests
  set status = 'prayed', handled_by = auth.uid(), handled_at = now()
  where id = p_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_department_announcement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_department_name text;
begin
  select name into v_department_name from public.departments where id = new.department_id;

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select dm.user_id, 'announcement',
         coalesce(v_department_name || ': ', '') || new.title,
         new.body,
         new.created_by
  from public.department_memberships dm
  where dm.department_id = new.department_id
    and dm.status = 'approved'
    and dm.user_id is distinct from new.created_by;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_disciplinary_letter_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_issuer_name text;
begin
  if new.status = 'sent' and old.status is distinct from 'sent' then
    select full_name into v_issuer_name from public.profiles where id = new.issued_by;
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    values (
      new.member_id,
      'disciplinary_letter',
      'You have a new letter',
      coalesce(v_issuer_name, 'The church') || ' has sent you a letter. Please review and sign it.',
      new.issued_by
    );
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_guest_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead_id uuid;
  v_welcoming_dept_id uuid;
begin
  if new.guest_name is not null and not exists (
    select 1 from public.guest_follow_ups
    where lower(trim(full_name)) = lower(trim(new.guest_name))
      and status <> 'assigned_to_department'
      and created_at > now() - interval '30 days'
  ) then
    select id into v_welcoming_dept_id from public.departments where key = 'welcoming_socialisation';

    insert into public.guest_follow_ups (
      full_name, phone, email, city, referral_source, referred_by_name,
      age_range, prayer_request, wants_pastor_meeting, home_church,
      assigned_department_id, source, created_by
    )
    values (
      new.guest_name, new.guest_phone, new.guest_email, new.guest_city,
      new.guest_referral_source, new.guest_referred_by_name,
      new.guest_age_range, new.guest_prayer_request,
      new.guest_wants_pastor_meeting, new.guest_home_church,
      v_welcoming_dept_id, 'attendance_checkin', new.recorded_by
    )
    returning id into v_lead_id;

    if v_welcoming_dept_id is not null then
      insert into public.guest_follow_up_transfers (guest_follow_up_id, from_department_id, to_department_id, note, transferred_by)
      values (v_lead_id, null, v_welcoming_dept_id, 'Initial intake', new.recorded_by);
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_primary_admin_of_suggestion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_primary_admin_id uuid;
  v_full_name text;
begin
  select id into v_primary_admin_id from public.profiles where is_primary_admin limit 1;

  if v_primary_admin_id is null then
    select id into v_primary_admin_id from public.profiles
    where global_role = 'super_admin' order by created_at limit 1;
  end if;

  if v_primary_admin_id is null then
    return new;
  end if;

  select full_name into v_full_name from public.profiles where id = new.submitted_by;

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  values (
    v_primary_admin_id,
    'app_suggestion',
    coalesce(v_full_name, 'Someone') || ' submitted an app suggestion',
    new.message,
    new.submitted_by
  );

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.protect_global_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (
    new.global_role is distinct from old.global_role
    or new.can_view_all_departments is distinct from old.can_view_all_departments
    or new.can_manage_pastoral_cases is distinct from old.can_manage_pastoral_cases
    or new.can_post_global_announcements is distinct from old.can_post_global_announcements
    or new.can_message_any_member is distinct from old.can_message_any_member
    or new.can_approve_any_membership is distinct from old.can_approve_any_membership
  ) and auth.uid() is not null and not public.is_super_admin() then
    raise exception 'Only a Super Admin can change global_role or custom admin powers';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reassign_department_admin(department_id uuid, new_admin_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can reassign a department admin';
  end if;

  update public.department_memberships
  set role = 'admin'
  where department_memberships.department_id = reassign_department_admin.department_id
    and department_memberships.user_id = new_admin_user_id
    and department_memberships.status = 'approved';

  if not found then
    raise exception 'That user does not have an approved membership in this department';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refuse_replacement(p_request_id uuid, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_requester_id uuid;
  v_target_id uuid;
  v_status public.replacement_status;
  v_full_name text;
begin
  select requested_by, target_singer_id, status into v_requester_id, v_target_id, v_status
  from public.replacement_requests where id = p_request_id;

  if v_target_id is null or v_target_id <> auth.uid() then
    raise exception 'You are not the targeted candidate for this request';
  end if;

  if v_status <> 'open' then
    raise exception 'This request has already been resolved';
  end if;

  update public.replacement_requests set target_singer_id = null where id = p_request_id;

  select full_name into v_full_name from public.profiles where id = auth.uid();

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  values (
    v_requester_id,
    'replacement_response',
    v_full_name || ' declined your replacement request',
    coalesce(nullif(p_message, ''), 'The request is now open to anyone eligible.'),
    auth.uid()
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reinstate_user(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can reinstate a user';
  end if;

  if exists (select 1 from public.profiles where id = target_user_id and permanently_deleted_at is not null) then
    raise exception 'This user was permanently deleted after the 60-day grace period and can no longer be reinstated';
  end if;

  update public.profiles
  set removed_at = null, removed_by = null
  where id = target_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_past_date_schedule_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_scheduling_changed boolean;
begin
  if tg_op = 'INSERT' then
    v_scheduling_changed := true;
  elsif tg_table_name = 'preaching_schedule' then
    v_scheduling_changed :=
      new.date is distinct from old.date
      or new.moderator_id is distinct from old.moderator_id
      or new.preacher_name is distinct from old.preacher_name
      or new.guest_name is distinct from old.guest_name
      or new.sermon_theme is distinct from old.sermon_theme
      or new.bible_verse is distinct from old.bible_verse;
  elsif tg_table_name = 'media_tech_assignments' then
    v_scheduling_changed :=
      new.date is distinct from old.date
      or new.role is distinct from old.role
      or new.user_id is distinct from old.user_id;
  else
    v_scheduling_changed := true;
  end if;

  if v_scheduling_changed and new.date < current_date and not public.is_super_admin() then
    raise exception 'Cannot schedule or edit a date that has already passed';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reject_past_date_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.date < current_date and not public.is_super_admin() then
    raise exception 'Cannot schedule or edit a date that has already passed';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_user_from_church(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can remove a user from the church';
  end if;

  delete from public.department_memberships where user_id = target_user_id;

  update public.profiles
  set removed_at = now(), removed_by = auth.uid(), global_role = null
  where id = target_user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.report_absence(p_dates date[], p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_report_id uuid;
  v_first_report_id uuid;
  v_full_name text;
  v_title text;
  v_body text;
  v_date date;
  v_dates date[];
begin
  if p_dates is null or array_length(p_dates, 1) is null then
    raise exception 'At least one date is required';
  end if;
  if array_length(p_dates, 1) > 180 then
    raise exception 'Cannot report more than 180 dates at once';
  end if;

  -- Sorted, de-duplicated — the same date picked twice shouldn't
  -- create two absence_reports rows for it.
  select array_agg(distinct d order by d) into v_dates from unnest(p_dates) as d;

  select full_name into v_full_name from public.profiles where id = auth.uid();

  v_title := case when array_length(v_dates, 1) = 1
    then v_full_name || ' reported an absence'
    else v_full_name || ' reported ' || array_length(v_dates, 1)::text || ' days unavailable' end;
  v_body := v_full_name || ' will be unavailable on: '
    || (select string_agg(d::text, ', ' order by d) from unnest(v_dates) as d)
    || case when p_reason is not null and p_reason <> '' then '. Reason: ' || p_reason else '' end;

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select recipient_id, 'absence', v_title, v_body, auth.uid()
  from (
    select dm2.user_id as recipient_id
    from public.department_memberships dm1
    join public.department_memberships dm2
      on dm2.department_id = dm1.department_id
     and dm2.role in ('admin', 'secretary')
     and dm2.status = 'approved'
    where dm1.user_id = auth.uid() and dm1.status = 'approved'
    union
    select id as recipient_id
    from public.profiles
    where global_role in ('super_admin', 'pastor_admin', 'church_secretary')
  ) recipients
  where recipient_id <> auth.uid();

  foreach v_date in array v_dates loop
    insert into public.absence_reports (user_id, absence_date, reason)
    values (auth.uid(), v_date, p_reason)
    returning id into v_report_id;

    if v_first_report_id is null then
      v_first_report_id := v_report_id;
    end if;

    -- Fires sync_on_unavailable (sql/052) for this specific date —
    -- every date picked gets its own conflict check across every
    -- department, whether or not the dates are consecutive.
    insert into public.availability (user_id, date, status)
    values (auth.uid(), v_date, 'unavailable')
    on conflict (user_id, date) do update set status = 'unavailable';
  end loop;

  return v_first_report_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.report_absence(p_date date, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_report_id uuid;
  v_full_name text;
  v_title text;
  v_body text;
begin
  insert into public.absence_reports (user_id, absence_date, reason)
  values (auth.uid(), p_date, p_reason)
  returning id into v_report_id;

  select full_name into v_full_name from public.profiles where id = auth.uid();
  v_title := v_full_name || ' reported an absence';
  v_body := v_full_name || ' will be unavailable on ' || p_date::text
    || case when p_reason is not null and p_reason <> '' then '. Reason: ' || p_reason else '' end;

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select recipient_id, 'absence', v_title, v_body, auth.uid()
  from (
    select dm2.user_id as recipient_id
    from public.department_memberships dm1
    join public.department_memberships dm2
      on dm2.department_id = dm1.department_id
     and dm2.role in ('admin', 'secretary')
     and dm2.status = 'approved'
    where dm1.user_id = auth.uid() and dm1.status = 'approved'
    union
    select id as recipient_id
    from public.profiles
    where global_role in ('super_admin', 'pastor_admin', 'church_secretary')
  ) recipients
  where recipient_id <> auth.uid();

  -- Upserting here fires sync_on_unavailable below, which handles every
  -- department's schedule-conflict side effects — the same trigger also
  -- fires when someone instead marks a date unavailable directly on
  -- their Availability Calendar, so this function no longer needs to
  -- duplicate that logic itself.
  insert into public.availability (user_id, date, status)
  values (auth.uid(), p_date, 'unavailable')
  on conflict (user_id, date) do update set status = 'unavailable';

  return v_report_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_course_enrollment(p_course_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.courses where id = p_course_id and published) then
    raise exception 'Course not found';
  end if;

  insert into public.course_enrollments (user_id, course_id, status, requested_at, decided_by, decided_at)
  values (auth.uid(), p_course_id, 'pending', now(), null, null)
  on conflict (user_id, course_id) do update set
    status = 'pending', requested_at = now(), decided_by = null, decided_at = null
  where public.course_enrollments.status is distinct from 'approved';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_to_pastor_meeting_request(p_request_id uuid, p_status pastor_meeting_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.is_church_secretary() or public.is_super_admin()) then
    raise exception 'Only the Church Secretary can respond to a pastor meeting request';
  end if;
  if p_status = 'pending' then
    raise exception 'Cannot set a request back to pending';
  end if;

  update public.pastor_meeting_requests
  set status = p_status, confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_request_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.review_course_approval(p_approval_id uuid, p_status course_approval_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can review course approvals';
  end if;

  update public.course_approvals
  set status = p_status, approved_by = auth.uid(), approved_at = now()
  where id = p_approval_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.review_course_enrollment(p_enrollment_id uuid, p_status course_enrollment_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can review enrollment requests';
  end if;
  if p_status = 'pending' then
    raise exception 'Cannot set an enrollment back to pending';
  end if;

  update public.course_enrollments
  set status = p_status, decided_by = auth.uid(), decided_at = now()
  where id = p_enrollment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_replacement_request(p_service_plan_id uuid, p_voice_part voice_part, p_target_singer_id uuid, p_message text)
 RETURNS replacement_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request public.replacement_requests;
  v_choir_id uuid;
  v_full_name text;
  v_plan_title text;
  v_plan_date date;
begin
  insert into public.replacement_requests (service_plan_id, requested_by, voice_part, target_singer_id)
  values (p_service_plan_id, auth.uid(), p_voice_part, p_target_singer_id)
  returning * into v_request;

  select full_name into v_full_name from public.profiles where id = auth.uid();
  select title, date into v_plan_title, v_plan_date from public.service_plans where id = p_service_plan_id;

  if p_target_singer_id is not null then
    insert into public.direct_messages (sender_id, recipient_id, body, related_replacement_request_id)
    values (
      auth.uid(),
      p_target_singer_id,
      coalesce(
        nullif(p_message, ''),
        v_full_name || ' asked you to cover ' || coalesce(v_plan_title, 'a service') || ' on ' || v_plan_date::text || '.'
      ),
      v_request.id
    );
  end if;

  select id into v_choir_id from public.departments where key = 'choir';

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select dm.user_id, 'replacement_request',
    v_full_name || ' requested a replacement',
    v_full_name || ' needs coverage for ' || coalesce(v_plan_title, 'a service') || ' on ' || v_plan_date::text || '.',
    auth.uid()
  from public.department_memberships dm
  where dm.department_id = v_choir_id
    and dm.role in ('admin', 'secretary')
    and dm.status = 'approved'
    and dm.user_id <> auth.uid();

  return v_request;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_code()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.member_code is null then
    loop
      new.member_code := public.generate_member_code();
      exit when not exists (select 1 from public.profiles where member_code = new.member_code);
    end loop;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shares_department(a uuid, b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.department_memberships dm1
    join public.department_memberships dm2 on dm2.department_id = dm1.department_id
    where dm1.user_id = a and dm1.status = 'approved'
      and dm2.user_id = b and dm2.status = 'approved'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.start_direct_call(p_recipient_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_room text;
  v_caller_name text;
begin
  if not public.is_any_admin() then
    raise exception 'Only an admin can start a direct call';
  end if;
  if p_recipient_id = auth.uid() then
    raise exception 'Cannot call yourself';
  end if;

  v_room := 'choir-app-call-' || gen_random_uuid()::text;
  select full_name into v_caller_name from public.profiles where id = auth.uid();

  insert into public.direct_calls (caller_id, recipient_id, room)
  values (auth.uid(), p_recipient_id, v_room);

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  values (p_recipient_id, 'call_invite', coalesce(v_caller_name, 'Someone') || ' is calling you', v_room, auth.uid());

  return v_room;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_quiz_attempt(p_lesson_id uuid, p_answers jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
  v_watched_ratio numeric;
  v_passing_score integer;
  v_quiz_id uuid;
  v_total integer := 0;
  v_correct integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_q record;
  v_submitted text;
  v_is_correct boolean;
  v_passed boolean;
begin
  select c.id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id join public.courses c on c.id = m.course_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;

  select id, passing_score into v_quiz_id, v_passing_score from public.quizzes where lesson_id = p_lesson_id;
  if v_quiz_id is null then
    raise exception 'This lesson has no quiz';
  end if;

  select watched_ratio into v_watched_ratio from public.lesson_progress where user_id = auth.uid() and lesson_id = p_lesson_id;
  if coalesce(v_watched_ratio, 0) < 0.9 and exists (select 1 from public.lessons where id = p_lesson_id and video_source is not null) then
    raise exception 'Watch at least 90%% of the video before taking the quiz';
  end if;

  for v_q in select id, correct_answer from public.quiz_questions where quiz_id = v_quiz_id order by position loop
    v_total := v_total + 1;
    select value ->> 'answer' into v_submitted
    from jsonb_array_elements(p_answers) as value
    where value ->> 'question_id' = v_q.id::text;

    v_is_correct := v_submitted is not null and lower(trim(v_submitted)) = lower(trim(v_q.correct_answer));
    if v_is_correct then v_correct := v_correct + 1; end if;

    v_results := v_results || jsonb_build_object('question_id', v_q.id, 'correct', v_is_correct);
  end loop;

  v_passed := v_correct >= v_passing_score;

  insert into public.lesson_progress (user_id, lesson_id, quiz_score, quiz_attempts, completed, completed_at)
  values (auth.uid(), p_lesson_id, v_correct, 1, v_passed, case when v_passed then now() else null end)
  on conflict (user_id, lesson_id) do update set
    quiz_score = v_correct,
    quiz_attempts = public.lesson_progress.quiz_attempts + 1,
    completed = public.lesson_progress.completed or v_passed,
    completed_at = case when public.lesson_progress.completed then public.lesson_progress.completed_at when v_passed then now() else null end;

  if v_passed then
    perform public.check_course_completion(v_course_id);
  end if;

  return jsonb_build_object('score', v_correct, 'total', v_total, 'passed', v_passed, 'results', v_results);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_schedule_conflicts_for_unavailable(p_user_id uuid, p_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_full_name text;
  v_choir_id uuid;
  v_conflict record;
  v_replacement_id uuid;
begin
  select full_name into v_full_name from public.profiles where id = p_user_id;
  select id into v_choir_id from public.departments where key = 'choir';

  for v_conflict in
    select sps.service_plan_id, sps.voice_part
    from public.service_plan_singers sps
    join public.service_plans sp on sp.id = sps.service_plan_id
    where sps.singer_id = p_user_id and sp.date = p_date and sp.status <> 'draft'
  loop
    insert into public.replacement_requests (service_plan_id, requested_by, voice_part, target_singer_id)
    values (v_conflict.service_plan_id, p_user_id, v_conflict.voice_part, null)
    returning id into v_replacement_id;

    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' needs a replacement (auto-opened)',
      v_full_name || ' is unavailable on ' || p_date::text || ' and was scheduled for ' || v_conflict.voice_part::text
        || ' — a replacement request was opened automatically.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_choir_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select id from public.departments where key = 'preaching'
    and exists (select 1 from public.preaching_schedule where moderator_id = p_user_id and date = p_date)
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is scheduled as moderator on ' || p_date::text || '. A replacement needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select mta.role, d.id as department_id
    from public.media_tech_assignments mta
    cross join (select id from public.departments where key = 'media_tech') d
    where mta.user_id = p_user_id and mta.date = p_date
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is assigned as ' || v_conflict.role::text || ' on ' || p_date::text || '. A replacement needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.department_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select es.age_group, d.id as department_id
    from public.ecodem_session_workers esw
    join public.ecodem_sessions es on es.id = esw.session_id
    cross join (select id from public.departments where key = 'ecodem') d
    where esw.user_id = p_user_id and es.date = p_date
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is assigned to ' || v_conflict.age_group::text || ' on ' || p_date::text || '. A replacement worker needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.department_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select ds.title, ds.department_id
    from public.department_shift_assignments dsa
    join public.department_shifts ds on ds.id = dsa.shift_id
    where dsa.user_id = p_user_id and ds.date = p_date
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is assigned to "' || v_conflict.title || '" on ' || p_date::text || '. A replacement needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.department_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_guest_to_department(p_guest_follow_up_id uuid, p_department_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_department_id uuid;
begin
  select assigned_department_id into v_current_department_id
  from public.guest_follow_ups where id = p_guest_follow_up_id;

  if not (
    public.is_pastoral_team()
    or (v_current_department_id is not null and public.can_write_department(v_current_department_id))
  ) then
    raise exception 'You do not currently hold this case';
  end if;

  update public.guest_follow_ups
  set assigned_department_id = p_department_id, updated_at = now()
  where id = p_guest_follow_up_id;

  insert into public.guest_follow_up_transfers (guest_follow_up_id, from_department_id, to_department_id, note, transferred_by)
  values (p_guest_follow_up_id, v_current_department_id, p_department_id, nullif(p_note, ''), auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_member_case_to_department(p_member_case_id uuid, p_department_id uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current_department_id uuid;
begin
  select assigned_department_id into v_current_department_id
  from public.member_cases where id = p_member_case_id;

  if not (
    public.is_pastoral_team()
    or (v_current_department_id is not null and public.can_write_department(v_current_department_id))
  ) then
    raise exception 'You do not currently hold this case';
  end if;

  update public.member_cases
  set assigned_department_id = p_department_id, updated_at = now()
  where id = p_member_case_id;

  insert into public.member_case_transfers (member_case_id, from_department_id, to_department_id, note, transferred_by)
  values (p_member_case_id, v_current_department_id, p_department_id, nullif(p_note, ''), auth.uid());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_watch_progress(p_lesson_id uuid, p_ratio numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_course_id uuid;
begin
  select m.course_id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, watched_ratio)
  values (auth.uid(), p_lesson_id, greatest(0, least(1, p_ratio)))
  on conflict (user_id, lesson_id)
  do update set watched_ratio = greatest(public.lesson_progress.watched_ratio, excluded.watched_ratio), updated_at = now();
end;
$function$
;

-- ==================== TRIGGERS ====================
CREATE TRIGGER app_suggestion_notify AFTER INSERT ON public.app_suggestions FOR EACH ROW EXECUTE FUNCTION notify_primary_admin_of_suggestion();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.app_theme FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER attendance_guest_follow_up AFTER INSERT ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION notify_guest_attendance();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.availability FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER sync_on_unavailable_insert AFTER INSERT ON public.availability FOR EACH ROW WHEN ((new.status = 'unavailable'::availability_status)) EXECUTE FUNCTION availability_unavailable_trigger();
CREATE TRIGGER sync_on_unavailable_update AFTER UPDATE ON public.availability FOR EACH ROW WHEN (((new.status = 'unavailable'::availability_status) AND (old.status IS DISTINCT FROM 'unavailable'::availability_status))) EXECUTE FUNCTION availability_unavailable_trigger();
CREATE TRIGGER force_resolved_at BEFORE INSERT OR UPDATE ON public.budget_requests FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_resolved_at();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.church_programs FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.courses FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER department_announcement_notify AFTER INSERT ON public.department_announcements FOR EACH ROW EXECUTE FUNCTION notify_department_announcement();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.department_headcounts FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER auto_add_church_program AFTER INSERT OR UPDATE ON public.department_memberships FOR EACH ROW EXECUTE FUNCTION auto_add_church_program_membership();
CREATE TRIGGER force_approved_at BEFORE INSERT OR UPDATE ON public.department_memberships FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_approved_at();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.department_monthly_reports FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER force_responded_at BEFORE INSERT OR UPDATE ON public.department_shift_assignments FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_responded_at();
CREATE TRIGGER reject_past_date_write BEFORE INSERT OR UPDATE ON public.department_shifts FOR EACH ROW EXECUTE FUNCTION reject_past_date_writes();
CREATE TRIGGER reject_past_date_write BEFORE INSERT OR UPDATE ON public.department_uniforms FOR EACH ROW EXECUTE FUNCTION reject_past_date_writes();
CREATE TRIGGER force_read_at BEFORE INSERT OR UPDATE ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_read_at();
CREATE TRIGGER notify_on_disciplinary_letter_sent AFTER UPDATE ON public.disciplinary_letters FOR EACH ROW EXECUTE FUNCTION notify_disciplinary_letter_sent();
CREATE TRIGGER force_responded_at BEFORE INSERT OR UPDATE ON public.ecodem_session_workers FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_responded_at();
CREATE TRIGGER reject_past_date_write BEFORE INSERT OR UPDATE ON public.ecodem_sessions FOR EACH ROW EXECUTE FUNCTION reject_past_date_writes();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.guest_follow_ups FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER force_responded_at BEFORE INSERT OR UPDATE ON public.media_tech_assignments FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_responded_at();
CREATE TRIGGER reject_past_date_schedule_write BEFORE INSERT OR UPDATE ON public.media_tech_assignments FOR EACH ROW EXECUTE FUNCTION reject_past_date_schedule_writes();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.member_cases FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER member_case_created AFTER INSERT ON public.member_cases FOR EACH ROW EXECUTE FUNCTION log_member_case_creation();
CREATE TRIGGER force_updated_at BEFORE INSERT OR UPDATE ON public.menu_labels FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_updated_at();
CREATE TRIGGER force_read_at BEFORE INSERT OR UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_read_at();
CREATE TRIGGER force_moderator_responded_at BEFORE INSERT OR UPDATE ON public.preaching_schedule FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_moderator_responded_at();
CREATE TRIGGER reject_past_date_schedule_write BEFORE INSERT OR UPDATE ON public.preaching_schedule FOR EACH ROW EXECUTE FUNCTION reject_past_date_schedule_writes();
CREATE TRIGGER protect_global_role_trigger BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_global_role();
CREATE TRIGGER set_member_code_on_insert BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_member_code();
CREATE TRIGGER reject_past_date_write BEFORE INSERT OR UPDATE ON public.service_plans FOR EACH ROW EXECUTE FUNCTION reject_past_date_writes();
CREATE TRIGGER force_responded_at BEFORE INSERT OR UPDATE ON public.service_rsvps FOR EACH ROW EXECUTE FUNCTION force_server_timestamp_responded_at();

-- ==================== ROW LEVEL SECURITY ====================
alter table public."absence_reports" enable row level security;
alter table public."app_suggestions" enable row level security;
alter table public."app_theme" enable row level security;
alter table public."attendance_records" enable row level security;
alter table public."availability" enable row level security;
alter table public."bible_books" enable row level security;
alter table public."bible_verses" enable row level security;
alter table public."budget_requests" enable row level security;
alter table public."church_program_dates" enable row level security;
alter table public."church_programs" enable row level security;
alter table public."course_approvals" enable row level security;
alter table public."course_enrollments" enable row level security;
alter table public."course_modules" enable row level security;
alter table public."course_questions" enable row level security;
alter table public."courses" enable row level security;
alter table public."department_announcements" enable row level security;
alter table public."department_headcounts" enable row level security;
alter table public."department_memberships" enable row level security;
alter table public."department_monthly_reports" enable row level security;
alter table public."department_shift_assignments" enable row level security;
alter table public."department_shifts" enable row level security;
alter table public."department_uniforms" enable row level security;
alter table public."departments" enable row level security;
alter table public."direct_calls" enable row level security;
alter table public."direct_messages" enable row level security;
alter table public."disciplinary_letters" enable row level security;
alter table public."ecodem_session_workers" enable row level security;
alter table public."ecodem_sessions" enable row level security;
alter table public."guest_follow_up_transfers" enable row level security;
alter table public."guest_follow_ups" enable row level security;
alter table public."lesson_progress" enable row level security;
alter table public."lessons" enable row level security;
alter table public."letter_signatures" enable row level security;
alter table public."login_events" enable row level security;
alter table public."media_tech_assignments" enable row level security;
alter table public."member_case_transfers" enable row level security;
alter table public."member_cases" enable row level security;
alter table public."menu_labels" enable row level security;
alter table public."notifications" enable row level security;
alter table public."pastor_meeting_requests" enable row level security;
alter table public."prayer_requests" enable row level security;
alter table public."preaching_schedule" enable row level security;
alter table public."profile_emails" enable row level security;
alter table public."profiles" enable row level security;
alter table public."projection_schedule_items" enable row level security;
alter table public."projection_schedules" enable row level security;
alter table public."projection_settings" enable row level security;
alter table public."push_subscriptions" enable row level security;
alter table public."quiz_questions" enable row level security;
alter table public."quizzes" enable row level security;
alter table public."replacement_requests" enable row level security;
alter table public."rules_documents" enable row level security;
alter table public."rules_signatures" enable row level security;
alter table public."service_plan_singers" enable row level security;
alter table public."service_plan_songs" enable row level security;
alter table public."service_plans" enable row level security;
alter table public."service_rsvps" enable row level security;
alter table public."songs" enable row level security;

create policy "users can read their own absence reports" on public."absence_reports" for select to authenticated using (((user_id = auth.uid()) OR is_super_admin() OR is_pastor_admin() OR is_church_secretary()));
create policy "suggestions are readable by super admins" on public."app_suggestions" for select to authenticated using (is_super_admin());
create policy "suggestions are submitted by elevated roles" on public."app_suggestions" for insert to authenticated with check (((submitted_by = auth.uid()) AND can_submit_suggestions()));
create policy "app theme is managed by super admin" on public."app_theme" for all to authenticated using (is_super_admin()) with check (is_super_admin());
create policy "app theme is readable by everyone" on public."app_theme" for select to authenticated using (true);
create policy "attendance is deleted by ushers/admins" on public."attendance_records" for delete to authenticated using (can_record_attendance());
create policy "attendance is readable by those who record it" on public."attendance_records" for select to authenticated using ((can_record_attendance() OR (member_id = auth.uid())));
create policy "attendance is recorded by ushers/admins" on public."attendance_records" for insert to authenticated with check (can_record_attendance());
create policy "users can delete their own availability" on public."availability" for delete to authenticated using ((auth.uid() = user_id));
create policy "users can read their own availability" on public."availability" for select to authenticated using (((auth.uid() = user_id) OR is_admin() OR (EXISTS ( SELECT 1
   FROM department_memberships dm1
  WHERE ((dm1.user_id = availability.user_id) AND (dm1.status = 'approved'::membership_status) AND (EXISTS ( SELECT 1
           FROM department_memberships dm2
          WHERE ((dm2.department_id = dm1.department_id) AND (dm2.user_id = auth.uid()) AND (dm2.status = 'approved'::membership_status)))))))));
create policy "users can update their own availability" on public."availability" for update to authenticated using ((auth.uid() = user_id));
create policy "users can upsert their own availability" on public."availability" for insert to authenticated with check ((auth.uid() = user_id));
create policy "bible_books_select" on public."bible_books" for select to authenticated using (true);
create policy "bible_verses_select" on public."bible_verses" for select to authenticated using (true);
create policy "dept admins can submit budget requests" on public."budget_requests" for insert to authenticated with check (((requested_by = auth.uid()) AND can_write_department(requesting_department_id)));
create policy "finance can update budget requests" on public."budget_requests" for update to authenticated using (can_manage_finance()) with check (can_manage_finance());
create policy "requesters and finance can read budget requests" on public."budget_requests" for select to authenticated using (((requested_by = auth.uid()) OR can_write_department(requesting_department_id) OR can_manage_finance()));
create policy "church program dates are managed by department admins" on public."church_program_dates" for all to authenticated using ((is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'church_program'::text))))) with check ((is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'church_program'::text)))));
create policy "church program dates are readable by authenticated users" on public."church_program_dates" for select to authenticated using (true);
create policy "church programs are managed by department admins" on public."church_programs" for all to authenticated using ((is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'church_program'::text))))) with check ((is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'church_program'::text)))));
create policy "church programs are readable by authenticated users" on public."church_programs" for select to authenticated using (true);
create policy "course approvals are visible to the student or school admins" on public."course_approvals" for select to authenticated using (((user_id = auth.uid()) OR is_school_admin()));
create policy "school admins can delete course approvals" on public."course_approvals" for delete to authenticated using (is_school_admin());
create policy "enrollments are visible to the student or school admins" on public."course_enrollments" for select to authenticated using (((user_id = auth.uid()) OR is_school_admin()));
create policy "students can drop their own enrollment" on public."course_enrollments" for delete to authenticated using (((user_id = auth.uid()) OR is_school_admin()));
create policy "students request their own enrollment" on public."course_enrollments" for insert to authenticated with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM courses
  WHERE ((courses.id = course_enrollments.course_id) AND courses.published)))));
create policy "modules are managed by school admins" on public."course_modules" for all to authenticated using (is_school_admin()) with check (is_school_admin());
create policy "modules are readable if course is readable" on public."course_modules" for select to authenticated using (has_approved_enrollment(course_id));
create policy "course questions are visible to the asker or school admins" on public."course_questions" for select to authenticated using (((user_id = auth.uid()) OR is_school_admin()));
create policy "enrolled students can ask a course question" on public."course_questions" for insert to authenticated with check (((user_id = auth.uid()) AND has_approved_enrollment(course_id)));
create policy "courses are managed by school admins" on public."courses" for all to authenticated using (is_school_admin()) with check (is_school_admin());
create policy "courses are readable if published or by school admins" on public."courses" for select to authenticated using ((published OR is_school_admin()));
create policy "announcements are readable by department members" on public."department_announcements" for select to authenticated using (can_read_department(department_id));
create policy "authorized posters can create announcements" on public."department_announcements" for insert to authenticated with check (can_post_department_announcement(department_id));
create policy "department admins delete announcements" on public."department_announcements" for delete to authenticated using ((can_write_department(department_id) OR (created_by = auth.uid())));
create policy "department admins update announcements" on public."department_announcements" for update to authenticated using ((can_write_department(department_id) OR (created_by = auth.uid()))) with check ((can_write_department(department_id) OR (created_by = auth.uid())));
create policy "headcounts are managed by department managers" on public."department_headcounts" for all to authenticated using (can_manage_department(department_id)) with check (can_manage_department(department_id));
create policy "headcounts are readable by department managers or pastoral team" on public."department_headcounts" for select to authenticated using ((can_manage_department(department_id) OR is_pastoral_team()));
create policy "authorized creators can add memberships for new users" on public."department_memberships" for insert to authenticated with check ((can_create_users() AND (((status = 'approved'::membership_status) AND can_approve_department_membership(department_id)) OR ((status = 'pending'::membership_status) AND (role = 'member'::department_role)))));
create policy "department admins manage memberships" on public."department_memberships" for update to authenticated using (can_approve_department_membership(department_id)) with check (can_approve_department_membership(department_id));
create policy "department admins remove memberships" on public."department_memberships" for delete to authenticated using (can_write_department(department_id));
create policy "users can read their own memberships" on public."department_memberships" for select to authenticated using (((auth.uid() = user_id) OR can_approve_department_membership(department_id) OR is_super_viewer() OR is_church_secretary()));
create policy "users can request their own membership" on public."department_memberships" for insert to authenticated with check (((auth.uid() = user_id) AND (role = 'member'::department_role) AND (status = 'pending'::membership_status)));
create policy "monthly reports are inserted by department admins" on public."department_monthly_reports" for insert to authenticated with check (can_write_department(department_id));
create policy "monthly reports are readable by those with access" on public."department_monthly_reports" for select to authenticated using (can_read_department(department_id));
create policy "monthly reports are updated by department admins" on public."department_monthly_reports" for update to authenticated using (can_write_department(department_id)) with check (can_write_department(department_id));
create policy "assignee can respond to their own shift assignment" on public."department_shift_assignments" for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "department admins manage shift assignments" on public."department_shift_assignments" for all to authenticated using ((EXISTS ( SELECT 1
   FROM department_shifts s
  WHERE ((s.id = department_shift_assignments.shift_id) AND can_write_department(s.department_id))))) with check ((EXISTS ( SELECT 1
   FROM department_shifts s
  WHERE ((s.id = department_shift_assignments.shift_id) AND can_write_department(s.department_id)))));
create policy "shift assignments are readable by department members" on public."department_shift_assignments" for select to authenticated using ((EXISTS ( SELECT 1
   FROM department_shifts s
  WHERE ((s.id = department_shift_assignments.shift_id) AND can_read_department(s.department_id)))));
create policy "department admins manage shifts" on public."department_shifts" for all to authenticated using (can_write_department(department_id)) with check (can_write_department(department_id));
create policy "shifts are readable by department members" on public."department_shifts" for select to authenticated using ((can_read_department(department_id) OR (EXISTS ( SELECT 1
   FROM departments d
  WHERE ((d.id = department_shifts.department_id) AND d.is_public_calendar)))));
create policy "uniform schedule is managed by department admins" on public."department_uniforms" for all to authenticated using (can_write_department(department_id)) with check (can_write_department(department_id));
create policy "uniform schedule is readable by department" on public."department_uniforms" for select to authenticated using (can_read_department(department_id));
create policy "department admins update their department" on public."departments" for update to authenticated using (can_write_department(id)) with check (can_write_department(id));
create policy "departments are readable by authenticated users" on public."departments" for select to authenticated using (true);
create policy "super admins create lightweight departments" on public."departments" for insert to authenticated with check ((is_super_admin() AND (kind = 'lightweight'::text)));
create policy "direct calls are readable by those involved" on public."direct_calls" for select to authenticated using (((caller_id = auth.uid()) OR (recipient_id = auth.uid())));
create policy "members can message department-mates" on public."direct_messages" for insert to authenticated with check (((sender_id = auth.uid()) AND (shares_department(auth.uid(), recipient_id) OR is_super_admin() OR is_pastor_admin() OR is_church_secretary() OR COALESCE(( SELECT profiles.can_message_any_member
   FROM profiles
  WHERE (profiles.id = auth.uid())), false))));
create policy "participants can read their messages" on public."direct_messages" for select to authenticated using (((sender_id = auth.uid()) OR (recipient_id = auth.uid()) OR is_super_admin()));
create policy "recipients can mark messages read" on public."direct_messages" for update to authenticated using ((recipient_id = auth.uid())) with check ((recipient_id = auth.uid()));
create policy "super admin can delete any message" on public."direct_messages" for delete to authenticated using (is_super_admin());
create policy "disciplinary letters are managed by pastoral admins" on public."disciplinary_letters" for all to authenticated using ((is_pastor_admin() OR is_super_admin())) with check ((is_pastor_admin() OR is_super_admin()));
create policy "disciplinary letters are readable by the named member" on public."disciplinary_letters" for select to authenticated using ((member_id = auth.uid()));
create policy "the named member can acknowledge their own sent letter" on public."disciplinary_letters" for update to authenticated using (((member_id = auth.uid()) AND (status = 'sent'::disciplinary_letter_status))) with check (((member_id = auth.uid()) AND (status = 'acknowledged'::disciplinary_letter_status)));
create policy "department admins manage ecodem session workers" on public."ecodem_session_workers" for all to authenticated using (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'ecodem'::text)))) with check (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'ecodem'::text))));
create policy "ecodem session workers readable by department members" on public."ecodem_session_workers" for select to authenticated using (can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'ecodem'::text))));
create policy "worker can respond to their own ecodem assignment" on public."ecodem_session_workers" for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "department admins manage ecodem sessions" on public."ecodem_sessions" for all to authenticated using (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'ecodem'::text)))) with check (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'ecodem'::text))));
create policy "ecodem sessions readable by department members" on public."ecodem_sessions" for select to authenticated using (can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'ecodem'::text))));
create policy "transfer history is readable by those involved" on public."guest_follow_up_transfers" for select to authenticated using ((is_pastoral_team() OR can_write_department(to_department_id) OR ((from_department_id IS NOT NULL) AND can_write_department(from_department_id))));
create policy "guest follow-ups are deleted by the pastoral team" on public."guest_follow_ups" for delete to authenticated using (is_pastoral_team());
create policy "guest follow-ups are inserted by the pastoral team" on public."guest_follow_ups" for insert to authenticated with check (is_pastoral_team());
create policy "guest follow-ups are readable by those holding the case" on public."guest_follow_ups" for select to authenticated using ((is_pastoral_team() OR ((assigned_department_id IS NOT NULL) AND can_write_department(assigned_department_id))));
create policy "guest follow-ups are updated by those holding the case" on public."guest_follow_ups" for update to authenticated using ((is_pastoral_team() OR ((assigned_department_id IS NOT NULL) AND can_write_department(assigned_department_id)))) with check ((is_pastoral_team() OR ((assigned_department_id IS NOT NULL) AND can_write_department(assigned_department_id))));
create policy "lesson progress is visible to the owner or school admins" on public."lesson_progress" for select to authenticated using (((user_id = auth.uid()) OR is_school_admin()));
create policy "school admins can reset lesson progress" on public."lesson_progress" for delete to authenticated using (is_school_admin());
create policy "lessons are managed by school admins" on public."lessons" for all to authenticated using (is_school_admin()) with check (is_school_admin());
create policy "lessons are readable if course is readable" on public."lessons" for select to authenticated using ((EXISTS ( SELECT 1
   FROM course_modules m
  WHERE ((m.id = lessons.module_id) AND has_approved_enrollment(m.course_id)))));
create policy "letter signatures are inserted by the correct signer" on public."letter_signatures" for insert to authenticated with check (((signer_id = auth.uid()) AND (((signer_role = 'pastor'::letter_signer_role) AND (is_pastor_admin() OR is_super_admin())) OR ((signer_role = 'member'::letter_signer_role) AND (EXISTS ( SELECT 1
   FROM disciplinary_letters dl
  WHERE ((dl.id = letter_signatures.letter_id) AND (dl.member_id = auth.uid()))))))));
create policy "letter signatures are readable by involved parties" on public."letter_signatures" for select to authenticated using (((signer_id = auth.uid()) OR is_pastoral_team() OR (EXISTS ( SELECT 1
   FROM disciplinary_letters dl
  WHERE ((dl.id = letter_signatures.letter_id) AND (dl.member_id = auth.uid()))))));
create policy "login activity is readable by the pastoral team" on public."login_events" for select to authenticated using (is_pastoral_team());
create policy "assignee can respond to their own media tech assignment" on public."media_tech_assignments" for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "department admins manage media tech assignments" on public."media_tech_assignments" for all to authenticated using (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text)))) with check (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))));
create policy "media tech assignments readable by department members" on public."media_tech_assignments" for select to authenticated using (can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))));
create policy "member case history is readable by those involved" on public."member_case_transfers" for select to authenticated using ((is_pastoral_team() OR can_write_department(to_department_id) OR ((from_department_id IS NOT NULL) AND can_write_department(from_department_id))));
create policy "member cases are created by admins" on public."member_cases" for insert to authenticated with check (((created_by = auth.uid()) AND (is_pastoral_team() OR ((assigned_department_id IS NOT NULL) AND can_write_department(assigned_department_id)))));
create policy "member cases are deleted by the pastoral team" on public."member_cases" for delete to authenticated using (is_pastoral_team());
create policy "member cases are readable by those holding the case" on public."member_cases" for select to authenticated using ((is_pastoral_team() OR ((assigned_department_id IS NOT NULL) AND can_write_department(assigned_department_id))));
create policy "member cases are updated by those holding the case" on public."member_cases" for update to authenticated using ((is_pastoral_team() OR ((assigned_department_id IS NOT NULL) AND can_write_department(assigned_department_id)))) with check ((is_pastoral_team() OR ((assigned_department_id IS NOT NULL) AND can_write_department(assigned_department_id))));
create policy "menu labels are managed by super admin" on public."menu_labels" for all to authenticated using (is_super_admin()) with check (is_super_admin());
create policy "menu labels are readable by everyone" on public."menu_labels" for select to authenticated using (true);
create policy "users can mark their own notifications read" on public."notifications" for update to authenticated using ((recipient_id = auth.uid())) with check ((recipient_id = auth.uid()));
create policy "users can read their own notifications" on public."notifications" for select to authenticated using (((recipient_id = auth.uid()) OR is_super_admin()));
create policy "pastor meeting requests are confirmed by the church secretary" on public."pastor_meeting_requests" for update to authenticated using ((is_church_secretary() OR is_super_admin())) with check ((is_church_secretary() OR is_super_admin()));
create policy "pastor meeting requests are created by the requester" on public."pastor_meeting_requests" for insert to authenticated with check ((user_id = auth.uid()));
create policy "pastor meeting requests are readable by requester or the church" on public."pastor_meeting_requests" for select to authenticated using (((user_id = auth.uid()) OR is_church_secretary() OR is_super_admin()));
create policy "prayer requests are created by the requester" on public."prayer_requests" for insert to authenticated with check ((user_id = auth.uid()));
create policy "prayer requests are readable by requester or handlers" on public."prayer_requests" for select to authenticated using (((user_id = auth.uid()) OR is_pastoral_team() OR can_manage_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'intercession'::text)))));
create policy "prayer requests are updated by handlers" on public."prayer_requests" for update to authenticated using ((is_pastoral_team() OR can_manage_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'intercession'::text))))) with check ((is_pastoral_team() OR can_manage_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'intercession'::text)))));
create policy "department admins manage preaching schedule" on public."preaching_schedule" for all to authenticated using (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'preaching'::text)))) with check (can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'preaching'::text))));
create policy "preacher or moderator can add their own bible verse" on public."preaching_schedule" for update to authenticated using (((preacher_id = auth.uid()) OR (moderator_id = auth.uid()))) with check (((preacher_id = auth.uid()) OR (moderator_id = auth.uid())));
create policy "preaching schedule is readable by department members" on public."preaching_schedule" for select to authenticated using ((can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'preaching'::text))) OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))) OR is_slides_operator_for_date(date) OR (preacher_id = auth.uid()) OR (moderator_id = auth.uid())));
create policy "admins can read any email" on public."profile_emails" for select to authenticated using (is_admin());
create policy "users can read their own email" on public."profile_emails" for select to authenticated using ((auth.uid() = id));
create policy "admins can delete profiles" on public."profiles" for delete to authenticated using (is_admin());
create policy "admins can insert profiles" on public."profiles" for insert to authenticated with check (is_admin());
create policy "department admins can update their members' profiles" on public."profiles" for update to authenticated using ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM department_memberships dm
  WHERE ((dm.user_id = profiles.id) AND can_write_department(dm.department_id)))))) with check ((is_super_admin() OR (EXISTS ( SELECT 1
   FROM department_memberships dm
  WHERE ((dm.user_id = profiles.id) AND can_write_department(dm.department_id))))));
create policy "profiles are readable by authenticated users" on public."profiles" for select to authenticated using (true);
create policy "users can update their own profile" on public."profiles" for update to authenticated using ((auth.uid() = id));
create policy "projection_schedule_items_select" on public."projection_schedule_items" for select to authenticated using ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text)))));
create policy "projection_schedule_items_write" on public."projection_schedule_items" for all to authenticated using ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))))) with check ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text)))));
create policy "projection_schedules_select" on public."projection_schedules" for select to authenticated using ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text)))));
create policy "projection_schedules_write" on public."projection_schedules" for all to authenticated using ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))))) with check ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text)))));
create policy "projection_settings_select" on public."projection_settings" for select to authenticated using (true);
create policy "projection_settings_update" on public."projection_settings" for update to authenticated using ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))))) with check ((is_super_admin() OR can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text)))));
create policy "users manage their own push subscriptions" on public."push_subscriptions" for all to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "quiz questions are managed by school admins only" on public."quiz_questions" for all to authenticated using (is_school_admin()) with check (is_school_admin());
create policy "quizzes are managed by school admins" on public."quizzes" for all to authenticated using (is_school_admin()) with check (is_school_admin());
create policy "quizzes are readable if course is readable" on public."quizzes" for select to authenticated using ((EXISTS ( SELECT 1
   FROM (lessons l
     JOIN course_modules m ON ((m.id = l.module_id)))
  WHERE ((l.id = quizzes.lesson_id) AND has_approved_enrollment(m.course_id)))));
create policy "admins can manage replacement requests" on public."replacement_requests" for all to authenticated using (is_admin()) with check (is_admin());
create policy "replacement requests are readable by choir members" on public."replacement_requests" for select to authenticated using (can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'choir'::text))));
create policy "requesters can cancel their own open request" on public."replacement_requests" for update to authenticated using (((auth.uid() = requested_by) AND (status = 'open'::replacement_status))) with check ((auth.uid() = requested_by));
create policy "singers can create their own replacement requests" on public."replacement_requests" for insert to authenticated with check ((auth.uid() = requested_by));
create policy "rules documents are deleted by those with write access" on public."rules_documents" for delete to authenticated using ((((department_id IS NULL) AND is_super_admin()) OR ((department_id IS NOT NULL) AND (is_super_admin() OR can_write_department(department_id)))));
create policy "rules documents are inserted by those with write access" on public."rules_documents" for insert to authenticated with check ((((department_id IS NULL) AND is_super_admin()) OR ((department_id IS NOT NULL) AND (is_super_admin() OR can_write_department(department_id)))));
create policy "rules documents are readable by those with access" on public."rules_documents" for select to authenticated using (((department_id IS NULL) OR can_read_department(department_id)));
create policy "rules documents are updated by those with write access" on public."rules_documents" for update to authenticated using ((((department_id IS NULL) AND is_super_admin()) OR ((department_id IS NOT NULL) AND (is_super_admin() OR can_write_department(department_id)))));
create policy "rules signatures are inserted by the signer themselves" on public."rules_signatures" for insert to authenticated with check ((member_id = auth.uid()));
create policy "rules signatures are readable by the signer or oversight" on public."rules_signatures" for select to authenticated using (((member_id = auth.uid()) OR is_pastoral_team() OR (EXISTS ( SELECT 1
   FROM rules_documents rd
  WHERE ((rd.id = rules_signatures.rules_document_id) AND (rd.department_id IS NOT NULL) AND can_write_department(rd.department_id))))));
create policy "admins manage service plan rosters" on public."service_plan_singers" for all to authenticated using (is_admin()) with check (is_admin());
create policy "service plan rosters are readable by choir members" on public."service_plan_singers" for select to authenticated using (can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'choir'::text))));
create policy "admins manage service plan songs" on public."service_plan_songs" for all to authenticated using (is_admin()) with check (is_admin());
create policy "service plan songs are readable by choir members" on public."service_plan_songs" for select to authenticated using ((can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'choir'::text))) OR (EXISTS ( SELECT 1
   FROM service_plans sp
  WHERE ((sp.id = service_plan_songs.service_plan_id) AND (is_moderator_for_date(sp.date) OR can_write_department(( SELECT departments.id
           FROM departments
          WHERE (departments.key = 'media_tech'::text))) OR is_slides_operator_for_date(sp.date)))))));
create policy "admins manage service plans" on public."service_plans" for all to authenticated using (is_admin()) with check (is_admin());
create policy "service plans are readable by choir members" on public."service_plans" for select to authenticated using ((can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'choir'::text))) OR is_moderator_for_date(date) OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))) OR is_slides_operator_for_date(date)));
create policy "admins can create rsvp requests" on public."service_rsvps" for insert to authenticated with check (is_admin());
create policy "admins can delete rsvps" on public."service_rsvps" for delete to authenticated using (is_admin());
create policy "admins can update any rsvp" on public."service_rsvps" for update to authenticated using (is_admin()) with check (is_admin());
create policy "rsvps are readable by choir members" on public."service_rsvps" for select to authenticated using (can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'choir'::text))));
create policy "singers can respond to their own rsvp" on public."service_rsvps" for update to authenticated using ((auth.uid() = singer_id)) with check ((auth.uid() = singer_id));
create policy "admins manage songs" on public."songs" for all to authenticated using (is_admin()) with check (is_admin());
create policy "songs are readable by choir members" on public."songs" for select to authenticated using ((can_read_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'choir'::text))) OR is_moderator_for_song(id)));

-- New: tenant isolation, layered on top of the copied policies above.
create policy "tenant_isolation" on public."absence_reports" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."app_suggestions" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."app_theme" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."attendance_records" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."availability" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."budget_requests" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."church_program_dates" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."church_programs" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."course_approvals" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."course_enrollments" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."course_modules" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."course_questions" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."courses" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."department_announcements" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."department_headcounts" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."department_memberships" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."department_monthly_reports" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."department_shift_assignments" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."department_shifts" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."department_uniforms" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."departments" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."direct_calls" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."direct_messages" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."disciplinary_letters" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."ecodem_session_workers" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."ecodem_sessions" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."guest_follow_up_transfers" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."guest_follow_ups" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."lesson_progress" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."lessons" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."letter_signatures" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."login_events" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."media_tech_assignments" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."member_case_transfers" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."member_cases" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."menu_labels" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."notifications" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."pastor_meeting_requests" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."prayer_requests" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."preaching_schedule" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."profile_emails" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."profiles" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()) or id = (select auth.uid()))
  with check (tenant_id = (select public.current_tenant_id()) or id = (select auth.uid()));
create policy "tenant_isolation" on public."projection_schedule_items" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."projection_schedules" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."projection_settings" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."push_subscriptions" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."quiz_questions" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."quizzes" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."replacement_requests" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."rules_documents" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."rules_signatures" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."service_plan_singers" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."service_plan_songs" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."service_plans" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."service_rsvps" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public."songs" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

commit;