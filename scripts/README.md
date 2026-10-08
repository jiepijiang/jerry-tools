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

而且**两条路都走不通**（2026-10-08 核过）：

- **磁盘**：`find` 扫过 `~/`、`/tmp`、`/var/folders`（深度 6），一个副本都没有，也没有 zip 备份
- **历史对话**：`conversation_search` 试了 4 次（含放宽时间范围），**全部 0 命中**

→ 所以 `reset-default.mjs`（45 条断言 / 8 场景，项目最值钱的那套）
**只能重写**，不是「搬一下」。那次教训换来的就是这条规矩。

---

## 两层：`check-*` 和 `probe-*`

| 层 | 什么时候跑 | 有哪些 |
| --- | --- | --- |
| **`check-*`（静态）** | **CI 每次 push 自动跑** | `check-i18n-parity.mjs` · `check-i18n-text.mjs` |
| **`probe-*`（端到端）** | **只能手工跑** | `perf-audit.mjs` · `interact-audit.mjs` · `seed-lazy.mjs` |
| 工具 | —— | `serve-static.mjs` · `lib/playwright.mjs` |

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
npm run probe:seed       # 两个 base 都打
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

## 一次性调试脚本

`_dbg-*` 是临时排查用的，**故意不搬**。它们记录的是「当时怎么查的」，
有价值的部分应该写进 README / 项目记忆，而不是留在脚本里。
