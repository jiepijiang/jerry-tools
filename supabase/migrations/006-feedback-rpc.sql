-- ============================================================================
-- 006 — 反馈的写入走 RPC（提反馈 / 回复反馈）
-- ----------------------------------------------------------------------------
-- 背景：`feedback` 表一直有、策略也齐，但**整条链路没接** ——
--   · 用户侧没有任何入口能创建一条反馈；
--   · `AdminView` 的「反馈」tab 因此永远是空列表（看着像「没人反馈」）；
--   · 它的 `sendReply()` 往 `item.replies[]` 里 push —— 那个字段**库里根本没有**
--     （表里是单条 `reply` + `status` + `replied_at`），而且完全没有落盘。
--
-- 为什么写入要做成 RPC，而不是让客户端直接写表：
--
--   1. 🔴 **管理员定位不到别人的行。**
--      `cloud.js` 的 `rowToLocal()` 会把 `user_id` **丢掉**（注释写着「内部字段，
--      前端模型里没有」），而 `localToRow()` 会给每一行盖上**当前用户**的 uid。
--      管理员能 select 到所有人的反馈（策略 `user_id = auth.uid() or is_admin()`），
--      于是「读回全部 → 改一条 → 整表写回」这条路会把**别人的行也盖上管理员的 uid**，
--      `on conflict (user_id, id)` 匹配不上 → **插出一条副本**，原行纹丝不动。
--      表现是「管理员回复成功了，用户永远看不到」。
--
--   2. 🔴 **被 RLS 挡掉的 update 不报错，只影响 0 行。**
--      PostgREST 对这种情况返回 204 / 200+[]，`if (error)` 一个字都不说。
--      （见 README「写失败却报『成功』」那节。）
--      这两个函数**显式 return boolean**，客户端拿到的是真信号。
--
--   3. 客户端因此可以把 `feedback` 当**只读表**：`SPECS[feedback].rpcOnly = true`
--      让 `writeCloud()` 拒绝写它，想绕也绕不过去。
--
-- 权限设计（有意不对称，别「统一」掉）：
--   · `submit_feedback` 是 **SECURITY INVOKER** —— 提反馈本来就是「写自己的行」，
--     让 RLS 的 `feedback_insert with check (user_id = auth.uid())` 再兜一道。
--   · `reply_feedback` 必须是 **SECURITY DEFINER** —— 它要改**别人的**行，
--     而 `feedback_update using (is_admin())` 只放行 admin；
--     函数内自己判 `is_admin()`，判不过直接 false。
--
-- 幂等：整个文件可以重复执行（`create or replace`）。
-- 权限：**要在 SQL Editor 里跑**（前端那个 anon key 建不了函数）。
-- ============================================================================


-- ---------------------------------------------------------- 1. 用户提反馈

create or replace function public.submit_feedback(
  p_id      text,
  p_content text,
  p_contact text default ''
)
returns boolean
language plpgsql
security invoker                      -- ← 有意为之，见文件头
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;                     -- 没登录
  end if;
  if coalesce(btrim(p_content), '') = '' then
    return false;                     -- 空内容
  end if;

  -- `do nothing`：同一个 id 重复提交（比如点了两下）当成功，不报错。
  insert into public.feedback (id, user_id, content, contact, status, reply)
  values (p_id, v_uid, btrim(p_content), coalesce(btrim(p_contact), ''), 'open', '')
  on conflict (user_id, id) do nothing;

  return true;
end $$;

grant execute on function public.submit_feedback(text, text, text) to anon, authenticated;


-- ---------------------------------------------------------- 2. 管理员回复

create or replace function public.reply_feedback(
  p_user_id uuid,
  p_id      text,
  p_reply   text
)
returns boolean
language plpgsql
security definer                      -- ← 必须：要改别人的行
set search_path = public
as $$
begin
  if not public.is_admin() then
    return false;                     -- 非管理员：明确说不行，不静默
  end if;
  if coalesce(btrim(p_reply), '') = '' then
    return false;
  end if;

  -- 按 (user_id, id) 精确定位 —— 主键就是这两列，`id` 单独并不唯一。
  update public.feedback
     set reply      = btrim(p_reply),
         status     = 'replied',
         replied_at = now()
   where user_id = p_user_id
     and id      = p_id;

  return found;                       -- ← 受影响 0 行就是 false（不靠 error）
end $$;

grant execute on function public.reply_feedback(uuid, text, text) to anon, authenticated;


-- ---------------------------------------------------------------- 3. 自检

-- 期望：funcs = 2，reply_is_definer = true，submit_is_invoker = true
select
  (select count(*)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_feedback', 'reply_feedback'))          as funcs,
  (select bool_and(p.prosecdef)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reply_feedback')       as reply_is_definer,
  (select bool_and(not p.prosecdef)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_feedback')      as submit_is_invoker;
