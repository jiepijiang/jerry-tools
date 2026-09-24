# Supabase 后端

这个目录放的是后端相关的**全部**东西：建表脚本、增量迁移、数据种子、验证脚本。

前端在 `src/data/supabase.js` 与 `src/data/adapters/cloud.js`。
**没配环境变量时整个后端是可选的** —— 应用会退回纯 `localStorage` 模式，
功能照常可用，只是登录 / 跨设备同步 / 分享页只在单机范围内生效。

---

## 目录

| 文件 | 作用 | 什么时候跑 |
| --- | --- | --- |
| `schema.sql` | **全量**建表脚本（11 表 / 6 函数 / 5 触发器 / 23 策略 + realtime 发布） | 新项目从零开始建 |
| `migrations/*.sql` | 增量修复 | 库已经建过，按编号顺序补 |
| `seed-discover.mjs` | 灌发现页的 377 条种子 | 建完表之后跑一次 |
| `verify-rls.mjs` | RLS 隔离性验证（45 条成对断言） | 改过任何策略 / 主键之后**必跑** |

> `003-realtime.sql` 是**老库必须单独跑一次**的迁移 —— 详见「六、实时同步」。
> 不跑的话功能不会报错，只会**静默失效**。
> ✅ 本项目已于 2026-09-24 跑过（10 张表全部进了 `supabase_realtime`）。
>
> `004-discover-collects.sql` 同理，**老库也要单独跑一次** —— 详见「八、收藏数」。
> 不跑的话「收藏数」就是死值，点了收藏数字不动。
> ✅ 本项目已跑过。

---

## 一、建库

### 全新项目

把 `schema.sql` 整个丢进 SQL Editor 执行即可。它自带 `if not exists`，
**可以重复执行**，也可以拿来对齐一个被改乱了的库。

> ⚠️ **单文件里的顺序不能乱：表 → 函数 → 策略。**
> `create function ... language sql` 在**创建时**就会校验函数体，
> 函数体里引用的表必须已经存在。把函数写在建表前面会报
> `42P01: relation "public.profiles" does not exist`，
> 而这个报错看起来像「表名写错了」，很容易查错方向。

### 已经建过、要打补丁

按编号顺序执行 `migrations/` 下的四个文件：

```
supabase/migrations/001-composite-pk.sql
supabase/migrations/002-share-slug-unique.sql
supabase/migrations/003-realtime.sql
supabase/migrations/004-discover-collects.sql
```

**两种执行方式**（本仓库**没有** `run-sql.mjs`，别照着找）：

1. **Dashboard → SQL Editor** —— 粘贴全文 → Run。最省事，不需要额外凭据。
2. **Management API**（想脚本化时用，需要一个 **Account 级** PAT，
   在 `https://supabase.com/dashboard/account/tokens` 生成，前缀 `sbp_`）：

```bash
# ⚠️ PAT 别写进命令行参数 —— `ps` 里能看到。用环境变量或文件。
REF=<project-ref>
curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" -H 'Content-Type: application/json' \
  -d "$(node -e 'console.log(JSON.stringify({query:require("fs").readFileSync(process.argv[1],"utf8")}))' \
        supabase/migrations/003-realtime.sql)"
```

> 🔴 **别拿 `sb_publishable_...` / `sb_secret_...` 当 PAT** —— 那是**项目**里的
> API key（等价于 anon / service_role），只能按 RLS 读写数据，**跑不了 DDL**。
> 报错是 `401 {"message":"JWT could not be decoded"}`，
> 看起来像 token 失效，其实是拿错了东西。判断方法：拿它打一下
> `GET <ref>.supabase.co/rest/v1/<表>?select=id`，如果返回 200，
> 说明 key 本身有效、只是类型不对。

每个迁移都是幂等的，重复跑安全。

---

## 二、配置环境变量

```bash
cp .env.example .env.local
```

填两个值（Dashboard → Project Settings → API）：

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

**`anon` key 不是秘密** —— 它本来就要打包进前端发给浏览器，安全性由 RLS 保证。
所以 CI 里用 **Repository Variables**（不是 Secrets）注入，出问题好排查。

**`service_role` key 才是秘密**：它能绕过全部 RLS。
它只出现在本机的 `seed-discover.mjs` / `verify-rls.mjs` 里，通过环境变量传，
**绝不能进前端代码，也绝不能进 GitHub Actions 工作流**。

> `import.meta.env.VITE_*` 是**构建期静态替换**，不是运行时读取。
> 改完 `.env.local` 必须重启 dev server / 重新 build 才生效。

### 认证设置

在 Authentication → URL Configuration 里：

- **Site URL** 填线上地址（`https://<user>.github.io/<repo>/`）
- **Redirect URLs** 把线上地址和本地 `http://127.0.0.1:5174` 都加进去

另外本项目**关掉了邮箱确认**（Authentication → Providers → Email →
`Confirm email` 关掉，对应 Management API 的 `mailer_autoconfirm: true`）。
不关的话 `signUp` 不会返回 session，注册完是「未登录」状态，
用户会以为注册失败了。

---

## 三、灌种子

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
node supabase/seed-discover.mjs
```

377 条发现页站点。**幂等** —— id 由 url 的 djb2 哈希确定，
重复执行不会翻倍。

> ⚠️ **重跑不会覆盖 `views` / `collects`。** 这两列是运行期累加值
> （见「八、收藏数」）。脚本拆成两步：先只插不存在的行（带上基数），
> 再对已有行做一次**只含元数据列**的 upsert ——
> PostgREST 的 `merge-duplicates` 生成的 `ON CONFLICT DO UPDATE SET`
> 只包含 payload 里出现的列，所以那两个计数不会被碰。
> 跑完会打印两个计数的合计与种子基数对比，用来确认没被重置。
>
> （别改成 `PATCH` + 数组 body：PostgREST 的 PATCH 是「一个对象套给所有匹配行」，
> 逐行不同值它做不到。）

### 种子里 `icon` 改过之后，**必须重跑这个脚本**

`seed-discover.mjs` 读的就是 `src/data/seed-discover.js`。那份数据里
37 条不合格的 `icon`（第三方 favicon 服务 / 明文 http）已经清空，
但**线上库不会自己变** —— 不重跑的话，已上线那 377 行还是老值。

```
清过 icon → 重跑 seed-discover.mjs → 库里的 icon 跟着变空
```

重跑是安全的：元数据 upsert 只包含 payload 里出现的列，
`views` / `collects` 不受影响（见上面那条 ⚠️）。跑完对比一下打印的合计即可。

不想重跑也可以手工清：

```sql
update discover_sites
   set icon = ''
 where icon ilike '%icons.duckduckgo.com%'
    or icon ilike '%google.com/s2/favicons%'
    or icon ilike 'http://%';
```

> 这只是「把数据弄干净」。**用户手里那份数据仍然可能带坏地址**
> （自己粘的、从旧备份恢复的），所以前端 `faviconOf()` 里那层
> `isUsableIcon()` 过滤才是真正的保险 —— 详见根 README「图标从哪来」。

---

## 四、验证

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_ANON_KEY=<anon key> \
SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
node supabase/verify-rls.mjs
```

会注册两个临时账号、跑完 45 条断言、再把它们删掉
（不给 `SUPABASE_SERVICE_ROLE_KEY` 就清不掉，脚本会提示怎么手删）。

### 为什么每条断言都必须成对

RLS 写错的失败方式**非常隐蔽**：

- 策略太松 → 读到了不该读的数据，**但不会有任何报错**
- 策略太紧 → 读得到、写不了，报错信息还含糊

所以每条断言都配一个反向的：该成功的必须成功，**该被挡的必须被挡**。
只测一个方向的话，「全部通过」可能只是说明这段代码压根没生效。

### 为什么「跳过」要单独计数

脚本里有个 `skip()`。当某一段因为前置条件不满足没跑时，
**必须显式记一笔**并进汇总行。否则最后那句「通过 N / 失败 0」
会**把没测的东西也算成绿的** —— 一整段策略没验证过，
和验证通过看起来一模一样。这是最坏的一种假绿。

### 两个「默认值撞唯一约束」的坑（都只在第二个用户身上暴露）

这两处都是真踩过的，迁移脚本里各有一段回归：

| 坑 | 现象 | 根因 | 修法 |
| --- | --- | --- | --- |
| **私有表主键用了 `id` 单列** | 第一个用户一切正常，**第二个用户永远写不进去**，报 `403 new row violates row-level security policy (USING expression)` | 两个用户跑同一份种子（id 都是 `dev` / `b1`），`id` 单列主键让 upsert 撞上**别人的行**，RLS 的 `USING` 判假 | 主键改 `(user_id, id)` — `migrations/001` |
| **`share_settings.slug` 是全量 `unique`** | 第二个用户在设置面板点一下「开启分享」就报 23505 | 前端默认 `slug: ''`，两个空串撞唯一约束 | 改成部分唯一索引 `where slug <> ''` — `migrations/002` |

**共同教训**：`403 violates RLS` 这个报错**极容易误判成策略写错了**，
实际上策略是对的、是**主键设计**有问题。判断技巧是看
`403` 还是 `401` —— 403 意味着带了有效 JWT、只是那一行不可见；
纯匿名是 401，不带 `(USING expression)`。

**更重要的教训**：原来的 RLS 脚本用随机 id（`bm_test_a_<时间戳>`），
两个用户天然不撞，所以**两条都没抓到**。
测试数据不真实，测试就是假的 —— 现在的【2b】/【6b】段
专门用两个用户共用的固定值（`dev` / `b1` / 空 slug）来覆盖。

---

## 五、表结构速览

11 张表。除 `discover_sites` 外全部按 `user_id` 隔离，RLS 全开。

| 表 | 说明 | 主键 |
| --- | --- | --- |
| `profiles` | 用户资料，由 `handle_new_user` 触发器自动建档 | `id`（= auth uid） |
| `categories` | 分类树 | `(user_id, id)` |
| `bookmarks` | 书签 | `(user_id, id)` |
| `notes` | 备注 | `(user_id, id)` |
| `favorites` | 收藏（发现页） | `(user_id, site_id)` |
| `visits` | 书签点击计数 | `(user_id, bookmark_id)` |
| `share_settings` | 分享页设置 | `user_id` |
| `user_settings` | 界面偏好，整包塞进 `data jsonb` | `user_id` |
| `submissions` | 用户投稿 | `(user_id, id)` |
| `feedback` | 反馈 | `(user_id, id)` |
| `discover_sites` | 发现页站点（**全局数据**） | `id` |

### 四个 `SECURITY DEFINER` 函数，都不是「优化」

- `is_admin()` —— 它要读开着 RLS 的 `profiles`。普通 invoker 函数会撞策略递归。
- `increment_discover_site_views()` —— 匿名访客要改一张只有 admin 能写的表。
- `sync_discover_site_collects()` —— **触发器函数**，不是 RPC。
  触发器函数默认以调用者身份执行，而调用者是普通用户，
  会被 `discover_sites` 的 update 策略挡下 —— 表现是「收藏成功但数字不动」，
  连报错都没有。详见「八、收藏数」。
- `get_shared_nav(slug)` —— 匿名访客要读别人只有主人能读的 `categories` / `bookmarks`。

### 分享页为什么用函数而不是 view

用 view 的话，就得给 `categories` / `bookmarks` 开一条「anon 可读」的策略 ——
那是把**所有用户**的书签都暴露出去。函数可以精确地只放行
「显式开启了分享的那个 slug」，其余一律不返回。

### 用户不能自己提权

```sql
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (
    public.is_admin()
    or (id = auth.uid() and role = 'user' and disabled = false)
  );
```

`with check` 里锁死了 `role = 'user' and disabled = false` ——
用户能改自己的昵称头像，但**不能给自己升管理员、也不能自己解封**。

---

## 六、实时同步（Realtime）

登录后前端订阅自己那些表的变更，另一台设备改的东西**不用刷新**就会出现。
代码在 `src/composables/useRealtime.js`，表清单在 `src/data/adapters/cloud.js`
的 `REALTIME_TABLES`（与 `SPECS` 同源，表名只写一处）。

### 依赖一次迁移：`003-realtime.sql`

> ✅ **本项目已经跑过（2026-09-24）**，10 张表全部进了发布。
> 从零建库时 `schema.sql` 的 D 节已包含这段；**老库 / 换新库**才需要单独跑一次。

**不跑不会报错，只会静默失效** —— 这是这个功能最坑的地方：

| 现象 | 真相 |
| --- | --- |
| `subscribe()` 回调 `SUBSCRIBED` | **只说明 websocket 连上了**，与「表在不在发布里」无关 |
| 一条事件都收不到 | 表不在 `supabase_realtime` 发布里 |
| 服务端其实**有**报错 | 走 `system` 事件，**不**走 subscribe 回调 |

实测：连一个**根本不存在的表名**订阅，`subscribe()` 也照样返回 `SUBSCRIBED`。
所以「订阅成功」这个信号零区分度，唯一可靠的判据是**写一行 → 看有没有事件**。

服务端的原话（前端已经把这条接住并显示成「服务端未开启实时同步」）：

```
Unable to subscribe to changes with given parameters.
Please check Realtime is enabled for the given connect parameters:
  [event: *, schema: public, table: bookmarks, ...]
```

### 怎么验收「表到底进没进发布」

**只看 `pg_publication_tables`，别用远程订阅探测下结论。**

远程探测会**假阳性**，而且方向最危险（把没发布的表报成已发布）。
踩过的两个坑：

1. **一个通道订 N 张表会假阳性。** 本以为是「服务端为每张没发布的表各发一条
   system 错误」，实际服务端**只回了一条**（最后那张），另外 9 张一条都没发。
   脚本于是把 9 张没发布的表报成「✅ 已发布」。**单绑定才准。**
2. **单绑定下，整轮的第一张表（冷连接）会假阳性。** 收到 `SUBSCRIBED` 之后
   还要留一段安静期（实测 2.5s 够）再下结论。

所以 `003-realtime.sql` 末尾直接放了一句 `select ... from pg_publication_tables`，
**跑完看结果网格应该正好 10 行** —— 没有中间商：

```sql
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
```

### 两个不显眼的约束

**① 过滤列必须在主键里。**
`DELETE` 事件的 `old_record` 默认**只带主键列**（`replica identity default`）。
过滤列不在主键里 → 服务端匹配不上 → **DELETE 被静默丢掉**。
表现是「改了能同步、删了不同步」，很难往订阅配置上想。
本项目选出的表主键里都含 `user_id`（`profiles` 是 `id`），所以前端统一用
`user_id=eq.<uid>` / `id=eq.<uid>` 过滤是安全的。
以后加新表务必先确认这一条，否则得 `alter table ... replica identity full`（WAL 会变胖）。

**② RLS 的 SELECT 策略也要能只用主键列求值。**
同上，DELETE 时服务端只有主键列可用。`discover_sites` 的策略引用了
`status` / `submitted_by` 这些非主键列 —— 这是它**不适合订阅**的原因之一。

### 为什么订阅里没有 `discover_sites`

它是全局表，而 `views` 每次有人点开站点都会 +1。一旦订阅，
**任何一个用户的每一次点击都会广播给所有在线设备** —— 377 条站点列表的流量和
CPU 白烧，而用户看不出差别。所以发现页的浏览 / 收藏数不做实时，需要时刷新即可。

> 唯一的例外是**同一账号的另一台设备**：那边走 `favorites` 的实时事件
> （`favorites` 本来就在订阅里），前端顺手把本地的收藏数 ±1。
> **别人**的收藏仍然要等下次全量读 —— 订阅过滤列是 `user_id`，
> RLS 也只放行自己的行，别人的事件根本收不到。

### 断线重连要补一次全量读

`postgres_changes` **没有回放**。断线期间的事件永远补不回来，
所以 `useRealtime` 在**每次重连成功后**会做一次 `reloadStore()`
（首次连接不做 —— 刚登录时数据本来就是新的）。
后台标签页的 websocket 会被浏览器节流甚至掐断，切回前台时也会检查连接是否还在。

### 验证

```bash
# 脚本化：两个真实账号，验「自己收到 / 别人收不到」（只需要 anon key）
node /path/to/rt-verify.mjs

# 端到端：两个独立浏览器 context = 两台设备，验「不刷新就同步」
node /path/to/realtime-ui.mjs
```

---

## 七、已知限制

- **管理员不能在界面上创建 / 删除用户。** 创建 auth 用户需要 `service_role` key，
  那个 key 不能进浏览器。`adminCreateUser` 在云端模式直接返回 null 并打 `console.warn`；
  `adminDeleteUser` 降级成**禁用**（软删除），因为删 auth 账号同样需要 `service_role`。
  真要删人请去 Dashboard → Authentication → Users。
- **`discover_sites` 是全局表**，普通用户没有写权限。前端在云端模式下
  不会把它落盘（只在内存里兜底显示），否则登录后会把 377 条种子写一遍、
  刷一屏 RLS 报错。浏览量走 `increment_discover_site_views` 这个 RPC，人人可用；
  收藏数走 `favorites` 上的触发器，客户端**完全不参与**（见「八、收藏数」）。
- **发送确认邮件需要自备 SMTP。** 默认 SMTP 有严格限流，
  本项目索性关掉了邮箱确认（见上文「认证设置」）。

---

## 八、收藏数（`discover_sites.collects`）

### 依赖一次迁移：`004-discover-collects.sql`

> ✅ **本项目已跑过。** 从零建库时 `schema.sql` 的 B 节已包含这段；
> **老库 / 换新库**才需要单独跑一次。

不跑的话不会报错 —— 收藏功能一切正常，只有**数字永远不动**。
因为 `collects` 原本只是种子灌进去的静态值。

### 怎么做

`favorites` 上挂一个 `AFTER INSERT OR DELETE` 触发器，增量维护
`discover_sites.collects`：插一行 +1，删一行 −1。

```sql
create or replace function public.sync_discover_site_collects()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.discover_sites set collects = collects + 1 where id = new.site_id;
    return new;
  end if;
  update public.discover_sites set collects = greatest(collects - 1, 0) where id = old.site_id;
  return old;
end $$;
```

**为什么不能让客户端写**：

1. `discover_sites` 的 update 策略只放行 admin，普通用户点收藏根本写不动；
2. 就算包一层 SECURITY DEFINER 的 RPC，客户端也得**先知道**收藏前服务端的最新值 ——
   两台设备同时收藏同一个站点，各自拿旧值 +1，就会**少算一次**。
   触发器跟着 `favorites` 的写入在**同一个事务**里跑，天然正确。

**为什么不用 `count(*)` 实时算**：那要么每张卡片一个子查询（377 次聚合），
要么再加一列 `base_collects`，变成两个真相来源。增量维护最简单。

### 语义是「种子基数 + 真实收藏」

和 `views` 一致 —— 种子那 377 条的 `collects` 是参考站的热度数据，
清零会让「按收藏排序」退化成一堆 0。想要**纯真实计数**，跑 `004` 末尾那一行：

```sql
update public.discover_sites s
   set collects = (select count(*) from public.favorites f where f.site_id = s.id);
```

### 客户端只做即时反馈，不落盘

`toggleFavorite` 会在内存里 ±1（写盘失败时跟着 `favorites` 一起回滚），
但 `cloud.js` 的 `SERVER_MANAGED_COLUMNS` 会把 `collects` 从 diff 里摘掉。
**摘掉是必须的**，两个理由：

| 不摘的后果 | 谁身上出现 |
| --- | --- |
| 发出一次 `update discover_sites set collects = ...`，被 RLS 挡下 | 普通用户（不报错，只刷 warning） |
| 把本地估算的**绝对值**写回库，盖掉别的设备刚产生的收藏 | 管理员（只在他自己账号上出现，更难发现） |

顺带一个容易漏的点：`collects` 变过之后，再有人点开站点触发浏览量 +1 时，
`changedColumns` 会同时看到 `views` 和 `collects` —— 不摘掉的话
`changed.length === 1` 判断失败，就掉进通用 update 分支了。
单测 C2 专门盯这个。

### 验收

跑完 `004` 看结果网格（应该是一行三列）：

| 触发器 | 收藏行数 | 计数小于收藏的站点数(应为0) |
| --- | --- | --- |
| `favorites_sync_collects` | 真实行数 | `0` |

最后一列不为 0 说明有站点漏算了。手工复核用：

```sql
-- 随便挑几个站点，看 collects 是否 ≥ 它的 favorites 行数
select s.id, s.title, s.collects,
       (select count(*) from public.favorites f where f.site_id = s.id) as real_favs
  from public.discover_sites s
 order by real_favs desc, s.collects desc
 limit 10;
```

离线单测（不需要网络，把 `@/data/supabase` 换成桩）：

```bash
node --import ./register.mjs unit-cloud.mjs   # 【C】组 14 条断言
```

---

## 九、本机数据怎么进云端

书签存在哪儿取决于**导入那一刻有没有登录**：未登录 → 只在本机 `localStorage`；
已登录 → 直接写云端，没有额外步骤。所以「之前导入的书签怎么同步上去」有两种情况。

**自动（云端还是空的）** —— 登录 / 注册 / 恢复会话都走 `enterCloudMode()`，
它在切完适配器之后、`reloadStore()` 之前调 `transferLocalToCloud('fill')`：

- 判断「云端是否为空」**必须直接查云端**，不能看 `state` —— 那一刻 `state`
  要么还是空的，要么装的是本机那份，拿它当「云端非空」是循环论证；
- 云端已有数据就**整体跳过**，一条都不动；
- **顺序不能换**：必须在第一次 `reloadStore()` 之前。反过来的话
  `reloadStore` 里的 `seedIfEmpty` 会先往空云端灌一套种子，迁移就判定
  「云端非空」跳过了 —— 用户自己的书签永远上不去。

**手动（云端已有数据）** —— 设置面板「数据备份」→ **上传本机数据**
（仅登录后可见），走 `pushLocalToCloud()` → `transferLocalToCloud('merge')`。
覆盖的正是自动迁移管不着的这条路径：

> 先登录过 → 退出 → 未登录状态下导入了一份书签 → 再登录 → 自动迁移跳过。

合并规则：**并集，只补不删**。书签按 URL 去重（`helpers.bookmarkKey`，
与导入去重同一口径），分类按 id 去重、冲突时保留云端那份。幂等。

**搬哪些表**：只有 `categories` / `bookmarks` / `notes`（`data/transfer.js`
的 `TRANSFER_KEYS`）。刻意不含 `sites`（全局表，已由 `seed-discover.mjs` 灌过）、
`favorites` / `visits`（本机那份属于未登录时的匿名行为，搬到云端等于算到账号头上）、
`users`（云端是 `profiles`，本机那份是 `u_admin` 这种假 id）。

### ⚠️ `writeAll` 的键名归一化

「导出书签」产出的 JSON 是 `{ categories, bookmarks }` —— **没有 `jt:` 前缀**。
而两个适配器的 `writeAll` 按 `storageKeys`（`jt:categories`）匹配，
所以「导出 → 恢复」原来**是坏的**：本地模式下先清空所有业务键再写，
一个都匹配不上 → **清空 + 什么都不写**（点一次丢一次数据）；
云端模式下静默什么都不做，还提示「恢复完成」。

现在统一过 `normalizeSnapshot()`（`src/data/transfer.js`）：
键名归一化、**只动快照里出现的键**、一个键都认不出就返回 `false` 且不动数据。
新增这类「外部文件 → 内部存储」的路径时，务必走这个函数。

### 验证

```bash
# 纯逻辑（键名归一化 / 合并 / 幂等），不需要网络
node --import ./register.mjs transfer-verify.mjs      # 32 条

# 浏览器端（先起 dev server 5174）：自动迁移 + 手动上传 + 导出恢复
node transfer-ui.mjs                                  # 28 条
```
