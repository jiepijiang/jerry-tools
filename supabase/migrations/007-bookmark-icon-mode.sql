-- ============================================================================
-- 007 — 书签图标来源 `icon_mode`
-- ----------------------------------------------------------------------------
-- 背景：
--   以前书签图标只有一条**隐式**规则：先试站点自己的 `/favicon.ico`，
--   失败才显示首字母。用户看不见也控制不了 —— 站点有图标就一定有图标，
--   想要纯字母块做不到；「到底有没有抓到图标」也只有卡片上才看得出来。
--
--   现在弹窗里有个显式三选一（`initial` / `favicon` / `custom`），
--   选择结果存在书签的 `iconMode` 字段里，**必须落到库里**才谈得上跨设备同步。
--
-- ⚠️ 为什么这一列不加不行（而且是**静默**失败）：
--   `src/data/adapters/cloud.js` 的 `localToRows()` 只按 `SPECS[...].columns`
--   这份白名单挑字段拼 DB 行。本地对象上多出来的键**不会报错，直接丢**。
--   所以如果只改前端不改库：本机上看着好好的，一同步/换设备图标来源就没了，
--   而且全程 200、没有一行日志。同理，`columns` 里漏了这一列，
--   写上去也不会被读回来（`rowToLocal` 是全量透传，但它得有得传）。
--
-- 取值：
--   'initial' 只用「名称首字母 + 渐变底」
--   'favicon' 自动抓站点 `/favicon.ico`（抓不到回落首字母）  ← 默认值，即老行为
--   'custom'  用 `icon` 列里的地址
--
-- 默认值为什么是 'favicon' 而不是 'initial'：
--   库里的存量行**本来就在走 favicon 这条路**。默认成 'initial' 等于
--   一次性把所有老书签的图标全换成字母块 —— 那是个「升级即变脸」的事故，
--   不是迁移。选 'favicon' 则存量行前后行为完全一致，零变化。
--
-- ⚠️ 不写 check 约束：`resolveIconMode()`（前端）对认不出的值会按
--    「有 icon 就算 custom、否则 favicon」推断，也就是**容错**的。
--   加约束反而会在将来想扩第四种来源时卡住老数据。
--
-- 幂等：整个文件可以重复执行（add column if not exists）。
-- ============================================================================


-- ------------------------------------------------------------ 1. 加列

alter table public.bookmarks
  add column if not exists icon_mode text not null default 'favicon';

comment on column public.bookmarks.icon_mode is
  '图标来源：initial(首字母) / favicon(站点图标，默认) / custom(自定义 icon 列)。见前端 helpers.js 的 ICON_MODES';


-- ------------------------------------------------------------ 2. 验收
--
-- ⚠️ 只看「没报错」不够 —— 列加上了但默认值/约束不对，同样一路成功。
--    要**看到这一列存在、且存量行都拿到了 'favicon'** 才算过。
--
-- 期望结果（一行三列）：
--   列存在        = t
--   默认值        = 'favicon'::text
--   非 favicon 的行数 = 0      ← 不为 0 说明有行没拿到默认值
select
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'bookmarks'
       and column_name = 'icon_mode'
  )                                                        as "列存在",
  (select column_default from information_schema.columns
    where table_schema = 'public'
      and table_name = 'bookmarks'
      and column_name = 'icon_mode')                       as "默认值",
  (select count(*) from public.bookmarks where icon_mode <> 'favicon') as "非favicon的行数(应为0)";


-- ------------------------------------------------------------ 3. 顺带自查：列清单有没有对齐
--
-- `cloud.js` 的 `columns` 白名单和真实表结构**是两处独立维护**的东西，
-- 漂移了就是上面说的那种静默丢字段。这条查询把差异列出来。
--
-- 期望结果：一行都不返回（或只返回 `user_id`，那是内部字段、前端模型里没有）。
select c.column_name as "库里有、白名单没有"
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name = 'bookmarks'
   and c.column_name not in (
     'id', 'category_id', 'name', 'url', 'description',
     'icon', 'icon_mode', 'sort_order', 'created_at', 'user_id'
   );
