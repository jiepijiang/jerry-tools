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
  const res = await fetch(`${URL}/rest/v1/discover_sites`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      // 按主键 upsert，重复执行不产生重复行
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(chunk),
  })
  if (!res.ok) {
    console.error(`第 ${i / BATCH + 1} 批失败 HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`)
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
