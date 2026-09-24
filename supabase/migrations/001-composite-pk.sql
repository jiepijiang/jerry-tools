-- =========================================================================
-- 001：用户私有表的主键改成 (user_id, id)
-- -------------------------------------------------------------------------
-- 修的是什么
-- -------------------------------------------------------------------------
-- 初版把 `id` 设成了**全局主键**（`id text primary key`），这是错的。
--
-- 后果：两个用户的分类 id 都是种子里的 `dev` / `design` / ...，
-- 第二个用户写入时，PostgREST 的 upsert（`Prefer: resolution=merge-duplicates`）
-- 会翻译成 `INSERT ... ON CONFLICT (id) DO UPDATE`。冲突撞上的是**别人的行**，
-- 于是 RLS 的 USING 表达式 `user_id = auth.uid()` 判假，直接 403：
--
--   new row violates row-level security policy (USING expression)
--   for table "categories"
--
-- 表现极具迷惑性：**第一个用户一切正常，第二个用户永远写不进去。**
-- 而且报错是「违反 RLS」而不是「主键冲突」，很容易误判成策略写错了。
--
-- 为什么之前的 RLS 验证没抓到：验证脚本用的是随机 id（`bm_test_a_<时间戳>`），
-- 两个用户天然不会撞。真实场景里两个用户跑的是**同一份种子数据**，
-- id 完全一样。测试数据不真实，测试就是假的。
-- 见 verify-rls.mjs 的「两个用户用同一个 id」那一段。
--
-- 修法
-- -------------------------------------------------------------------------
-- 私有表的身份是「某个用户的某条记录」，所以主键就该是 (user_id, id)。
-- discover_sites 是全局公开数据，没有 user_id，保持 id 单列主键不动。
-- =========================================================================

do $$
declare
  t text;
  cols text;
begin
  foreach t in array array['categories', 'bookmarks', 'notes', 'submissions', 'feedback']
  loop
    -- 已经是复合主键就跳过（让本文件可重复执行）
    select string_agg(a.attname, ',' order by array_position(i.indkey, a.attnum))
      into cols
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = format('public.%I', t)::regclass
       and i.indisprimary;

    if cols = 'user_id,id' then
      raise notice '% 已经是复合主键，跳过', t;
      continue;
    end if;

    execute format('alter table public.%I drop constraint if exists %I', t, t || '_pkey');
    execute format('alter table public.%I add constraint %I primary key (user_id, id)', t, t || '_pkey');
    raise notice '% 主键已改为 (user_id, id)', t;
  end loop;
end $$;

-- 顺手把残留的测试账号清掉（它们持有 `dev` 这种公共 id，会挡住真实用户）。
-- 只删邮箱匹配测试前缀的，别误伤真人。
delete from auth.users
 where email like 'rls-%@example.com'
    or email like 'e2e-%@example.com'
    or email like 'diag-%@example.com';

notify pgrst, 'reload schema';
