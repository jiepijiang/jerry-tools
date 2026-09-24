/* =========================================================================
   把发现页的 377 条种子灌进 `discover_sites`
   -------------------------------------------------------------------------
   用法：
     SUPABASE_URL=https://<ref>.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
     node supabase/seed-discover.mjs

   ⚠️ 必须用 **service_role**：`discover_sites` 是全局公开表，
      普通用户只有读权限（RLS），插不进去。service_role 绕过 RLS。

   ⚠️ service_role key **绝对不能进前端** —— 它能绕过所有 RLS。
      只在这样的本机脚本里用，不要写进 .env.local（那个会被 Vite 打进产物）。

   id 是**由 url 算出来的确定性哈希**，不是随机值 ——
   这样重复执行是幂等的（upsert），不会灌出 377 条重复数据。
   种子数据里本来就没有 id 字段。

   ⚠️ **重跑不会覆盖 `views` / `collects`。**
      这两列现在是**运行期累加值**：
        - `views`   每次有人点开站点 +1（increment_discover_site_views RPC）
        - `collects` 每次有人收藏 +1（favorites 上的触发器，见
          migrations/004-discover-collects.sql）
      如果按原来的「整行 upsert」重跑，会把这两个计数**打回种子基数** ——
      真实数据静默丢失。所以这里拆成两步：
        1. 只插**不存在的**行（`resolution=ignore-duplicates`），带上基数
        2. 对**已存在的**行只 PATCH 元数据列，永不碰 views / collects
   ========================================================================= */

import { seedSites } from '../src/data/seed-discover.js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !KEY) {
  console.error('需要 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 环境变量')
  process.exit(1)
}

/** djb2 哈希，取 base36。和前端 helpers.js 的 hashString 同一个思路。 */
function hash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** 会变的元数据列。**不含** views / collects（那两个是运行期累加的）。 */
const META_COLUMNS = ['id', 'title', 'url', 'description', 'icon', 'category', 'subcategory', 'status']

function toRow(site) {
  return {
    id: `site_${hash(site.url)}`,
    title: site.title || '',
    url: site.url,
    description: site.description || '',
    icon: site.icon || '',
    category: site.category || '其他',
    subcategory: site.subcategory || '',
    views: site.views || 0,
    collects: site.collects || 0,
    status: 'approved',
    submitted_by: null,
    created_at: site.createdAt || null,
  }
}

/** 只留元数据列。 */
function toMeta(row) {
  const out = {}
  for (const c of META_COLUMNS) out[c] = row[c]
  return out
}

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}

const rows = seedSites.map(toRow)

// id 撞了说明有重复 url，去掉后一个
const byId = new Map()
for (const r of rows) byId.set(r.id, r)
const deduped = [...byId.values()]

console.log(`种子 ${seedSites.length} 条 → 去重后 ${deduped.length} 条`)

const BATCH = 100
let done = 0
for (let i = 0; i < deduped.length; i += BATCH) {
  const chunk = deduped.slice(i, i + BATCH)

  // 1) 只插新行（ON CONFLICT DO NOTHING）。已存在的行原样不动 ——
  //    这是保住 views / collects 的关键。
  const ins = await fetch(`${URL}/rest/v1/discover_sites`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(chunk),
  })
  if (!ins.ok) {
    console.error(`第 ${i / BATCH + 1} 批插入失败 HTTP ${ins.status}: ${(await ins.text()).slice(0, 400)}`)
    process.exit(1)
  }

  // 2) 刷新已有行的元数据。**payload 里没有 views / collects** ——
  //    `merge-duplicates` 生成的 `ON CONFLICT DO UPDATE SET` 只包含
  //    payload 里出现的列，所以那两个计数不会被碰。
  //    （⚠️ 别改成 PATCH + 数组 body：PostgREST 的 PATCH 是「一个对象
  //      套给所有匹配行」，逐行不同值它做不到。）
  const meta = await fetch(`${URL}/rest/v1/discover_sites`, {
    method: 'POST',
    headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(chunk.map(toMeta)),
  })
  if (!meta.ok) {
    console.error(`第 ${i / BATCH + 1} 批元数据刷新失败 HTTP ${meta.status}: ${(await meta.text()).slice(0, 400)}`)
    process.exit(1)
  }

  done += chunk.length
  console.log(`  已写入 ${done}/${deduped.length}`)
}

// 回读确认
const check = await fetch(`${URL}/rest/v1/discover_sites?select=id&status=eq.approved`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' },
})
const range = check.headers.get('content-range')
console.log(`\n库里现有 approved 站点：${range || '(读不到计数)'}`)

// 计数快照 —— 用来确认重跑**没有**把运行期累加值打回种子基数。
// 只取两列，377 行一个请求，很便宜。
const counts = await fetch(`${URL}/rest/v1/discover_sites?select=views,collects`, {
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
})
if (counts.ok) {
  const all = await counts.json()
  const sum = (k) => all.reduce((n, r) => n + (r[k] || 0), 0)
  const seed = (k) => deduped.reduce((n, r) => n + (r[k] || 0), 0)
  console.log(`views    合计 ${sum('views')}（种子基数 ${seed('views')}）`)
  console.log(`collects 合计 ${sum('collects')}（种子基数 ${seed('collects')}）`)
  console.log('↑ 合计**大于**基数说明运行期累加值还在；等于基数说明还没人点过，或者被覆盖了。')
}
