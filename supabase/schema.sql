-- =========================================================================
-- jerry-tools 数据库 schema
-- -------------------------------------------------------------------------
-- 执行方式（二选一）：
--   A. Supabase Dashboard → SQL Editor → 粘贴全文 → Run
--   B. Management API：
--      node tools/run-sql.mjs supabase/schema.sql
--
-- 设计要点
-- -------------------------------------------------------------------------
-- 1. **id 用 text 而不是 uuid**。前端 `uid()` 生成的是 `bm_xxx` 这种字符串，
--    沿用 text 可以让 localStorage 里已有的数据直接搬上来，不用做 id 重映射。
--    跨用户撞 id 的概率可忽略（`uid()` 带时间戳 + 6 位随机）。
--
-- 2. **用户私有表一律带 `user_id`，RLS 全部按 `user_id = auth.uid()` 隔离。**
--
-- 3. **`discover_sites` 是全局公开数据**，不带 user_id —— 377 条种子是所有用户
--    共享的。只有 admin 能改，普通用户只能提交待审条目。
--
-- 4. 管理员判断走 `is_admin()` 这个 SECURITY DEFINER 函数。
--    **必须 definer**：它要读 `profiles`，而 profiles 自己开着 RLS，
--    普通 invoker 函数会撞上递归（策略里再查策略）。
--
-- 5. **顺序不能乱**：表 → 函数 → 策略。
--    `create function ... language sql` 会在**创建时**就校验函数体，
--    函数体里引用的表必须已经存在。把函数写在建表前面会直接报
--    `42P01: relation "public.profiles" does not exist`（踩过）。
--
-- 6. 本文件是**幂等**的，可以反复执行。
-- =========================================================================


-- ============================================================ A. 建表

-- ---------------------------------------------------------- A1. profiles

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text        not null default '',
  nickname   text        not null default '',
  avatar     text        not null default '',
  role       text        not null default 'user' check (role in ('user', 'admin')),
  disabled   boolean     not null default false,
  note       text        not null default '',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------- A2. categories

-- ⚠️ 主键是 (user_id, id)，**不是** id 单列。
--    私有表的身份是「某个用户的某条记录」。用 id 单列做主键的话，
--    两个用户都跑同一份种子（id 都是 `dev` / `design` / …），
--    第二个用户 upsert 时会撞上别人的行 → RLS 的 USING 判假 → 403
--    `new row violates row-level security policy (USING expression)`。
--    见 migrations/001-composite-pk.sql。
create table if not exists public.categories (
  id         text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  icon       text        not null default 'Folder',
  parent_id  text,
  sort_order int         not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists categories_user_idx on public.categories (user_id, sort_order);

-- ---------------------------------------------------------- A3. bookmarks

create table if not exists public.bookmarks (
  id          text        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  category_id text,
  name        text        not null default '',
  url         text        not null,
  description text        not null default '',
  icon        text        not null default '',
  sort_order  int         not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists bookmarks_user_idx on public.bookmarks (user_id, category_id, sort_order);

-- ---------------------------------------------------------- A4. notes

create table if not exists public.notes (
  id         text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  content    text        not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists notes_user_idx on public.notes (user_id, created_at desc);

-- ---------------------------------------------------------- A5. visits

create table if not exists public.visits (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  bookmark_id text        not null,
  count       int         not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, bookmark_id)
);

-- ---------------------------------------------------------- A6. favorites

create table if not exists public.favorites (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  site_id    text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, site_id)
);

-- ---------------------------------------------------------- A7. user_settings

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------- A8. share_settings

-- ⚠️ slug **不能**写成 `not null unique`（全量唯一）。
--    前端默认状态是 `{ enabled: false, slug: '' }`，用户第一次开分享开关
--    写下去的就是空串；全量唯一约束会让**第二个**用户一开开关就撞 23505。
--    正确做法是下面那条「非空才唯一」的部分唯一索引。
--    详见 migrations/002-share-slug-unique.sql。
create table if not exists public.share_settings (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  enabled      boolean     not null default false,
  slug         text        not null default '',
  display_name text        not null default '',
  avatar       text        not null default '',
  updated_at   timestamptz not null default now()
);

-- 服务 `get_shared_nav` 的 `where slug = ? and enabled` 查询（唯一性无关）
create index if not exists share_settings_slug_idx on public.share_settings (slug) where enabled;

-- 唯一性只对「设过后缀」的行生效 —— 空串不参与竞争
create unique index if not exists share_settings_slug_unique
  on public.share_settings (slug)
  where slug <> '';

-- ---------------------------------------------------------- A9. discover_sites

create table if not exists public.discover_sites (
  id           text primary key,
  title        text        not null default '',
  url          text        not null,
  description  text        not null default '',
  icon         text        not null default '',
  category     text        not null default '其他',
  subcategory  text        not null default '',
  views        int         not null default 0,
  collects     int         not null default 0,
  status       text        not null default 'approved' check (status in ('approved', 'pending', 'rejected')),
  submitted_by uuid        references auth.users(id) on delete set null,
  sort_weight  int         not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists discover_sites_status_idx on public.discover_sites (status, category);

-- ---------------------------------------------------------- A10. submissions

create table if not exists public.submissions (
  id          text        not null,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  title       text        not null default '',
  url         text        not null default '',
  description text        not null default '',
  category    text        not null default '其他',
  subcategory text        not null default '',
  status      text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text        not null default '',
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key (user_id, id)
);

create index if not exists submissions_user_idx on public.submissions (user_id, created_at desc);

-- ---------------------------------------------------------- A11. feedback

create table if not exists public.feedback (
  id         text        not null,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  content    text        not null default '',
  contact    text        not null default '',
  status     text        not null default 'open' check (status in ('open', 'replied', 'closed')),
  reply      text        not null default '',
  created_at timestamptz not null default now(),
  replied_at timestamptz,
  primary key (user_id, id)
);

create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);


-- ============================================================ B. 函数与触发器

-- 管理员判断。SECURITY DEFINER 绕过 profiles 的 RLS，避免策略递归。
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and not disabled
  );
$$;

-- 通用的 updated_at 自动维护。
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 新用户注册时自动建 profile。
-- 没有这个触发器的话，注册完 profiles 里没行，前端读不到昵称/角色。
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, nickname)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'nickname', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 浏览量自增。**必须 definer** —— 普通用户对别人的站点没有 update 权限，
-- 但「浏览 +1」应该人人可做。
create or replace function public.increment_discover_site_views(p_site_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.discover_sites set views = views + 1 where id = p_site_id;
$$;

grant execute on function public.increment_discover_site_views(text) to anon, authenticated;

-- 分享页：一次调用把需要的全部数据取回来。
--
-- 为什么用 SECURITY DEFINER 函数而不是 view：访客是匿名的，
-- 走 view 就得给 categories / bookmarks 开一条「anon 可读」的策略，
-- 那是把**所有用户**的书签都暴露出去。这里只放行显式开启了分享的 slug。
create or replace function public.get_shared_nav(p_slug text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'displayName', s.display_name,
    'avatar',      s.avatar,
    'updatedAt',   s.updated_at,
    'categories',  coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icon', c.icon,
        'parentId', c.parent_id, 'sortOrder', c.sort_order
      ) order by c.sort_order)
      from public.categories c where c.user_id = s.user_id
    ), '[]'::jsonb),
    'bookmarks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'categoryId', b.category_id, 'name', b.name, 'url', b.url,
        'description', b.description, 'icon', b.icon, 'sortOrder', b.sort_order
      ) order by b.sort_order)
      from public.bookmarks b where b.user_id = s.user_id
    ), '[]'::jsonb)
  )
  from public.share_settings s
  where s.slug = p_slug and s.enabled = true;
$$;

grant execute on function public.get_shared_nav(text) to anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists share_settings_touch on public.share_settings;
create trigger share_settings_touch before update on public.share_settings
  for each row execute function public.touch_updated_at();


-- ============================================================ C. RLS 策略

alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.bookmarks       enable row level security;
alter table public.notes           enable row level security;
alter table public.visits          enable row level security;
alter table public.favorites       enable row level security;
alter table public.user_settings   enable row level security;
alter table public.share_settings  enable row level security;
alter table public.discover_sites  enable row level security;
alter table public.submissions     enable row level security;
alter table public.feedback        enable row level security;

-- ---------------------------------------------------------- profiles

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid());

-- 用户能改自己的资料，但**不能自己给自己升管理员、也不能自己解封**。
-- 这两条靠 with check 里把 role / disabled 钉回原值来实现。
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (id = auth.uid() and role = 'user' and disabled = false)
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete using (public.is_admin());

-- ---------------------------------------------------------- 纯私有表：一张策略管全部

drop policy if exists categories_all on public.categories;
create policy categories_all on public.categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists bookmarks_all on public.bookmarks;
create policy bookmarks_all on public.bookmarks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notes_all on public.notes;
create policy notes_all on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists visits_all on public.visits;
create policy visits_all on public.visits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists favorites_all on public.favorites;
create policy favorites_all on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists user_settings_all on public.user_settings;
create policy user_settings_all on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists share_settings_all on public.share_settings;
create policy share_settings_all on public.share_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------- discover_sites

-- 任何人都能读**已通过**的；自己的提交（含待审/被拒）自己也能看到；admin 全都能看。
drop policy if exists discover_sites_select on public.discover_sites;
create policy discover_sites_select on public.discover_sites
  for select using (
    status = 'approved'
    or submitted_by = auth.uid()
    or public.is_admin()
  );

-- 登录用户可以提交，但只能提交成 pending 且挂在自己名下。
drop policy if exists discover_sites_insert on public.discover_sites;
create policy discover_sites_insert on public.discover_sites
  for insert with check (
    public.is_admin()
    or (submitted_by = auth.uid() and status = 'pending')
  );

-- 只有 admin 能改（含审核）。
drop policy if exists discover_sites_update on public.discover_sites;
create policy discover_sites_update on public.discover_sites
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists discover_sites_delete on public.discover_sites;
create policy discover_sites_delete on public.discover_sites
  for delete using (public.is_admin());

-- ---------------------------------------------------------- submissions

drop policy if exists submissions_select on public.submissions;
create policy submissions_select on public.submissions
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists submissions_insert on public.submissions;
create policy submissions_insert on public.submissions
  for insert with check (user_id = auth.uid());

-- 用户只能改自己的待审条目；admin 随便改。
drop policy if exists submissions_update on public.submissions;
create policy submissions_update on public.submissions
  for update using (public.is_admin() or (user_id = auth.uid() and status = 'pending'))
  with check (public.is_admin() or (user_id = auth.uid() and status = 'pending'));

drop policy if exists submissions_delete on public.submissions;
create policy submissions_delete on public.submissions
  for delete using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------- feedback

drop policy if exists feedback_select on public.feedback;
create policy feedback_select on public.feedback
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert with check (user_id = auth.uid());

-- 只有 admin 能回复 / 改状态。
drop policy if exists feedback_update on public.feedback;
create policy feedback_update on public.feedback
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists feedback_delete on public.feedback;
create policy feedback_delete on public.feedback
  for delete using (public.is_admin());


-- ============================================================ D. 收尾

-- 让 PostgREST 立刻感知新表，不用等 schema cache 自动刷新。
notify pgrst, 'reload schema';
