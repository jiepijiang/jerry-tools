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
| **`check-*`（静态）** | **CI 每次 push 自动跑** | `check-i18n-parity.mjs` · `check-i18n-text.mjs` |
| **`probe-*`（端到端）** | **只能手工跑** | `reset-default.mjs` · `perf-audit.mjs` · `interact-audit.mjs` · `sites-source.mjs` |
| 工具 | —— | `serve-static.mjs` · `lib/playwright.mjs` · `recover-from-transcript.mjs` |

> ⚠️ 曾经还有一个 `seed-lazy.mjs`，**已删**。
> 它的断言建立在「云端模式不该请求种子数据」这个前提上 —— 而那个前提
> 后来被证明是错的（未登录访客本来就该拿种子当占位，见 README
> 「发现页的数据从哪来」）。**一个断言写错前提的探针比没有更糟**：
> 它会绿，而且会让人以为那件事被守住了。它要验的东西现在由
> `sites-source.mjs` 用正确的判据覆盖。

**为什么 `probe-*` 进不了 CI**：它们要**真浏览器 + 真 Supabase**
（而登录还得穿过代理）。CI 里没有这些，硬塞进去只会得到一堆假红。
但这**不**意味着它们可以放 `/tmp` —— 「进不了 CI」和「可以丢」是两件事。

## 静态那两道为什么能进 CI

它们零依赖：只读 `src/` 源码 + 直接 `import src/data/i18n.js`
（那个文件自己不 import 任何东西）。所以放在 `npm ci` **之前**跑 ——
文案漏了就别浪费一次安装和构建。

```bash
npm run check:i18n        # 两道都跑，任一失败 → 退出码 1
```

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
