/* =========================================================================
   probe-realtime-wiring.mjs —— 「哪些表要同步」三处清单的一致性守卫

   为什么需要（2026-10-31）：

     同一份事实被抄在**三个地方**：

       ① `src/data/adapters/cloud.js` 的 `SPECS`        ← 源头（表名 / kind / 主键列）
       ② `src/data/realtimePatch.js` 的 `STATE_TARGET`  ← 事件到了往 state 哪儿放
       ③ `supabase/migrations/003-realtime.sql` 的 `targets` ← 服务端往不往出推

     加一张新表时，三处**必须一起改**。而漂移的失败模式全是**静默**的：

       · 只改 ①②，忘改 ③ → 表不在 publication 里。`subscribe()` 照样
         `SUBSCRIBED`（连不存在的表名都是），然后一条事件收不到。
       · 只改 ①③，忘改 ② → 事件真的推过来了，`applyPatch` 找不到 target
         直接 `return false`。界面什么都不动，日志里一句都没有。
       · 三处都改了但 kind 抄错 → 事件被当成另一种结构应用，可能不报错地错乱。

     这三种都**不会**在开发时被察觉（本机单设备根本收不到自己的事件，
     看起来一切正常），只能靠脚本盯。

   为什么这个文件以前写不出来：
     `cloud.js` import 了 `@/data/supabase`，而那个模块第一句就是
     `import.meta.env.VITE_SUPABASE_URL` —— 裸 node 下 `import.meta.env`
     是 undefined，直接 TypeError。所以 `SPECS` 一直测不了。
     现在 `lib/alias-loader.mjs` 把 `@/data/supabase` 重定向到
     `lib/supabase-stub.mjs`（那个模块在 node 下**本来就加载不起来**，
     桩不是「假货替换真货」，是唯一能让它加载的路）。

   跑法：node scripts/probe-realtime-wiring.mjs   （零依赖、不开浏览器，进 CI）

   分节：
     【1】SPECS ↔ REALTIME_TABLES       哪些表被订阅
     【2】SPECS ↔ STATE_TARGET          订到了之后往哪儿放
     【3】003-realtime.sql ↔ 上面两者   服务端往不往出推
     【4】belongsToMe ↔ filterColumn    两套「怎么认人」必须一致
     【5】applyRemoteChange 的兜底      快照缺失不能就地建
     【6】判别力自检                    上面那些比较真的会红吗
   ========================================================================= */

import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/* ⚠️ 必须在**动态** import 之前注册：静态 import 会在 register() 执行前
      就被解析掉，那时 hook 还没装。见 lib/alias-loader.mjs 的注释。 */
register('./lib/alias-loader.mjs', import.meta.url)

const { SPECS, REALTIME_TABLES, applyRemoteChange } = await import('../src/data/adapters/cloud.js')
const { STATE_TARGET, belongsToMe } = await import('../src/data/realtimePatch.js')
const { storageKeys } = await import('../src/data/options.js')

const SQL_PATH = fileURLToPath(new URL('../supabase/migrations/003-realtime.sql', import.meta.url))

let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(`${name}${detail ? `\n     ${detail}` : ''}`)
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

/** a 里有、b 里没有的项。 */
const missingFrom = (a, b) => a.filter((x) => !b.includes(x))

/** SPECS 的 kind → STATE_TARGET 的 kind。唯一一处不同名的是 blob → settings。 */
const KIND_MAP = { rows: 'rows', ids: 'ids', map: 'map', single: 'single', blob: 'settings' }

const specKeys = Object.keys(SPECS)
const rtKeys = REALTIME_TABLES.map((t) => t.key)
const rtTables = REALTIME_TABLES.map((t) => t.table)

/* ====================================================================== */

console.log('\n【1】SPECS ↔ REALTIME_TABLES —— 哪些表被订阅')

check('SPECS 不是空的（加载到真模块了）', specKeys.length > 0, `拿到 ${specKeys.length} 条`)
check('REALTIME_TABLES 不是空的', rtKeys.length > 0, `拿到 ${rtKeys.length} 条`)

check(
  'REALTIME_TABLES 里的每个 key 都能在 SPECS 里找到',
  missingFrom(rtKeys, specKeys).length === 0,
  `野 key：${missingFrom(rtKeys, specKeys).join(', ')}`,
)

{
  /**
   * 🔴 最重要的一条：SPECS 里新加一张表，`REALTIME_TABLES` 是它推出来的，
   *    所以「加了表却订不到」在代码层面不会发生 —— 但 `global` 标记写错就会。
   *    （给普通表漏标 global 无所谓；给全局表**误标** global 才是灾难：
   *      订阅它等于把每个用户每次点开站点的 views+1 广播给所有在线设备。）
   */
  const shouldSubscribe = specKeys.filter((k) => !SPECS[k].global)
  check(
    '除 global 表外，SPECS 里每一张表都被订阅了',
    missingFrom(shouldSubscribe, rtKeys).length === 0,
    `漏订：${missingFrom(shouldSubscribe, rtKeys).join(', ')}`,
  )

  const globalSubscribed = rtKeys.filter((k) => SPECS[k].global)
  check(
    '🔴 global 表（discover_sites）没有被订阅',
    globalSubscribed.length === 0,
    `被订阅了：${globalSubscribed.join(', ')}`,
  )
}

check(
  'REALTIME_TABLES 的 table 名与 SPECS 一致（没有各写各的）',
  REALTIME_TABLES.filter((t) => SPECS[t.key].table !== t.table).length === 0,
  REALTIME_TABLES.filter((t) => SPECS[t.key].table !== t.table)
    .map((t) => `${t.key}: ${t.table} ≠ ${SPECS[t.key].table}`)
    .join('; '),
)

check(
  'table 名没有重复（重复 = 同一个事件被应用两遍）',
  new Set(rtTables).size === rtTables.length,
  rtTables.join(', '),
)

/* ---------------------------------------------------------------------- */

console.log('\n【2】SPECS ↔ STATE_TARGET —— 订到了之后往哪儿放')

check(
  '🔴 STATE_TARGET 与 REALTIME_TABLES 是**同一组键**（双向，一张不多一张不少）',
  missingFrom(rtKeys, Object.keys(STATE_TARGET)).length === 0 &&
    missingFrom(Object.keys(STATE_TARGET), rtKeys).length === 0,
  `订了但没地方放：${missingFrom(rtKeys, Object.keys(STATE_TARGET)).join(', ') || '无'}；` +
    `有地方放但订不到：${missingFrom(Object.keys(STATE_TARGET), rtKeys).join(', ') || '无'}`,
)

for (const t of REALTIME_TABLES) {
  const spec = SPECS[t.key]
  const target = STATE_TARGET[t.key]
  if (!target) continue // 上面那条已经报过了

  check(
    `${spec.table}：kind 对得上（SPECS ${spec.kind} → STATE_TARGET ${KIND_MAP[spec.kind]}）`,
    target.kind === KIND_MAP[spec.kind],
    `SPECS 是 ${spec.kind}，STATE_TARGET 是 ${target.kind}`,
  )
}

{
  /**
   * `ids` / `map` 两种结构**必须**有 `idColumn`：
   * `applyRemoteChange` 靠它从行里取 `change.id`（favorites 是 `site_id`、
   * visits 是 `bookmark_id`）。缺了会 fallback 成 `'user_id'` ——
   * 于是每条事件的 id 都是用户 id，`applyPatch` 里 indexOf 永远查不到，
   * 表现是「收藏数怎么都不同步」，而且不报任何错。
   */
  const needIdCol = Object.entries(SPECS).filter(([, s]) => s.kind === 'ids' || s.kind === 'map')
  const noIdCol = needIdCol.filter(([, s]) => !s.idColumn).map(([k]) => k)
  check(
    'ids / map 结构的表都写了 idColumn',
    noIdCol.length === 0,
    `缺：${noIdCol.join(', ')}`,
  )

  const idColSameAsTable = needIdCol
    .filter(([, s]) => s.idColumn === 'user_id')
    .map(([k]) => k)
  check('idColumn 没有写成 user_id（那就等于没写）', idColSameAsTable.length === 0, idColSameAsTable.join(', '))
}

{
  /**
   * `noUserCol` 的表（profiles）主键就是 auth uid，没有 user_id 列。
   * 冲突键写成 `user_id,id` 会直接 400。
   */
  const bad = Object.entries(SPECS)
    .filter(([, s]) => s.noUserCol && s.conflict !== 'id')
    .map(([k, s]) => `${k}: ${s.conflict}`)
  check('noUserCol 的表，conflict 必须是 id', bad.length === 0, bad.join('; '))
}

/* ---------------------------------------------------------------------- */

console.log('\n【3】003-realtime.sql ↔ 代码 —— 服务端往不往出推')

const sqlText = readFileSync(SQL_PATH, 'utf8')
const arrayBlock = sqlText.match(/targets\s+text\[\]\s*:=\s*array\[([\s\S]*?)\]/i)
const sqlTables = arrayBlock ? [...arrayBlock[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]) : []

check('能在 SQL 里解析出 targets 数组', sqlTables.length > 0, arrayBlock ? '解析到 0 个表名' : '没匹配到 array[...] 块')

check(
  'targets 里没有重复表名',
  new Set(sqlTables).size === sqlTables.length,
  sqlTables.filter((t, i) => sqlTables.indexOf(t) !== i).join(', '),
)

check(
  '🔴 代码订阅的表都在 SQL 的 targets 里（漏了 = 服务端一条都不推，且订阅仍报 SUBSCRIBED）',
  missingFrom(rtTables, sqlTables).length === 0,
  `SQL 里缺：${missingFrom(rtTables, sqlTables).join(', ')}`,
)

check(
  '🔴 SQL 的 targets 里没有代码没订阅的表（多推 = 白烧流量，还收不到任何处理）',
  missingFrom(sqlTables, rtTables).length === 0,
  `代码里没有：${missingFrom(sqlTables, rtTables).join(', ')}`,
)

{
  /**
   * SQL 最后那段自检写的是 `if n < 10 then raise warning`。
   * 加表时忘了改这个数字，自检就变成**永远通过**的空壳 ——
   * 而它偏偏是那个文件里唯一权威的验收手段。
   */
  const threshold = sqlText.match(/if\s+n\s*<\s*(\d+)\s*then/i)
  check('SQL 里能找到 n < N 的自检阈值', Boolean(threshold), '没匹配到 if n < N then')
  if (threshold) {
    check(
      'SQL 自检阈值与 targets 数量一致（否则自检永远是空壳）',
      Number(threshold[1]) === sqlTables.length,
      `阈值 ${threshold[1]}，实际 ${sqlTables.length} 张表`,
    )
  }
}

/* ---------------------------------------------------------------------- */

console.log('\n【4】belongsToMe ↔ filterColumn —— 两套「怎么认人」必须一致')

{
  /**
   * 服务端按 `filterColumn=eq.<uid>` 决定推不推，
   * 客户端再用 `belongsToMe` 复核一遍。两边的判据必须一致 ——
   *
   *   服务端用 `id`、客户端却去比 `row.user_id`（undefined）
   *   → 恒 false → **每一条事件都被丢掉**，订阅状态却一直是绿的。
   *
   * 这正是「加一张 noUserCol 的表、忘了改 belongsToMe」会发生的事。
   */
  const UID = 'u-probe'
  for (const t of REALTIME_TABLES) {
    const spec = SPECS[t.key]
    check(
      `${spec.table}：belongsToMe 认得 filterColumn（${t.filterColumn}）`,
      belongsToMe(t.key, { [t.filterColumn]: UID }, UID) === true,
    )
  }

  const otherCol = REALTIME_TABLES.filter((t) => {
    const other = t.filterColumn === 'id' ? 'user_id' : 'id'
    return belongsToMe(t.key, { [other]: UID }, UID) === true
  })
  check(
    '没有哪张表能被**另一列**也认成自己的（认错人 = 把别人的行写进本机）',
    otherCol.length === 0,
    otherCol.map((t) => SPECS[t.key].table).join(', '),
  )

  check('uid 为空 → false（未登录时不认任何人）', belongsToMe(storageKeys.bookmarks, { user_id: '' }, '') === false)
  check('row 为 null → false（不炸）', belongsToMe(storageKeys.bookmarks, null, UID) === false)
}

/* ---------------------------------------------------------------------- */

console.log('\n【5】applyRemoteChange 的兜底 —— 快照缺失不能就地建')

{
  check('不认识的 key → null', applyRemoteChange('jt:nonsense', 'INSERT', {}, {}) === null)

  /**
   * 🔴 这条是**数据安全**的兜底：快照缺失时（比如刚登录还没读完）
   *    如果就地建一个「只含这一行」的快照，下一次写会把云端其余行
   *    全判成「已删除」—— 那是真的删数据。所以必须回 `reload`。
   */
  const r = applyRemoteChange(storageKeys.bookmarks, 'INSERT', { id: 'b1', name: 'x' }, null)
  check('🔴 快照缺失 → { op:"reload" }（绝不就地建快照）', r?.op === 'reload', JSON.stringify(r))

  const d = applyRemoteChange(storageKeys.bookmarks, 'DELETE', null, { id: 'b1' })
  check('DELETE 也走同一条兜底', d?.op === 'reload', JSON.stringify(d))
}

/* ---------------------------------------------------------------------- */

console.log('\n【6】判别力自检 —— 上面那些比较真的会红吗')

{
  /**
   * 把【1】【2】【3】的比较逻辑重写一遍喂假数据 —— 确认它们**不是恒真**。
   * 如果连明显漂移的输入都能放行，那上面那一堆 ✅ 就是安慰剂。
   */
  const ok = (specs, rt, sql) => {
    const keys = Object.keys(specs)
    const tables = rt.map((k) => specs[k]?.table ?? k)
    return (
      // 【1】该订的都订了 / 没有野 key / 没有误订 global
      missingFrom(keys.filter((k) => !specs[k].global), rt).length === 0 &&
      missingFrom(rt, keys).length === 0 &&
      rt.filter((k) => specs[k]?.global).length === 0 &&
      // 【3】SQL 与订阅双向一致
      missingFrom(tables, sql).length === 0 &&
      missingFrom(sql, tables).length === 0
    )
  }

  const fakeSpecs = {
    a: { table: 'a' },
    b: { table: 'b' },
    sites: { table: 'discover_sites', global: true },
  }
  check('基准：三处对齐 → 通过', ok(fakeSpecs, ['a', 'b'], ['a', 'b']) === true)
  check('漏订（SPECS 有 b，订阅里没有）→ 红', ok(fakeSpecs, ['a'], ['a', 'b']) === false)
  check('漏加进 SQL（订阅了 b，SQL 里没有）→ 红', ok(fakeSpecs, ['a', 'b'], ['a']) === false)
  check('SQL 多推（代码没订 c）→ 红', ok(fakeSpecs, ['a', 'b'], ['a', 'b', 'c']) === false)
  check('订阅里混进野 key → 红', ok(fakeSpecs, ['a', 'b', 'zz'], ['a', 'b']) === false)
  check('误订阅 global 表 → 红', ok(fakeSpecs, ['a', 'b', 'sites'], ['a', 'b', 'discover_sites']) === false)

  // kind 对齐这条：blob ↔ settings 是唯一合法映射，写错必须红
  const kindOk = (specKind, targetKind) => KIND_MAP[specKind] === targetKind
  check('kind 映射：blob → settings（合法）', kindOk('blob', 'settings') === true)
  check('kind 映射：blob → rows（抄错）→ 红', kindOk('blob', 'rows') === false)
}

/* ====================================================================== */

console.log(`\n${'='.repeat(60)}`)
console.log(`通过 ${pass} / 失败 ${fail}`)
if (fail) {
  console.log('失败项：')
  for (const f of failures) console.log('  · ' + f)
}
process.exit(fail ? 1 : 0)
