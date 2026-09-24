-- ============================================================================
-- 004 — 发现页「收藏数」(collects) 接真实数据
-- ----------------------------------------------------------------------------
-- 背景：
--   `discover_sites.collects` 原来只是种子灌进去的**静态值** ——
--   点收藏、取消收藏，这个数字一动不动。真实数据其实一直在 `favorites` 表里
--   （每收藏一次一行，主键 `(user_id, site_id)`），只是没人去数它。
--
-- 做法：
--   在 `favorites` 上挂一个 AFTER INSERT OR DELETE 触发器，
--   把 `discover_sites.collects` 维护成**运行期计数器**。
--
--   ⚠️ 语义是「**种子基数 + 真实收藏**」，不是「纯真实计数」。
--      与 `views` 完全一致（种子基数 + 每次点击 RPC +1）。
--      这么定的理由：种子那 377 条来自参考站的**热度数据**，
--      直接清零的话「按收藏排序」会退化成一堆 0，这个排序就没意义了。
--      想要纯真实计数的话，见文件末尾「可选：清零基数」那一行。
--
-- 为什么用触发器，而不是让客户端去写：
--   1. `discover_sites` 的 update 策略只放行 admin（RLS），
--      普通用户点收藏根本写不动 `collects`；
--   2. 就算包一层 SECURITY DEFINER 的 RPC，客户端也得**先知道**收藏前
--      服务端的最新值 —— 多设备下必然算错（两边都拿旧值 +1 → 少算一次）。
--      触发器在**同一个事务**里跟着 favorites 的写入跑，天然正确。
--
-- 为什么不用 `count(*)` 实时算：
--   那要么每张卡片一个子查询（377 次聚合），要么加一列 `base_collects`
--   变成两个真相来源。增量维护最简单，也最贴近现有 `views` 的形态。
--
-- 幂等：整个文件可以重复执行。
-- ============================================================================


-- ------------------------------------------------------------ 1. 触发器函数

-- ⚠️ 必须 SECURITY DEFINER。
--    触发器函数默认以**调用者**身份执行，而调用者是普通用户 ——
--    `discover_sites` 的 update 策略会把他挡下来，
--    表现是「收藏成功但计数不动」，而且不报错。
--    SECURITY DEFINER 让它以函数属主身份执行，绕过 RLS。
create or replace function public.sync_discover_site_collects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- `site_id` 上没有外键（站点可以被删掉，留着孤儿收藏行无所谓），
    -- 所以收藏一个不存在的站点时这条 update 匹配 0 行 —— 静默无操作，正确。
    update public.discover_sites
       set collects = collects + 1
     where id = new.site_id;
    return new;
  end if;

  -- DELETE。用 greatest 兜底：万一计数被人手工改小了，
  -- 也不要出现 -1 这种明显是 bug 的数字。
  update public.discover_sites
     set collects = greatest(collects - 1, 0)
   where id = old.site_id;
  return old;
end $$;

comment on function public.sync_discover_site_collects() is
  '维护 discover_sites.collects = 种子基数 + favorites 真实行数（增量维护，见 004 迁移）';


-- ------------------------------------------------- 2. 首次运行：补偿历史收藏
-- 这个 DO 块必须在**建触发器之前**判断「触发器还不存在」——
-- 这样整个文件重复执行时不会把历史收藏重复累加一遍。
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'favorites_sync_collects') then
    raise notice '触发器已存在 → 跳过历史补偿（避免重复累加）';
  else
    update public.discover_sites s
       set collects = s.collects + c.n
      from (select site_id, count(*)::int as n from public.favorites group by site_id) c
     where c.site_id = s.id;
    raise notice '首次运行 → 已把历史 favorites 行数补进 collects';
  end if;
end $$;


-- ------------------------------------------------------------ 3. 触发器

drop trigger if exists favorites_sync_collects on public.favorites;
create trigger favorites_sync_collects
  after insert or delete on public.favorites
  for each row execute function public.sync_discover_site_collects();


-- ------------------------------------------------------------ 4. 验收
--
-- ⚠️ 只看「有没有报错」是不够的 —— 触发器建好了但函数写错，
--    同样是一路成功、然后静默不计数。要**看到数字对上**才算过。
--
-- 期望结果（一行三列）：
--   触发器      = favorites_sync_collects
--   收藏行数    = 库里 favorites 的真实行数
--   计数小于收藏的站点数 = 0   ← 这一列不为 0 说明有站点漏算了
select
  (select tgname from pg_trigger where tgname = 'favorites_sync_collects') as "触发器",
  (select count(*) from public.favorites)                                   as "收藏行数",
  (select count(*)
     from public.discover_sites s
    where s.collects < (select count(*) from public.favorites f where f.site_id = s.id)
  )                                                                          as "计数小于收藏的站点数(应为0)";


-- ------------------------------------------------------------ 5. 可选：清零基数
-- 想让收藏数变成**纯真实计数**（现在没人收藏的站点一律显示 0），跑这一行：
--
--   update public.discover_sites s
--      set collects = (select count(*) from public.favorites f where f.site_id = s.id);
--
-- 注意这会丢掉种子热度值，「按收藏排序」将基本按时间倒序排列。
-- 跑完再执行一遍上面第 4 节那条 select 复查。
