-- =========================================================================
-- 002 — share_settings.slug 的唯一性从「全量」改成「非空才要求」
-- =========================================================================
--
-- 背景（真 bug，不是洁癖）：
--
--   schema.sql 里写的是 `slug text not null unique`，于是库里落了一个
--   **全量** 唯一约束 `share_settings_slug_key UNIQUE (slug)`。
--   而前端的默认分享状态是 `{ enabled: false, slug: '', displayName: 'Jerry' }`
--   —— 用户第一次打开「开启分享」开关时，写下去的就是 `slug = ''`。
--
--   结果：**第一个用户正常，第二个用户在设置面板点一下开关就报错**。
--   报的是 23505 duplicate key value violates unique constraint
--   "share_settings_slug_key"，前端只会 toast「保存失败」，
--   用户完全不知道为什么、也不知道怎么绕。
--
--   这个坑和 001 里那个「id 单列主键」是同一类：**默认值撞上了唯一约束**，
--   而且同样只在「第二个用户」身上才暴露 —— 单用户测试永远发现不了。
--
-- 修法：
--   把全量唯一约束换成**部分唯一索引** `where slug <> ''`。
--   语义变成「只要你设了后缀，它就得全局唯一」——这才是真正要保证的；
--   还没设后缀的空串不该参与竞争。
--
--   顺带把 `share_settings_slug_idx`（`where enabled`）保留原样：
--   它服务的是 `get_shared_nav` 那个 `where slug = ? and enabled` 的查询，
--   和唯一性无关，别混在一起。
--
-- 幂等：重复执行安全。
-- =========================================================================

-- 1) 干掉全量唯一约束（存在才删，名字来自 pg_constraint 的实测结果）
alter table public.share_settings
  drop constraint if exists share_settings_slug_key;

-- 2) 换成部分唯一索引
create unique index if not exists share_settings_slug_unique
  on public.share_settings (slug)
  where slug <> '';

-- 3) 给 slug 补一个默认值，让「没设过后缀」这件事在库里是显式的空串
alter table public.share_settings
  alter column slug set default '';

-- 4) 收尾：让 PostgREST 重新读一遍 schema
notify pgrst, 'reload schema';
