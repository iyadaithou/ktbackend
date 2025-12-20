-- Support ticketing tables
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  assignee_id uuid references public.users(id) on delete set null,
  subject text not null,
  category text,
  message text not null,
  status text not null default 'open', -- open, in_progress, resolved, closed
  priority text not null default 'normal', -- low, normal, high, urgent
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_support_tickets_status on public.support_tickets(status);
create index if not exists idx_support_tickets_assignee on public.support_tickets(assignee_id);
create index if not exists idx_support_comments_ticket on public.support_ticket_comments(ticket_id);

-- Updated at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at
before update on public.support_tickets
for each row execute procedure public.set_updated_at();
-- School AI RAG schema additions
-- Safe to run multiple times (IF NOT EXISTS guards)

-- Enable pgvector
create extension if not exists vector;

-- Table: school_ai_documents
create table if not exists public.school_ai_documents (
  id bigserial primary key,
  school_id uuid not null,
  file_path text not null,
  chunk_index int not null,
  content text not null,
  embedding vector(1536),
  created_at timestamp with time zone default now()
);
create index if not exists idx_school_ai_documents_school on public.school_ai_documents (school_id);
create index if not exists idx_school_ai_documents_embedding on public.school_ai_documents using ivfflat (embedding vector_cosine_ops);

-- Table: school_ai_links (URL sources per school)
create table if not exists public.school_ai_links (
  id bigserial primary key,
  school_id uuid not null,
  url text not null,
  title text,
  status text default 'pending',
  last_crawled_at timestamp with time zone,
  created_at timestamp with time zone default now()
);
create index if not exists idx_school_ai_links_school on public.school_ai_links (school_id);

-- Table: school_ai_settings (instructions, config)
create table if not exists public.school_ai_settings (
  school_id uuid primary key,
  instructions text,
  updated_at timestamp with time zone default now()
);

-- Chat transcripts
create table if not exists public.school_ai_chats (
  id bigserial primary key,
  school_id uuid not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamp with time zone default now()
);
create index if not exists idx_school_ai_chats_school on public.school_ai_chats (school_id, created_at desc);

-- RPC function for similarity search
create or replace function public.match_school_docs(
  query_embedding vector(1536),
  in_school_id uuid,
  match_count int default 5,
  similarity_threshold float default 0.75
)
returns table (
  id bigint,
  school_id uuid,
  file_path text,
  chunk_index int,
  content text,
  similarity float
) language sql stable as $$
  select d.id, d.school_id, d.file_path, d.chunk_index, d.content,
         1 - (d.embedding <=> query_embedding) as similarity
  from public.school_ai_documents d
  where d.school_id = in_school_id
  order by d.embedding <=> query_embedding
  limit match_count;
$$;

-- Background job tracking for RAG operations
create table if not exists public.rag_jobs (
  id bigserial primary key,
  school_id uuid not null,
  type text not null check (type in ('links','files')),
  status text not null default 'running' check (status in ('running','finished','error')),
  processed_count int not null default 0,
  total_count int not null default 0,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists idx_rag_jobs_school_type_created on public.rag_jobs (school_id, type, created_at desc);

-- Users table with enhanced role and subscription management
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  first_name TEXT,
  last_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'student', 'tutor', 'course_manager', 'institution_admin', 'account_manager', 'school_profile', 'employee')),
  subscription_level TEXT NOT NULL DEFAULT 'free' CHECK (subscription_level IN ('free', 'basic', 'premium', 'enterprise')),
  subscription_expiry TIMESTAMP WITH TIME ZONE,
  profile_image_url TEXT,
  bio TEXT,
  clerk_id TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Custom roles table for user-defined roles
CREATE TABLE IF NOT EXISTS public.custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions TEXT[] NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Trigger for custom_roles updated_at
CREATE OR REPLACE FUNCTION update_custom_roles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_custom_roles_updated_at ON public.custom_roles;
CREATE TRIGGER set_custom_roles_updated_at
BEFORE UPDATE ON public.custom_roles
FOR EACH ROW
EXECUTE FUNCTION update_custom_roles_updated_at();

-- User-role assignments for custom roles
CREATE TABLE IF NOT EXISTS public.user_custom_roles (
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if it exists and recreate it
DROP TRIGGER IF EXISTS set_users_updated_at ON public.users;
CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION update_users_updated_at();

-- RLS policies for users table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can view their own data
DROP POLICY IF EXISTS "Users can view their own data" ON public.users;
CREATE POLICY "Users can view their own data"
ON public.users FOR SELECT
TO authenticated
USING (id = auth.uid());

-- Admin can view all users
DROP POLICY IF EXISTS "Admins can view all users" ON public.users;
CREATE POLICY "Admins can view all users"
ON public.users FOR SELECT
TO authenticated
USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- Institution admins can view users in their institution
DROP POLICY IF EXISTS "Institution admins can view users" ON public.users;
CREATE POLICY "Institution admins can view users"
ON public.users FOR SELECT
TO authenticated
USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'institution_admin');

-- Admin can modify all users - separate policies for each operation
DROP POLICY IF EXISTS "Admins can insert users" ON public.users;
CREATE POLICY "Admins can insert users"
ON public.users FOR INSERT
TO authenticated
WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Admins can update users" ON public.users;
CREATE POLICY "Admins can update users"
ON public.users FOR UPDATE
TO authenticated
USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin')
WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

DROP POLICY IF EXISTS "Admins can delete users" ON public.users;
CREATE POLICY "Admins can delete users"
ON public.users FOR DELETE
TO authenticated
USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- Users can update their own non-critical data
DROP POLICY IF EXISTS "Users can update their own data" ON public.users;
CREATE POLICY "Users can update their own data"
ON public.users FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid() AND role = (SELECT role FROM public.users WHERE id = auth.uid())); -- Cannot change own role

-- Course managers and tutors can view student data
DROP POLICY IF EXISTS "Course managers and tutors can view student data" ON public.users;
CREATE POLICY "Course managers and tutors can view student data"
ON public.users FOR SELECT
TO authenticated
USING (
  ((SELECT role FROM public.users WHERE id = auth.uid()) IN ('course_manager', 'tutor'))
  AND
  (role = 'student')
);

-- RLS for custom roles
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

-- Admin can manage custom roles
DROP POLICY IF EXISTS "Admins can manage custom roles" ON public.custom_roles;
CREATE POLICY "Admins can manage custom roles"
ON public.custom_roles
TO authenticated
USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- All authenticated users can view custom roles
DROP POLICY IF EXISTS "All users can view custom roles" ON public.custom_roles;
CREATE POLICY "All users can view custom roles"
ON public.custom_roles FOR SELECT
TO authenticated
USING (true);

-- RLS for user custom role assignments
ALTER TABLE public.user_custom_roles ENABLE ROW LEVEL SECURITY;

-- Admin can manage user-role assignments
DROP POLICY IF EXISTS "Admins can manage user-role assignments" ON public.user_custom_roles;
CREATE POLICY "Admins can manage user-role assignments"
ON public.user_custom_roles
TO authenticated
USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- Users can view their own role assignments
DROP POLICY IF EXISTS "Users can view their own role assignments" ON public.user_custom_roles;
CREATE POLICY "Users can view their own role assignments"
ON public.user_custom_roles FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Initial subscription settings view
CREATE OR REPLACE VIEW public.subscription_settings AS
SELECT
  subscription_level,
  COUNT(*) as user_count,
  COUNT(CASE WHEN subscription_expiry < now() THEN 1 END) as expired_count,
  COUNT(CASE WHEN subscription_expiry > now() THEN 1 END) as active_count
FROM 
  public.users
GROUP BY 
  subscription_level
ORDER BY 
  subscription_level;

-- User role distribution view
CREATE OR REPLACE VIEW public.role_distribution AS
SELECT
  role,
  COUNT(*) as user_count
FROM 
  public.users
GROUP BY 
  role
ORDER BY 
  role;

-- Grant permissions to authenticated users
GRANT SELECT ON subscription_settings TO authenticated;
GRANT SELECT ON role_distribution TO authenticated;

-- Add clerk_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'clerk_id'
    ) THEN
        ALTER TABLE public.users ADD COLUMN clerk_id TEXT UNIQUE;
    END IF;
END $$;

-- Create index on clerk_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON public.users (clerk_id); 

-- School resources for successful applications and entrance exams
create table if not exists public.school_resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  resource_type text not null check (resource_type in ('success','exam','other')),
  title text not null,
  content_html text,
  attachments jsonb default '[]'::jsonb,
  category text,
  tags text[],
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_school_resources_school on public.school_resources(school_id);
create index if not exists idx_school_resources_type on public.school_resources(resource_type);
create index if not exists idx_school_resources_created_at on public.school_resources(created_at desc);

-- RLS policies
alter table public.school_resources enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='school_resources' and policyname='School resources read'
  ) then
    create policy "School resources read"
      on public.school_resources for select
      using (true);
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='school_resources' and policyname='School resources write by service'
  ) then
    create policy "School resources write by service"
      on public.school_resources for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

-- Student process progress (per school, per country)
create table if not exists public.student_process_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete cascade,
  country text not null,
  checked_indices int[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, school_id, country)
);

create index if not exists idx_student_process_progress_user_school on public.student_process_progress(user_id, school_id);

-- Enable RLS and define policies
alter table public.student_process_progress enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='student_process_progress' and policyname='student process own read'
  ) then
    create policy "student process own read"
      on public.student_process_progress for select
      to authenticated
      using (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='student_process_progress' and policyname='student process own write'
  ) then
    create policy "student process own write"
      on public.student_process_progress for insert
      to authenticated
      with check (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='student_process_progress' and policyname='student process own update'
  ) then
    create policy "student process own update"
      on public.student_process_progress for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='student_process_progress' and policyname='student process service role'
  ) then
    create policy "student process service role"
      on public.student_process_progress for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;

-- Global chat transcripts (PythagorasAI)
create table if not exists public.global_ai_chats (
  id bigserial primary key,
  user_id uuid,
  user_email text,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamp with time zone default now()
);
create index if not exists idx_global_ai_chats_user on public.global_ai_chats (user_id, created_at desc);