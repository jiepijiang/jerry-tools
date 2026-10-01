-- ============================================================================
-- 005 — 用户上传的图片改走 Supabase Storage
-- ----------------------------------------------------------------------------
-- 背景：
--   头像、书签图标、站点图标三处上传，一直是 `readFileAsDataURL()` 把图片
--   转成 base64 **直接写进业务表**（`profiles.avatar` / `bookmarks.icon` /
--   `discover_sites.icon`）。两个后果：
--     1. 行变大 —— 一张 2MB 的图 base64 之后是 ~2.7MB，塞进一行；
--     2. 本机模式还会撞 localStorage 配额（`QuotaExceededError`，
--        见 README「写失败却报『成功』是违约」那一节）。
--
-- 做法：
--   建一个**公开读**的 bucket `user-assets`，路径按用户分目录：
--
--       user-assets/{auth.uid()}/{kind}-{hash}.webp
--                              ↑ kind = icon | avatar
--
--   前端上传后只往业务表里存**公开 URL**（一个几百字节的字符串）。
--   策略保证「只有本人能写自己 uid 那一层目录」，读则全开
--   （bucket 是 public 的，图片本来就要在页面上展示）。
--
-- ⚠️ 为什么是「按 uid 分目录」而不是「按表/按业务分目录」：
--    策略判据只有一条 `(storage.foldername(name))[1] = auth.uid()::text`，
--    简单、不容易写错，而且**新增一种图片不用改策略**。
--    反过来按业务分目录的话，每加一种图片就要加一条策略 ——
--    迟早有一条会漏，而漏了的表现是「上传成功但谁也看不见」。
--
-- ⚠️ 关于白名单里的 `image/svg+xml`（以及为什么不收 `image/svg+xml` 之外的东西）：
--    前端会把上传的图**转码成 WebP**（顺带缩到最长边 256px），所以正常路径
--    只会出现 `image/webp`。png / jpeg / svg 是**转码失败时的降级**——
--    `BookmarkDialog` 的文件框 `accept` 里本来就有 `image/svg+xml`，
--    而 canvas 不一定能光栅化 SVG（没有内在尺寸的 SVG 会解不开）。
--    不收它 = 把一个「本来能用」的格式变成「上传失败」，那是回归。
--
--    收 SVG 的风险评估：图片挂在 `<ref>.supabase.co` 上，与本站
--    （`jiepijiang.github.io`）**不同源**；本站一律用 `<img src>` 渲染，
--    不会执行里面的脚本。就算有人直接打开那个 URL，脚本跑在 supabase 的
--    源上，读不到本站的 localStorage / 会话。所以风险可接受。
--    真要再收紧的话，正确做法是「前端强制光栅化 + 失败就报错」，
--    而不是在白名单里悄悄砍掉一个已支持的格式。
--
-- 幂等：整个文件可以重复执行（bucket 用 on conflict，策略先 drop 再 create）。
--
-- 权限：**要在 SQL Editor 里跑**（需要 postgres 身份）。
--       前端那个 anon key 建不了 bucket，这也是这份迁移必须手工执行的原因。
-- ============================================================================


-- ---------------------------------------------------------------- 1. bucket

-- `public = true` 的含义：对象可以通过
--   {SUPABASE_URL}/storage/v1/object/public/user-assets/...
-- 免鉴权读取。这是我们要的 —— 图标要能直接 `<img src>`。
--
-- file_size_limit 给 1MiB：前端已经缩到 256px（通常 5~30KB），
-- 留这么宽只是为了不误伤「转码降级」那条路径。真正的护栏是 allowed_mime_types。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-assets',
  'user-assets',
  true,
  1048576,
  array['image/webp', 'image/png', 'image/jpeg', 'image/svg+xml']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------- 2. 策略

-- 读：bucket 是 public 的，走公开 URL 时根本不经过 RLS。
-- 但**列目录 / 走 Storage API 读**要这条策略，否则管理页拉不到自己的文件。
-- 收 `true` 是有意的：这些图本来就在页面上公开可见，藏起来没有意义。
drop policy if exists "user-assets: 公开读" on storage.objects;
create policy "user-assets: 公开读"
  on storage.objects for select
  using (bucket_id = 'user-assets');

-- 写：只有本人能写自己 uid 那一层目录。
-- `(storage.foldername(name))[1]` 取路径的第一段 —— 就是 uid。
--
-- ⚠️ insert / update / delete **三条都要**，少一条的后果：
--    · 少 update → 同名覆盖（upsert）失败，表现是「换头像没反应」；
--    · 少 delete → 删不掉旧图，存储只涨不跌。
drop policy if exists "user-assets: 本人可写" on storage.objects;
create policy "user-assets: 本人可写"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "user-assets: 本人可改" on storage.objects;
create policy "user-assets: 本人可改"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "user-assets: 本人可删" on storage.objects;
create policy "user-assets: 本人可删"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'user-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );


-- ---------------------------------------------------------------- 3. 自检

-- 跑完直接看结果，不用去 Dashboard 翻。
-- 期望：bucket_ok = true，policies = 4。
select
  (select count(*) from storage.buckets where id = 'user-assets') = 1 as bucket_ok,
  (select count(*) from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname like 'user-assets:%')                            as policies;
