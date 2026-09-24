-- =========================================================================
-- 003 —— 实时多端同步（Realtime / postgres_changes）
-- -------------------------------------------------------------------------
-- 执行方式：
--   Supabase Dashboard → SQL Editor → 粘贴全文 → Run
--   （本项目没有 service_role / Management API PAT，所以只能走 Dashboard。
--     若以后加了 PAT，也可以 POST /v1/projects/{ref}/database/query 直接跑。）
--
-- 跑完**看结果网格**：最后那句 select 应该正好返回 10 行。
-- 少于 10 行就说明有表没进去 —— 别只看有没有报错。
--
-- 背景
-- -------------------------------------------------------------------------
-- Supabase 的 postgres_changes 走**逻辑复制**，只能推 `supabase_realtime`
-- 这个 publication 里**列出来**的表。
--
-- ⚠️ 新建的表**不会自动加进去**。这是最容易踩的坑，因为它的失败模式
--    完全静默：客户端 `subscribe()` 会老老实实返回 `SUBSCRIBED`
--    （那只是 websocket 连上了），然后**一条事件都收不到**。
--    实测连一个**根本不存在的表名**订阅也是 `SUBSCRIBED` ——
--    所以「订阅成功」这个信号对「表在不在发布里」零区分度。
--    唯一的判定办法是「写一行 → 看有没有事件」。
--
-- 为什么**不**订阅 discover_sites
-- -------------------------------------------------------------------------
-- 它是全局表，而 `views` 每次有人点开站点都会 +1。
-- 一旦订阅，**任何一个用户的每一次点击都会广播给所有在线设备** ——
-- 一个 377 条的站点列表，流量和 CPU 都会白烧，而用户根本看不出差别。
-- 另外它的 select 策略引用了 status / submitted_by 这些**非主键列**，
-- 而 DELETE 事件默认只带主键，策略没法求值（详见下面的「关于 replica identity」）。
-- 所以发现页的浏览/收藏数不做实时，需要时刷新即可。
--
-- 关于 replica identity（**不要随手改成 full**）
-- -------------------------------------------------------------------------
-- DELETE / UPDATE 事件里，`old_record` 默认**只包含主键列**
-- （`replica identity default`）。这带来一个不显眼但致命的约束：
--
--   客户端的 `filter` 只能写在「主键列」上，否则 **DELETE 事件会被静默丢掉** ——
--   因为服务端拿不到被过滤的那一列，匹配不上。
--
-- 本文件选出的表，主键里都含 `user_id`（profiles 是 `id`），
-- 所以前端统一用 `user_id=eq.<uid>` / `id=eq.<uid>` 过滤是安全的。
-- 以后要订阅**新表**时，务必确认过滤列在主键里；不在的话得先
-- `alter table ... replica identity full`（代价是 WAL 变胖）。
--
-- 同理，RLS 的 SELECT 策略也要能只用主键列求值 —— 这也是
-- discover_sites 不适合订阅的第二个原因。
--
-- 本文件是**幂等**的，可以反复执行。
-- =========================================================================


-- ------------------------------------------------- 1. 确保 publication 存在
-- 老项目里它是 Supabase 预建的；保险起见补一个。

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
    raise notice '已创建 publication supabase_realtime';
  end if;
end $$;


-- ------------------------------------------------- 2. 把表加进 publication
-- ⚠️ 不能用 `alter publication ... add table` 硬来：表已经在里面时它会报
--    42710 duplicate_object。所以先查 pg_publication_tables 再决定加不加。

do $$
declare
  t text;
  targets text[] := array[
    'categories',      -- 分类树
    'bookmarks',       -- 书签（最常改的）
    'notes',           -- 便签
    'visits',          -- 访问计数
    'favorites',       -- 收藏的发现页站点
    'user_settings',   -- 界面设置
    'share_settings',  -- 分享开关 / 后缀
    'submissions',     -- 用户提交的站点
    'feedback',        -- 反馈
    'profiles'         -- 昵称 / 头像 / 角色 / 禁用状态
  ];
  added int := 0;
begin
  foreach t in array targets loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      continue;
    end if;

    -- 表不存在就跳过并告警，别让整条迁移挂掉
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise warning '表 public.% 不存在，跳过（先跑 schema.sql）', t;
      continue;
    end if;

    execute format('alter publication supabase_realtime add table public.%I', t);
    added := added + 1;
  end loop;

  raise notice '本次新加入 % 张表', added;
end $$;


-- ------------------------------------------------- 3. 收尾自检
-- ⚠️ 这是**唯一权威**的验收方式。
--    别用「远程订阅一下看报不报错」来验收：那个读数会假阳性
--    （踩过：一个通道订 10 张表时服务端只回一条错误，脚本把另外 9 张
--      没发布的表报成了「已发布」，而且连续两轮都这样）。
--    直接读 pg_publication_tables 没有中间商。

do $$
declare
  n int;
  listing text;
begin
  select count(*), string_agg(tablename, ', ' order by tablename)
    into n, listing
  from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public';

  raise notice 'supabase_realtime 现有 % 张 public 表：%', n, coalesce(listing, '(空)');
  if n < 10 then
    raise warning '只进去 % 张，期望 10 张 —— 翻上面的 warning 看是哪张被跳过了', n;
  end if;
end $$;


-- ------------------------------------------------- 4. 结果网格（应该正好 10 行）
select tablename as "已发布的表"
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
