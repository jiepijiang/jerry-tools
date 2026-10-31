# `scripts/` —— 守卫与探针

**规矩只有一条：探针一律写在这里，不要放 `/tmp`。**

---

## 为什么（这不是洁癖，是已经付过学费）

探针原来住在 `/tmp/jerry-sb/`。2026-10-08 清点时，**12 个以上已经没了**：

```
reset-default · transfer-cloud · feedback-flow · route-guard · i18n-render
i18n-en-check · write-sites-honest · pglite-006 · unit-cloud · empty-vs-first
read-fail-audit · write-fail-audit · settings-audit · orphan-bookmarks · loader.mjs
```

### ✅ 但它们后来**全都捞回来了**（2026-10-09）

当时我核过两条路，都走不通，于是断言「只能重写」：

- **磁盘**：`find` 扫过 `~/`、`/tmp`、`/var/folders`（深度 6），没有副本，也没 zip 备份
- **历史对话**：`conversation_search` 试了 4 次，全部 0 命中

**那条断言是错的 —— 我漏了第三条路。**

```
~/.workbuddy-ai/projects/<项目>/<会话id>.jsonl     ← 存着每次 Write / Edit 的完整参数
```

用 `scripts/recover-from-transcript.mjs` 回放（先 Write 铺底、再逐条 apply Edit），
**354 个文件**可恢复，丢的那批全在里面。`reset-default.mjs` 已恢复并复跑 **45 / 0**。

### ⚠️ 但这**不**是「所以可以继续放 /tmp」

- 记录**只覆盖 Write / Edit** —— 用 `sed` / 内联 python 改过的部分**不在里面**
- 记录**会被轮转裁剪** —— 只找到 2 个会话记录；更早的会话真没了
- 回放**可能失真** —— 某条 Edit 的 `old_string` 找不到时，恢复出来的是**中间态**

所以规矩不变，而且这次有实证：**该进仓库的东西必须进仓库。**
`recover-from-transcript.mjs` 只是最后一道保险，不是免死金牌。

---

## 两层：`check-*` 和 `probe-*`

| 层 | 什么时候跑 | 有哪些 |
| --- | --- | --- |
| **静态守卫（进 CI）** | **CI 每次 push 自动跑**，且在 `npm ci` 之前 | `check-i18n-parity.mjs` · `check-i18n-text.mjs` · `check-meta.mjs` · `check-css-vars.mjs` · `probe-icon-mode.mjs` · `probe-transfer.mjs` · `probe-realtime-patch.mjs` · `probe-realtime-wiring.mjs` |
| **`probe-*`（端到端）** | **只能手工跑** | `reset-default.mjs` · `perf-audit.mjs` · `interact-audit.mjs` · `sites-source.mjs` · `probe-engine-pop.mjs` · `probe-footer.mjs` · `probe-seed-urls.mjs` · `probe-seed-icons.mjs` · `probe-seed-icons-render.mjs` · `probe-discover-lazy.mjs` · `probe-mobile-layout.mjs` · `probe-realtime-live.mjs` |
| 工具 | —— | `serve-static.mjs` · `lib/playwright.mjs` · `lib/alias-loader.mjs` · `lib/supabase-stub.mjs` · `recover-from-transcript.mjs` |

> 📌 名字里带 `probe-` **不等于**只能手工跑。分界线是「要不要真浏览器 / 真网络」，
> 不是文件名 —— `probe-icon-mode` / `probe-transfer` / `probe-realtime-patch`
> / `probe-realtime-wiring` 都是纯函数探针，照样进 CI。

> ⚠️ 曾经还有一个 `seed-lazy.mjs`，**已删**。
> 它的断言建立在「云端模式不该请求种子数据」这个前提上 —— 而那个前提
> 后来被证明是错的（未登录访客本来就该拿种子当占位，见 README
> 「发现页的数据从哪来」）。**一个断言写错前提的探针比没有更糟**：
> 它会绿，而且会让人以为那件事被守住了。它要验的东西现在由
> `sites-source.mjs` 用正确的判据覆盖。

**为什么端到端 `probe-*` 进不了 CI**：它们要**真浏览器 + 真 Supabase**
（而登录还得穿过代理）。CI 里没有这些，硬塞进去只会得到一堆假红。
但这**不**意味着它们可以放 `/tmp` —— 「进不了 CI」和「可以丢」是两件事。

## 静态那几道为什么能进 CI

它们零依赖：只读 `src/` 源码 + 直接 `import` 那些**自己不 import 任何东西**的模块
（`data/i18n.js` / `data/options.js`）。所以放在 `npm ci` **之前**跑 ——
漏了就别浪费一次安装和构建。

```bash
npm run check:i18n        # 两道都跑，任一失败 → 退出码 1
```

### `probe-realtime-patch.mjs`：抽出来才测得了（2026-10-31）

实时变更的判决逻辑（`STATE_TARGET` / `sameLocalObject` / `applyPatch`）原来长在
`useRealtime.js` 里，而那个文件 import 了 useStore / useSettings / supabase ——
裸 node 下一个都加载不起来，所以它**一行测试都没有**。

它偏偏最该被钉：`sameLocalObject` 判错一次，自己写的每一条回声都会被当成
「远端变了」，每次写都白刷一遍 UI（列表重排、输入框失焦、动画重放）；
`ids` 分支判错一次，收藏数会重复 +1。两种都是**静默**的。

做法和 `transfer.js` 一模一样：只保留对 `data/options.js`（零 import）的依赖，
把 `state` 和两个副作用（应用设置 / 收藏计数）**从参数传进来**，
于是它变成纯函数。副作用注入的另一个好处是探针能直接数调用次数。

73 条断言，跑一次几十毫秒，**零依赖、不开浏览器**。
判别力也自检了（真去改源码验的，不是猜的）：把 `sameLocalObject` 换成
「比较整个对象」的朴素实现，**红 7 条**；把 `ids` 分支的查重去掉，
**红 4 条**（其中一条正是「收藏回声 → 不重复计数」）。

### `probe-realtime-wiring.mjs`：三处清单的一致性守卫（2026-10-31）

「哪些表要同步」这份事实被抄在**三个地方**，加表时必须一起改：

| # | 在哪 | 管什么 |
| --- | --- | --- |
| ① | `adapters/cloud.js` 的 `SPECS` | 源头：表名 / kind / 主键列 |
| ② | `realtimePatch.js` 的 `STATE_TARGET` | 事件到了往 state 哪儿放 |
| ③ | `supabase/migrations/003-realtime.sql` 的 `targets` | 服务端往不往出推 |

漂移的失败模式**全是静默的**，而且本机开发根本发现不了（单设备收不到自己的事件）：

- 只改 ①②、忘改 ③ → 表不在 publication 里。`subscribe()` 照样 `SUBSCRIBED`
  （连不存在的表名都是），然后一条事件收不到。
- 只改 ①③、忘改 ② → 事件真推过来了，`applyPatch` 找不到 target 直接 `return false`，
  界面什么都不动，日志里一句都没有。
- 三处都改但 kind 抄错 → 事件被当成另一种结构应用，可能不报错地错乱。

**这个文件以前写不出来**：`cloud.js` import 了 `@/data/supabase`，而那个模块第一句就是
`import.meta.env.VITE_SUPABASE_URL` —— 裸 node 下 `import.meta.env` 是 `undefined`，
直接 TypeError。所以 `SPECS` 一直测不了。

解法是给 `lib/alias-loader.mjs` 加一条重定向：`@/data/supabase` → `lib/supabase-stub.mjs`。
**这不是「用假货糊弄测试」** —— 那个模块在 node 下本来就加载不起来，桩是唯一能让它加载的路。
桩里的 `supabase` 是个 Proxy，任何属性访问都抛一句人话（`then` 除外，否则会被当成 thenable），
而不是让人在 `Cannot read properties of null` 里猜。

51 条断言，零依赖、几十毫秒。四类：

| 节 | 钉住什么 |
| --- | --- |
| 1–2 | `SPECS` ↔ `REALTIME_TABLES` ↔ `STATE_TARGET` **双向**同键、kind 一一映射（`blob → settings` 是唯一不同名的）、`ids`/`map` 必须写 `idColumn` |
| 3 | SQL 的 `targets` 与代码订阅**双向**相等；连 `if n < 10` 那个自检阈值也一起对（阈值写死了，加表忘了改，自检就变空壳） |
| 4 | `belongsToMe` ↔ `filterColumn` 必须一致。服务端按 `id=eq.<uid>` 推、客户端却去比 `row.user_id`（undefined）→ 恒 false → **每条事件都被丢掉**，订阅状态还绿着 |
| 5 | `applyRemoteChange` 快照缺失必须回 `{op:'reload'}` —— 就地建快照会让下次写把云端其余行全判成「已删除」，那是真删数据 |

判别力同样是**改源码验的**：从 SQL 的 `targets` 删掉 `'notes'` → 红 2 条（含阈值那条）；
从 `STATE_TARGET` 删掉 `visits` → 红 1 条（顺带 `probe-realtime-patch` 红 7 条）；
去掉 profiles 的 `noUserCol` → 红 2 条（第 4 节那两条，正是「加了一张没有 user_id 列的表」的场景）。

⚠️ 顺带说明：`belongsToMe` 这次从 `useRealtime.js` 挪进了 `realtimePatch.js`（纯函数，
uid 从参数传）。不挪就测不了 —— 而它恰恰是「认错人」那一层的唯一判据。


## 端到端探针怎么跑

```bash
# ① 对线上跑（最简单）
npm run probe:perf                        # 默认打 https://jiepijiang.github.io/jerry-tools/
npm run probe:perf -- http://127.0.0.1:5200/jerry-tools/    # 或指定 base

# ② 对本地产物跑（要两个服务：云端模式 + 本机模式）
npm run build            # → dist/（云端模式）
npm run build:nosb       # → dist-nosb/（本机模式，无 Supabase）
npm run serve:dist       # 5200，服务 dist/
node scripts/serve-static.mjs dist-nosb /jerry-tools/ 5201   # 5201，服务 dist-nosb/
npm run probe:sites      # 两个 base 都打（发现页的数据来源）
npm run probe:reset      # 「恢复默认」+ 默认配置完整性（8 场景 / 45 条断言）
npm run probe:pop        # 搜索引擎下拉框：层叠 / 不透明 / 收起时机（11 条）
npm run probe:footer     # 页脚：互链矩阵 + 可读性 + 英文不混中文（19 条）
npm run probe:realtime   # 云同步：两个浏览器上下文 + 真断线（24 条，跑一次约 3 分钟）
```

### 云同步为什么只能这样验（2026-10-26）

`useRealtime.js` 的文件头写着「订阅状态不等于能收到事件，唯一可靠的判据是
**写一行 → 看有没有事件**」—— 然后这条判据在注释里躺了半年，**没有任何脚本执行过它**。
`probe-realtime-live.mjs` 就是补这个洞的：两个独立浏览器上下文登录同一账号，
A 直接走 REST 插/删一行，断言 B **不刷新**就跟着变。

三个反直觉的地方，都是实测撞出来的，改这个探针时别绕回去：

| 以为 | 实际 |
| --- | --- |
| `context.setOffline(true)` 能模拟断网 | **不能**。它不掐已建立的 websocket，服务端发来的帧只是堆在缓冲区，网络恢复时原样补发。实测断网 20 秒期间插一行：指示灯全程 `live`、零条 `[realtime]` 日志、恢复后那行**直接出现** —— 看起来「同步很棒」，其实是浏览器在替我们兜底。要真断线得用 `routeWebSocket` 掐。 |
| `MAX_RETRY = 6` 放弃后就永久死了 | **不会**。日志里「自己不再重建 channel」之后紧跟着一条 `全量重读（重连）` —— 救回来的是 **supabase-js 自己的重连**，它重连成功会把 `SUBSCRIBED` 再抛一次，我们的 `onStatus` 接住并做全量重读。所以我们那层退避只是**叠加**，不是唯一命脉。 |
| 卡片出现了 = 断线补偿生效了 | **不一定**。必须同时在日志里看到 `全量重读（重连）` —— 那才是「走的是 reloadStore」的因果证据，否则可能是事件其实到了、或别的东西碰巧刷新了列表。 |

⚠️ 这个探针**进不了 CI**：要真网络、要探针账号、跑一次约 3 分钟（⑥ 那节是故意的长跑）。
它靠 `PROBE_EMAIL` / `PROBE_PASSWORD` 环境变量，默认值就是那个测试账号；
跑完会自己删掉插进去的行，中途崩了也会在 `finally` 里清。


### 种子图标的三级探针（2026-10-13）

验「48 条默认书签的图标能不能显示」时，**一级比一级严格**，
而且**每一级都抓到了上一级漏掉的东西** —— 所以三级都得留着：

| 级 | 脚本 | 量什么 | 漏掉了什么 |
| --- | --- | --- | --- |
| ① 可达性 | `probe-seed-urls.mjs` | 站点通不通 + `/apple-touch-icon.png` `/favicon.ico` 存不存在 | 站点把图标放在别的路径（HTML 里 `<link rel=icon>` 声明的那 13 个） |
| ② 真实路径 | `probe-seed-icons.mjs` | 解析 HTML 的 `<link rel="icon">`，按 apple-touch / svg / 体积打分挑最优 | **HTTP 层的绿全是假绿** —— 见下 |
| ③ 真渲染 | `probe-seed-icons-render.mjs` | 在真 Chromium 里读 `naturalWidth > 0` | —— |

> 📌 **「HTTP 200 + `image/png`」和「浏览器画得出来」是两件事。**
> ② 全绿的情况下，③ 一跑 **48 个图标有 7 个加载不出来**：
> 6 个是沙箱网络到不了（走代理就好），1 个是**站点自己的缺陷** ——
> 花瓣网的 `/favicon.ico` 返回**结构损坏的 ICO**，HTTP 200 但 Chromium
> 拒绝解码，**连 `requestfailed` 都不触发**（所以只监听网络事件也抓不到）。
> **验图片要看 `naturalWidth`，不能看状态码。**

用法（被墙的站点必须带代理，否则那 6 个必红，那是网络不是 URL）：

```bash
npm run probe:seed-render -- --proxy http://127.0.0.1:7897   # 42 可渲染 / 0 失败
```

### 写新探针时请遵守

1. **playwright 从 `./lib/playwright.mjs` 拿**，不要写绝对路径：
   ```js
   import pw from './lib/playwright.mjs'
   const browser = await pw.chromium.launch({ headless: true, ...proxyOpt })
   ```
   它按 `$PLAYWRIGHT_PATH` → 项目 `node_modules` → `~/node_modules` 依次找。
   **不要把 playwright 加进 `devDependencies`** —— 这几个探针进不了 CI，
   加进去只会让每次 `npm ci` 多拖几百 MB 浏览器包。

2. **路径由脚本自身位置推**，不要写死仓库路径：
   ```js
   const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
   ```

3. **给浏览器配代理**。Playwright 的 Chromium **不继承系统代理、也不读 `http_proxy`**。
   这台机器直连时常断（github / supabase 都可能是 `000`），只有 Clash `127.0.0.1:7897` 通。
   不配代理的话，登录页会永远「操作失败」，看着像应用坏了，其实是网络。
   记得把 `127.0.0.1,localhost` 加进 bypass，否则连本地静态服务也绕出去。

4. **断言要有能判别的判据**，别只断言「落点没变」这种坏版本也能满足的东西。
   反面教材见 README「三道 i18n 守卫」一节里那条**假绿**（`safeRedirect` 坏掉时全绿）。

5. **造红一次**，确认断言真会红。

6. **动了共享状态要还原**。踩过：`i18n-en-check` 在登录态切了语言，
   而语言登录后存**云端** `user_settings` → 把共享测试账号的语言永久改成英文，
   别的探针（找「数据备份」按钮的那个）就莫名其妙地红，症状指向它自己、根因却在更早那次运行。

7. **`/tmp` 只放一次性的调试脚本**（`_dbg-*.mjs`），用完就丢。有复用价值的立刻搬进来。

---

## 东西丢了怎么捞回来

```bash
# ① 先列出来（默认只看 /tmp/ 下的 —— 也就是「本来就不该是唯一副本」的那批）
node scripts/recover-from-transcript.mjs --list
node scripts/recover-from-transcript.mjs --list --filter jerry-sb

# ② 捞一个 / 全捞
node scripts/recover-from-transcript.mjs --dump /tmp/jerry-sb/reset-default.mjs ./reset-default.mjs
node scripts/recover-from-transcript.mjs --dump-all /tmp/_recovered --filter jerry-sb
```

**原理**：`~/.workbuddy-ai/projects/<项目>/<会话id>.jsonl` 里存着每次
`Write` / `Edit` 的完整参数。对同一个路径「先 Write 铺底、再逐条 apply Edit」即可还原。

**三条边界，用之前必须知道：**

1. **只覆盖 Write / Edit。** 用 `sed` / 内联 python 改过的文件，那部分**不在记录里**。
2. **回放可能失真。** 某条 Edit 的 `old_string` 找不到 = 它前面那条已动过同一段。
   脚本会打 `⚠️ N 条 Edit 对不上，可能是中间态` —— **这种必须跑一遍验证再信**。
3. **记录会被轮转裁剪。** 更早的会话被清了就真没了。

→ 所以这个脚本是**最后一道保险，不是免死金牌**。
   捞回来的东西**第一件事是跑一遍**，别直接信。

---

## 一次性调试脚本

`_dbg-*` 是临时排查用的，**故意不搬**。它们记录的是「当时怎么查的」，
有价值的部分应该写进 README / 项目记忆，而不是留在脚本里。
