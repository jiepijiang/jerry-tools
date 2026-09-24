# Supabase 后端

这个目录放的是后端相关的**全部**东西：建表脚本、增量迁移、数据种子、验证脚本。

前端在 `src/data/supabase.js` 与 `src/data/adapters/cloud.js`。
**没配环境变量时整个后端是可选的** —— 应用会退回纯 `localStorage` 模式，
功能照常可用，只是登录 / 跨设备同步 / 分享页只在单机范围内生效。

---

## 目录

| 文件 | 作用 | 什么时候跑 |
| --- | --- | --- |
| `schema.sql` | **全量**建表脚本（11 表 / 5 函数 / 4 触发器 / 23 策略） | 新项目从零开始建 |
| `migrations/*.sql` | 增量修复 | 库已经建过，按编号顺序补 |
| `seed-discover.mjs` | 灌发现页的 377 条种子 | 建完表之后跑一次 |
| `verify-rls.mjs` | RLS 隔离性验证（45 条成对断言） | 改过任何策略 / 主键之后**必跑** |

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

按编号顺序执行 `migrations/`：

```bash
node /path/to/run-sql.mjs supabase/migrations/001-composite-pk.sql
node /path/to/run-sql.mjs supabase/migrations/002-share-slug-unique.sql
```

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
重复执行只会覆盖同样的行，不会翻倍。

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

### 三个 `SECURITY DEFINER` 函数，都不是「优化」

- `is_admin()` —— 它要读开着 RLS 的 `profiles`。普通 invoker 函数会撞策略递归。
- `increment_discover_site_views()` —— 匿名访客要改一张只有 admin 能写的表。
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

## 六、已知限制

- **管理员不能在界面上创建 / 删除用户。** 创建 auth 用户需要 `service_role` key，
  那个 key 不能进浏览器。`adminCreateUser` 在云端模式直接返回 null 并打 `console.warn`；
  `adminDeleteUser` 降级成**禁用**（软删除），因为删 auth 账号同样需要 `service_role`。
  真要删人请去 Dashboard → Authentication → Users。
- **`discover_sites` 是全局表**，普通用户没有写权限。前端在云端模式下
  不会把它落盘（只在内存里兜底显示），否则登录后会把 377 条种子写一遍、
  刷一屏 RLS 报错。浏览量走 `increment_discover_site_views` 这个 RPC，人人可用。
- **发送确认邮件需要自备 SMTP。** 默认 SMTP 有严格限流，
  本项目索性关掉了邮箱确认（见上文「认证设置」）。
