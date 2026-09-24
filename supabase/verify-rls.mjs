/* =========================================================================
   RLS 隔离性验证
   -------------------------------------------------------------------------
   用法：
     SUPABASE_URL=https://<ref>.supabase.co \
     SUPABASE_ANON_KEY=<anon key> \
     [SUPABASE_SERVICE_ROLE_KEY=<service_role key>] \
     node supabase/verify-rls.mjs

   service_role key 只用来**清理测试账号**，不给就留着（脚本会提示）。

   为什么要有这个脚本：RLS 写错的代价很高，而且**失败方式很隐蔽** ——
   策略太松是「读到了不该读的」（不会有任何报错），
   太紧是「读得到、写不了」（报错信息还含糊）。
   所以每一条断言都必须**成对**：
     - 正向：该成功的必须成功（否则可能只是整页/整表没数据，看着像"干净"）
     - 反向：该被挡的必须被挡（否则策略等于没写）
   只测一个方向的话，「全部通过」可能只是什么都没生效。
   ========================================================================= */

const URL = process.env.SUPABASE_URL
const ANON = process.env.SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL || !ANON) {
  console.error('需要 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量')
  process.exit(1)
}

let pass = 0
let fail = 0
let skipped = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

/**
 * 明确记一笔「这一段没跑」。
 *
 * 为什么必须显式计数：跳过的段落如果只是打印一行说明、不进汇总，
 * 最后那句「通过 N / 失败 0」就会**把没测的东西也算成绿的**。
 * 一整段策略没验证过，和验证通过看起来一模一样 —— 这是最坏的一种假绿。
 */
function skip(name) {
  skipped++
  console.log(`  ⏭️  ${name}`)
}

/** 带 apikey 的 fetch。token 传 null 表示匿名。 */
async function api(path, { method = 'GET', token = null, body, prefer } = {}) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (prefer) headers.Prefer = prefer
  const res = await fetch(`${URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* 非 JSON */ }
  return { status: res.status, ok: res.ok, json, text }
}

const rest = (t, p, o = {}) => api(`/rest/v1/${p}`, { ...o, token: t })
const rpc = (t, fn, args) => api(`/rest/v1/rpc/${fn}`, { method: 'POST', token: t, body: args })

async function signUp(email, password, nickname) {
  const r = await api('/auth/v1/signup', {
    method: 'POST',
    body: { email, password, data: { nickname } },
  })
  if (r.json?.access_token) return { token: r.json.access_token, id: r.json.user.id }
  // 邮箱确认开着的话这里没有 token —— 明确报出来，别让它伪装成"注册成功"
  throw new Error(`注册未返回 token（HTTP ${r.status}）：${r.text.slice(0, 300)}`)
}

async function signIn(email, password) {
  const r = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  })
  if (!r.json?.access_token) throw new Error(`登录失败（HTTP ${r.status}）：${r.text.slice(0, 300)}`)
  return { token: r.json.access_token, id: r.json.user.id }
}

const suffix = Date.now().toString(36)
const PW = 'verify-rls-9f3k2'
const mailA = `rls-a-${suffix}@example.com`
const mailB = `rls-b-${suffix}@example.com`

/**
 * 开跑前清掉**上一次**留下的测试账号。
 *
 * 脚本中途崩掉（断言失败、网络抖动）时末尾的清理不会执行，
 * 残留账号会占着 `dev` / `b1` 这类公共 id，让下一次跑出现
 * 莫名其妙的 403 —— 与其指望 finally，不如每次开跑先自愈。
 */
if (SERVICE) {
  const r = await fetch(
    `${URL}/rest/v1/profiles?select=id,email&or=(email.like.rls-*@example.com,email.like.e2e-*@example.com,email.like.diag-*@example.com)`,
    { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } },
  )
  const stale = await r.json()
  for (const u of stale) {
    await fetch(`${URL}/auth/v1/admin/users/${u.id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
  }
  if (stale.length) console.log(`（开跑前清掉 ${stale.length} 个残留测试账号）`)
}

console.log(`\n项目：${URL}`)
console.log(`测试账号：${mailA} / ${mailB}\n`)

/* ---------------------------------------------------------------- 准备 */
console.log('【准备】注册两个账号')
const A = await signUp(mailA, PW, 'A 用户')
const B = await signUp(mailB, PW, 'B 用户')
// 用登录再拿一次 token，顺便验证 signInWithPassword 这条路径本身是通的
const A2 = await signIn(mailA, PW)
check('注册后能正常登录（密码路径可用）', A2.token === A.token || A2.token.length > 20)
check('两个账号拿到的 user id 不同', A.id !== B.id, `${A.id} vs ${B.id}`)
console.log(`  A=${A.id}\n  B=${B.id}`)

/* --------------------------------------------------- 1. 用户表自动建档 */
console.log('\n【1】注册时自动建 profile（handle_new_user 触发器）')
const pA = await rest(A.token, `profiles?select=id,email,nickname,role,disabled&id=eq.${A.id}`)
check('A 能读到自己的 profile', pA.json?.length === 1, `拿到 ${pA.json?.length} 行`)
check('nickname 从注册元数据带过来了', pA.json?.[0]?.nickname === 'A 用户', JSON.stringify(pA.json?.[0]))
check('新用户默认 role=user', pA.json?.[0]?.role === 'user')
const pB = await rest(B.token, `profiles?select=id&id=eq.${A.id}`)
check('B 读不到 A 的 profile（反向）', pB.json?.length === 0, `拿到 ${pB.json?.length} 行`)

/* --------------------------------------------- 2. 私有表按用户隔离 */
console.log('\n【2】bookmarks 按 user_id 隔离')
const bmA = { id: `bm_test_a_${suffix}`, user_id: A.id, name: 'A 的书签', url: 'https://a.example.com', sort_order: 0 }
const insA = await rest(A.token, 'bookmarks', { method: 'POST', body: bmA, prefer: 'return=representation' })
check('A 能插入自己的书签（正向）', insA.ok && insA.json?.length === 1, `HTTP ${insA.status} ${insA.text.slice(0, 200)}`)

const aReadOwn = await rest(A.token, 'bookmarks?select=id&id=eq.' + bmA.id)
check('A 能读到自己刚插的书签', aReadOwn.json?.length === 1)

const bReadA = await rest(B.token, 'bookmarks?select=id&id=eq.' + bmA.id)
check('B 读不到 A 的书签（反向）', bReadA.json?.length === 0, `拿到 ${bReadA.json?.length} 行`)

const anonRead = await rest(null, 'bookmarks?select=id&id=eq.' + bmA.id)
check('匿名读不到任何书签（反向）', anonRead.json?.length === 0, `拿到 ${anonRead.json?.length} 行`)

// B 试图改 A 的行：RLS 会把目标行过滤掉，于是影响 0 行（不是报错）
const bPatch = await rest(B.token, `bookmarks?id=eq.${bmA.id}`, {
  method: 'PATCH', body: { name: '被 B 改掉了' }, prefer: 'return=representation',
})
check('B 改不动 A 的书签（反向）', (bPatch.json?.length ?? 0) === 0, `影响了 ${bPatch.json?.length} 行`)

const aStillOwn = await rest(A.token, `bookmarks?select=name&id=eq.${bmA.id}`)
check('A 的书签名字没被改（反向的确认）', aStillOwn.json?.[0]?.name === 'A 的书签', JSON.stringify(aStillOwn.json?.[0]))

// B 试图把行插到 A 名下：with check 会直接拒
const bSpoof = await rest(B.token, 'bookmarks', {
  method: 'POST', body: { ...bmA, id: `bm_test_spoof_${suffix}`, name: '冒充 A' },
})
check('B 不能把书签插到 A 名下（反向）', !bSpoof.ok, `HTTP ${bSpoof.status}`)

// B 删 A 的行
const bDel = await rest(B.token, `bookmarks?id=eq.${bmA.id}`, { method: 'DELETE', prefer: 'return=representation' })
check('B 删不掉 A 的书签（反向）', (bDel.json?.length ?? 0) === 0, `删掉了 ${bDel.json?.length} 行`)

/* ------------------------------------------- 2b. 两个用户用同一个 id */
console.log('\n【2b】两个用户用**同一个 id**（真实场景：都跑同一份种子）')
/**
 * 这一段是补的回归测试，来由值得记一下：
 *
 * 初版 schema 把用户私有表的主键设成了 `id` 单列（全局唯一）。
 * 而两个用户的分类 id 都是种子里的 `dev` / `design` / …，
 * 第二个用户写入时 upsert 会翻译成 `ON CONFLICT (id) DO UPDATE`，
 * 撞上的是**别人的行**，RLS 的 USING 判假 → 403：
 *   new row violates row-level security policy (USING expression)
 *
 * 第一个用户一切正常，第二个永远写不进去；报错还说是「违反 RLS」，
 * 极容易误判成策略写错。主键已改成 (user_id, id)。
 *
 * ⚠️ 为什么上面【2】那一段没抓到：它用的是随机 id（`bm_test_a_<时间戳>`），
 *    两个用户天然不会撞。**测试数据不真实，测试就是假的。**
 *    所以这里刻意用两个用户共用的固定 id。
 */
const sharedCat = { id: 'dev', name: 'A 的开发工具', icon: 'Code2', parent_id: null, sort_order: 0 }
const catA = await rest(A.token, 'categories', { method: 'POST', body: { ...sharedCat, user_id: A.id }, prefer: 'return=representation' })
check('A 能写入 id=dev 的分类（正向）', catA.ok && catA.json?.length === 1, `HTTP ${catA.status} ${catA.text.slice(0, 200)}`)

const catB = await rest(B.token, 'categories', { method: 'POST', body: { ...sharedCat, name: 'B 的开发工具', user_id: B.id }, prefer: 'return=representation' })
check('B 也能写入**同一个 id=dev**（正向，这条就是当初漏掉的）', catB.ok && catB.json?.length === 1, `HTTP ${catB.status} ${catB.text.slice(0, 240)}`)

const aDev = await rest(A.token, 'categories?select=name&id=eq.dev')
const bDev = await rest(B.token, 'categories?select=name&id=eq.dev')
check('A 读到的是自己那条', aDev.json?.[0]?.name === 'A 的开发工具', JSON.stringify(aDev.json))
check('B 读到的是自己那条', bDev.json?.[0]?.name === 'B 的开发工具', JSON.stringify(bDev.json))

// A 改自己的，不能动到 B 的
await rest(A.token, 'categories?id=eq.dev', { method: 'PATCH', body: { name: 'A 改过了' } })
const bAfter = await rest(B.token, 'categories?select=name&id=eq.dev')
check('A 改自己的 dev 不会波及 B 的（反向）', bAfter.json?.[0]?.name === 'B 的开发工具', JSON.stringify(bAfter.json))

// 书签同理（种子书签 id 是 b1 / b2 …）
const bmA2 = { id: 'b1', user_id: A.id, name: 'A 的 GitHub', url: 'https://github.com', category_id: 'dev', description: '', icon: '', sort_order: 0, created_at: '2026-09-01' }
const bmB2 = { id: 'b1', user_id: B.id, name: 'B 的 GitHub', url: 'https://github.com', category_id: 'dev', description: '', icon: '', sort_order: 0, created_at: '2026-09-01' }
const insA2 = await rest(A.token, 'bookmarks', { method: 'POST', body: bmA2, prefer: 'return=representation' })
const insB2 = await rest(B.token, 'bookmarks', { method: 'POST', body: bmB2, prefer: 'return=representation' })
check('A 能写入 id=b1 的书签', insA2.ok, `HTTP ${insA2.status} ${insA2.text.slice(0, 160)}`)
check('B 也能写入**同一个 id=b1**（正向）', insB2.ok, `HTTP ${insB2.status} ${insB2.text.slice(0, 240)}`)

// upsert（PATCH 语义）也要能各改各的
const upA = await rest(A.token, 'bookmarks', {
  method: 'POST', body: { ...bmA2, name: 'A 的 GitHub（改）' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
const upB = await rest(B.token, 'bookmarks', {
  method: 'POST', body: { ...bmB2, name: 'B 的 GitHub（改）' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
check('upsert 同一 id 时 A 改自己的成功', upA.ok && upA.json?.[0]?.name === 'A 的 GitHub（改）', `HTTP ${upA.status} ${upA.text.slice(0, 200)}`)
check('upsert 同一 id 时 B 改自己的成功', upB.ok && upB.json?.[0]?.name === 'B 的 GitHub（改）', `HTTP ${upB.status} ${upB.text.slice(0, 200)}`)

/* ------------------------------------------------ 3. 提权与解封 */
console.log('\n【3】用户不能自己提权 / 解封')
const selfPromote = await rest(A.token, `profiles?id=eq.${A.id}`, {
  method: 'PATCH', body: { role: 'admin' }, prefer: 'return=representation',
})
const afterPromote = await rest(A.token, `profiles?select=role&id=eq.${A.id}`)
check('A 不能把自己改成 admin（反向）', afterPromote.json?.[0]?.role === 'user', `role 变成了 ${afterPromote.json?.[0]?.role}（HTTP ${selfPromote.status}）`)

const selfUnban = await rest(A.token, `profiles?id=eq.${A.id}`, {
  method: 'PATCH', body: { disabled: false, nickname: '改昵称是允许的' }, prefer: 'return=representation',
})
check('A 改自己的昵称是允许的（正向）', selfUnban.ok && selfUnban.json?.[0]?.nickname === '改昵称是允许的', `HTTP ${selfUnban.status} ${selfUnban.text.slice(0, 160)}`)

/* ------------------------------------------- 4. discover_sites 公开读 */
console.log('\n【4】discover_sites：公开读 / 只有 admin 能改')
const siteApproved = {
  id: `site_ok_${suffix}`, title: '已通过站点', url: 'https://ok.example.com', status: 'approved',
}
const sitePending = {
  id: `site_pending_${suffix}`, title: '待审站点', url: 'https://pending.example.com',
  status: 'pending', submitted_by: A.id,
}
// 用 service_role 造数据（或者没有 service_role 就跳过）
//
// ⚠️ 两条**分开**插，不要塞进同一个数组。PostgREST 的批量插入要求
//    同一批对象的键完全一致，而这两个对象的字段本来就不同
//    （一个带 submitted_by、一个不带），合在一起会报
//    `PGRST102 All object keys must match` —— 报错还很含糊，
//    结果就是整段断言静默跳过、看着像"通过"（踩过）。
let seeded = false
if (SERVICE) {
  const h = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
  const r1 = await fetch(`${URL}/rest/v1/discover_sites`, { method: 'POST', headers: h, body: JSON.stringify([siteApproved]) })
  const r2 = await fetch(`${URL}/rest/v1/discover_sites`, { method: 'POST', headers: h, body: JSON.stringify([sitePending]) })
  seeded = r1.ok && r2.ok
  if (!seeded) {
    console.log(`  （造数据失败：approved HTTP ${r1.status} / pending HTTP ${r2.status}）`)
    if (!r1.ok) console.log(`   ${(await r1.text()).slice(0, 200)}`)
    if (!r2.ok) console.log(`   ${(await r2.text()).slice(0, 200)}`)
  }
} else {
  for (const n of [
    '匿名能读到 approved 站点', '匿名读不到 pending 站点', '提交者能看到自己的 pending',
    '别人看不到这条 pending', '普通用户改不了站点', '普通用户不能直接提交 approved',
    '普通用户能提交 pending', '匿名调用浏览量自增生效',
  ]) skip(n)
}

if (seeded) {
  const anonApproved = await rest(null, `discover_sites?select=id&id=eq.${siteApproved.id}`)
  check('匿名能读到 approved 站点（正向）', anonApproved.json?.length === 1, `拿到 ${anonApproved.json?.length} 行`)

  const anonPending = await rest(null, `discover_sites?select=id&id=eq.${sitePending.id}`)
  check('匿名读不到 pending 站点（反向）', anonPending.json?.length === 0, `拿到 ${anonPending.json?.length} 行`)

  const aPending = await rest(A.token, `discover_sites?select=id&id=eq.${sitePending.id}`)
  check('提交者能看到自己的 pending（正向）', aPending.json?.length === 1)

  const bPending = await rest(B.token, `discover_sites?select=id&id=eq.${sitePending.id}`)
  check('别人看不到这条 pending（反向）', bPending.json?.length === 0)

  const aEdit = await rest(A.token, `discover_sites?id=eq.${siteApproved.id}`, {
    method: 'PATCH', body: { title: '被普通用户改了' }, prefer: 'return=representation',
  })
  check('普通用户改不了站点（反向）', (aEdit.json?.length ?? 0) === 0, `影响了 ${aEdit.json?.length} 行`)

  const aSelfApprove = await rest(A.token, 'discover_sites', {
    method: 'POST', body: { id: `site_self_${suffix}`, title: '自助上线', url: 'https://x.example.com', status: 'approved', submitted_by: A.id },
  })
  check('普通用户不能直接提交 approved（反向）', !aSelfApprove.ok, `HTTP ${aSelfApprove.status}`)

  const aSubmitPending = await rest(A.token, 'discover_sites', {
    method: 'POST', body: { id: `site_mine_${suffix}`, title: '我提交的', url: 'https://mine.example.com', status: 'pending', submitted_by: A.id },
  })
  check('普通用户能提交 pending（正向）', aSubmitPending.ok, `HTTP ${aSubmitPending.status} ${aSubmitPending.text.slice(0, 160)}`)

  // 浏览量自增：匿名也能 +1（走 definer 函数）
  const before = (await rest(null, `discover_sites?select=views&id=eq.${siteApproved.id}`)).json?.[0]?.views
  const inc = await rpc(null, 'increment_discover_site_views', { p_site_id: siteApproved.id })
  const after = (await rest(null, `discover_sites?select=views&id=eq.${siteApproved.id}`)).json?.[0]?.views
  check('匿名调用浏览量自增生效（正向）', inc.ok && after === (before ?? 0) + 1, `before=${before} after=${after} HTTP ${inc.status}`)
}

/* ------------------------------------------- 5. visits / favorites 复合主键 */
console.log('\n【5】visits / favorites（复合主键 + 隔离）')
const vA = await rest(A.token, 'visits', {
  method: 'POST', body: { user_id: A.id, bookmark_id: bmA.id, count: 1 },
  prefer: 'resolution=merge-duplicates,return=representation',
})
check('A 能写自己的 visits（正向）', vA.ok, `HTTP ${vA.status} ${vA.text.slice(0, 160)}`)

const vA2 = await rest(A.token, 'visits', {
  method: 'POST', body: { user_id: A.id, bookmark_id: bmA.id, count: 5 },
  prefer: 'resolution=merge-duplicates,return=representation',
})
const vARead = await rest(A.token, `visits?select=count&bookmark_id=eq.${bmA.id}`)
check('visits upsert 按复合主键覆盖而不是插新行（正向）', vA2.ok && vARead.json?.length === 1 && vARead.json?.[0]?.count === 5, JSON.stringify(vARead.json))

const vBRead = await rest(B.token, `visits?select=count&bookmark_id=eq.${bmA.id}`)
check('B 读不到 A 的 visits（反向）', vBRead.json?.length === 0, `拿到 ${vBRead.json?.length} 行`)

/* ------------------------------------------- 6. 分享页 RPC */
console.log('\n【6】get_shared_nav')
const slug = `jerry-${suffix}`
const noShare = await rpc(null, 'get_shared_nav', { p_slug: slug })
check('未开启分享时返回 null（反向）', noShare.json === null, JSON.stringify(noShare.json))

const shareWrite = await rest(A.token, 'share_settings', {
  method: 'POST',
  body: { user_id: A.id, enabled: false, slug, display_name: 'Jerry 测试' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
check('A 能写自己的 share_settings（正向）', shareWrite.ok, `HTTP ${shareWrite.status} ${shareWrite.text.slice(0, 160)}`)

const disabledShare = await rpc(null, 'get_shared_nav', { p_slug: slug })
check('enabled=false 时仍返回 null（反向）', disabledShare.json === null, JSON.stringify(disabledShare.json))

await rest(A.token, `share_settings?user_id=eq.${A.id}`, { method: 'PATCH', body: { enabled: true } })
const shared = await rpc(null, 'get_shared_nav', { p_slug: slug })
check('开启后匿名能拿到分享数据（正向）', !!shared.json && shared.json.displayName === 'Jerry 测试', JSON.stringify(shared.json)?.slice(0, 200))
check('分享数据里带上了 A 的书签', Array.isArray(shared.json?.bookmarks) && shared.json.bookmarks.some((b) => b.id === bmA.id), `拿到 ${shared.json?.bookmarks?.length} 条`)

// B 开一个不同 slug，确认拿不到 A 的数据
const slugB = `other-${suffix}`
await rest(B.token, 'share_settings', {
  method: 'POST', body: { user_id: B.id, enabled: true, slug: slugB, display_name: 'B' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
const sharedB = await rpc(null, 'get_shared_nav', { p_slug: slugB })
check('B 的分享里看不到 A 的书签（反向）', !!sharedB.json && !sharedB.json.bookmarks.some((b) => b.id === bmA.id), `B 拿到 ${sharedB.json?.bookmarks?.length} 条`)

/* ------------------------------------------- 6b. share_settings.slug 唯一性 */
console.log('\n【6b】share_settings.slug 的唯一性只对非空值生效')
/**
 * 这一段是 002 迁移的回归。
 *
 * 原 schema 把 slug 写成了 `not null unique`（全量唯一），而前端默认
 * `slug: ''`。用户在设置面板点一下「开启分享」就会写空串 ——
 * **第一个用户没事，第二个用户必撞 23505**。和【2b】的复合主键是
 * 同一类 bug：默认值撞唯一约束，且只在第二个用户身上暴露。
 *
 * 断言要成对：空串必须**放行**（正向），非空重名必须**拦住**（反向）。
 * 只测前者的话，把唯一性整个删掉也能过；只测后者的话，
 * 把全量唯一约束加回来也能过。两条一起才锁得住语义。
 */
const emptyA = await rest(A.token, 'share_settings', {
  method: 'POST',
  body: { user_id: A.id, enabled: false, slug: '', display_name: 'A 空后缀' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
check('A 能用空 slug 写（正向）', emptyA.ok, `HTTP ${emptyA.status} ${emptyA.text.slice(0, 200)}`)

const emptyB = await rest(B.token, 'share_settings', {
  method: 'POST',
  body: { user_id: B.id, enabled: false, slug: '', display_name: 'B 空后缀' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
check('B 也能用**同一个空 slug** 写（正向，这条就是当初漏掉的）', emptyB.ok, `HTTP ${emptyB.status} ${emptyB.text.slice(0, 200)}`)

// 反向：非空 slug 仍然必须全局唯一
const dupSlug = `dup-${suffix}`
await rest(A.token, 'share_settings', {
  method: 'POST',
  body: { user_id: A.id, enabled: false, slug: dupSlug, display_name: 'A 占用' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
const dupB = await rest(B.token, 'share_settings', {
  method: 'POST',
  body: { user_id: B.id, enabled: false, slug: dupSlug, display_name: 'B 抢' },
  prefer: 'resolution=merge-duplicates,return=representation',
})
check('B 抢一个已被占用的非空 slug 会被拦下（反向）', !dupB.ok && dupB.status === 409, `HTTP ${dupB.status} ${dupB.text.slice(0, 160)}`)

// 把 A 的 slug 恢复成正常的，别影响后面的清理
await rest(A.token, `share_settings?user_id=eq.${A.id}`, { method: 'PATCH', body: { slug } })

/* ---------------------------------------------------------------- 清理 */
console.log('\n【清理】')
if (SERVICE) {
  /**
   * ⚠️ 站点数据要**单独清**，不能指望删账号带走。
   *    `discover_sites.submitted_by` 是 `on delete set null`，
   *    删掉测试账号只会把 submitted_by 置空，行还留在库里 ——
   *    第一次跑完没清，线上就多出 3 条测试站点（"已通过站点" 之类），
   *    还让发现页总数从 377 变成 380。踩过。
   */
  const testSiteIds = [
    siteApproved.id, sitePending.id,
    `site_self_${suffix}`, `site_mine_${suffix}`,
  ]
  const r = await fetch(`${URL}/rest/v1/discover_sites?id=in.(${testSiteIds.join(',')})`, {
    method: 'DELETE',
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
  })
  const gone = r.ok ? await r.json() : []
  console.log(`  删除测试站点 ${gone.length} 条 → HTTP ${r.status}`)

  for (const id of [A.id, B.id]) {
    const d = await fetch(`${URL}/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
    console.log(`  删除测试账号 ${id} → HTTP ${d.status}`)
  }
  console.log('  （categories/bookmarks/notes/visits/favorites/share_settings 都是 on delete cascade，跟着账号走）')
} else {
  console.log('  没给 SUPABASE_SERVICE_ROLE_KEY，测试数据留在项目里了：')
  console.log(`    账号 ${mailA} / ${mailB}`)
  console.log(`    站点 ${siteApproved.id} / ${sitePending.id}`)
  console.log('  想清掉就去 Dashboard → Authentication → Users 手动删，')
  console.log('  站点还要去 Table Editor → discover_sites 删（submitted_by 是 set null，不会跟着走）。')
}

/* ---------------------------------------------------------------- 汇总 */
console.log(`\n${'='.repeat(52)}`)
console.log(`通过 ${pass} / 失败 ${fail} / 跳过 ${skipped}`)
if (skipped) {
  console.log(`\n⚠️  有 ${skipped} 条断言**根本没跑**，不能算通过 —— 见上面的 ⏭️ 行。`)
}
if (fail) {
  console.log('\n失败的断言：')
  for (const f of failures) console.log(`  - ${f}`)
}
console.log('='.repeat(52))
process.exit(fail ? 1 : 0)
