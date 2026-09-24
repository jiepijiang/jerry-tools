/* =========================================================================
   业务数据仓库
   -------------------------------------------------------------------------
   模块级单例：所有组件共享同一份 reactive 状态，任何改动都会立即落盘。
   每个写操作都遵循「先改内存 → 写盘 → 失败则回滚」的模式，
   与参考站的乐观更新 + 回滚行为一致。
   ========================================================================= */

import { computed, reactive } from 'vue'
import { storage, isCloudActive } from '@/data/storage'
import { storageKeys } from '@/data/options'
import { seedBookmarks, seedCategories } from '@/data/seed'
import { seedSites } from '@/data/seed-discover'
import { buildTree, clone, flattenTree, formatDate, normalizeUrl, uid } from '@/utils/helpers'

export const state = reactive({
  ready: false,
  categories: [],
  bookmarks: [],
  sites: [],
  favorites: [],
  submissions: [],
  feedback: [],
  notes: [],
  users: [],
  session: null,
  share: { enabled: false, slug: '', displayName: 'Jerry', avatar: '' },
  visits: {},
})

/* ------------------------------------------------------------------ 落盘 */

async function persist(key, value) {
  return storage.write(key, value)
}

/** 通用的「乐观更新 + 失败回滚」包装。 */
async function withRollback(mutate, rollback, storageKey, storageValue) {
  mutate()
  const ok = await persist(storageKey, storageValue)
  if (!ok) {
    rollback()
    return false
  }
  return true
}

/* ------------------------------------------------------------------ 初始化 */

/**
 * 种子数据版本号。
 *
 * **每次给 `seedCategories` / `seedBookmarks` / `seedSites` 增删条目，都要 +1，
 * 并在下面 `SEED_ADDITIONS` 里登记这一版新增了哪些 id。**
 *
 * 为什么需要这个：`seedIfEmpty()` 只在**存储为空**时灌种子。
 * 老用户 localStorage 里已经有数据，之后往种子里加的条目他们**永远看不到** ——
 * 表现是「代码改了、部署也成功了，但自己打开还是老样子」，
 * 特别容易误判成没部署成功。
 */
const SEED_VERSION = 2

/**
 * 每个版本**新增**的条目 id，按实体分组。
 *
 * ⚠️ 迁移时**只补这里列出的 id**，不要写成「补所有缺失的 id」——
 * 后者会把用户自己删掉的条目复活（他把 GitHub 删了，下次打开又回来了）。
 */
const SEED_ADDITIONS = {
  // v2（2026-09-20）：导航主页「开发工具」加一条在线串口助手
  2: { bookmarks: ['b22'] },
}

/**
 * 首次启动时把种子数据写进去。
 *
 * ⚠️ `sites`（发现页）在**云端模式下不落盘**。
 *    `discover_sites` 是全局公开表，只有 admin 能写；
 *    普通用户登录后如果在这里把 377 条种子写一遍，
 *    会撞上 RLS、刷一屏 `new row violates row-level security policy`。
 *    全局数据由 `supabase/seed-discover.mjs` 用 service_role 灌一次，
 *    这里只在读到空的时候**在内存里**用种子兜底显示。
 */
async function seedIfEmpty() {
  const cats = await storage.read(storageKeys.categories)
  if (!cats || !cats.length) {
    state.categories = clone(seedCategories)
    await persist(storageKeys.categories, state.categories)
  } else {
    state.categories = cats
  }

  const bms = await storage.read(storageKeys.bookmarks)
  if (!bms || !bms.length) {
    state.bookmarks = clone(seedBookmarks)
    await persist(storageKeys.bookmarks, state.bookmarks)
  } else {
    state.bookmarks = bms
  }

  const sites = await storage.read(storageKeys.sites)
  if (sites && sites.length) {
    state.sites = sites
  } else {
    state.sites = clone(seedSites)
    if (!isCloudActive()) await persist(storageKeys.sites, state.sites)
  }
}

/**
 * 把种子里**新增**的条目补进已有数据。只增不删、不改已有条目。
 *
 * 全新用户这里是空操作（种子刚灌进去，id 都在），所以可以无条件调用。
 * 老用户则会把 SEED_VERSION 之后新增的条目补上。
 *
 * 幂等：跑完把 SEED_VERSION 落盘，下次直接返回。
 */
async function syncSeedAdditions() {
  // 读不到（全新用户 / 老版本升级上来）就当作 1，从 v2 开始补
  const saved = Number(await storage.read(storageKeys.seedVersion)) || 1
  if (saved >= SEED_VERSION) return

  let changed = false

  for (let v = saved + 1; v <= SEED_VERSION; v++) {
    const plan = SEED_ADDITIONS[v]
    if (!plan) continue

    // 目前只有 bookmarks 会增条目。以后 categories / sites 也要补的话，
    // 在这里按同样的模式加分支即可。
    for (const id of plan.bookmarks || []) {
      if (state.bookmarks.some((b) => b.id === id)) continue
      const fresh = seedBookmarks.find((b) => b.id === id)
      if (!fresh) continue // 登记了但种子里没有 —— 静默跳过，别让整次初始化挂掉
      state.bookmarks.push(clone(fresh))
      changed = true
    }
  }

  if (changed) await persist(storageKeys.bookmarks, state.bookmarks)
  // 即使没变化也记上版本，避免每次启动都重跑一遍
  await persist(storageKeys.seedVersion, SEED_VERSION)
}

/**
 * 从当前生效的适配器把数据读进内存。
 *
 * 云端模式下 `session` 不由 storage 提供 —— 那是 Supabase Auth 的事
 * （storage 里的 `jt:session` 只在本地模式有意义）。云端登录态由
 * useAuth 写进 `state.session`。
 */
async function loadAll() {
  await seedIfEmpty()
  // 紧跟其后：给老用户补种子里新增的条目（全新用户这里是空操作）
  await syncSeedAdditions()

  state.favorites = (await storage.read(storageKeys.favorites)) || []
  state.submissions = (await storage.read(storageKeys.submissions)) || []
  state.feedback = (await storage.read(storageKeys.feedback)) || []
  state.notes = (await storage.read(storageKeys.notes)) || []
  state.users = (await storage.read(storageKeys.users)) || []
  state.visits = (await storage.read(storageKeys.visits)) || {}

  if (!isCloudActive()) {
    state.session = await storage.read(storageKeys.session)
  }

  const share = await storage.read(storageKeys.share)
  if (share) state.share = { ...state.share, ...share }

  // 预置一个管理员账号，方便直接体验后台。
  // 只在本地模式做 —— 云端模式下 profiles.id 是 uuid，
  // 塞 'u_admin' 这种字符串会直接违反类型约束。
  if (!isCloudActive() && !state.users.length) {
    state.users = [
      {
        id: 'u_admin',
        email: 'admin@jerry.tools',
        password: 'admin123',
        nickname: 'Jerry',
        avatar: '',
        isAdmin: true,
        disabled: false,
        note: '',
        createdAt: formatDate(),
      },
    ]
    await persist(storageKeys.users, state.users)
  }

  state.ready = true
}

/** 应用启动时调一次。 */
export async function initStore() {
  if (state.ready) return
  await loadAll()
}

/**
 * 强制重新加载（忽略 ready 标志）。
 *
 * **切换适配器后必须调这个**：登录 → 云端、退出 → 本地，
 * 内存里那份数据属于上一个模式，不重读的话页面会显示别人的数据
 * （或者退出登录后还看得见云端内容）。
 */
export async function reloadStore() {
  state.ready = false
  await loadAll()
}

/* ------------------------------------------------------------------ 派生 */

/** 分类树（带 children）。 */
export const categoryTree = computed(() => buildTree(state.categories))

/** 拍平的分类列表（带 depth），用于下拉选择与缩进展示。 */
export const flatCategories = computed(() => flattenTree(categoryTree.value))

/** 分类 id → 分类。 */
export const categoryMap = computed(() => {
  const m = {}
  for (const c of state.categories) m[c.id] = c
  return m
})

/** 分类 id → 该书签数量（**含子分类**，与内容区展示的条数口径一致）。 */
export const categoryCounts = computed(() => {
  const direct = {}
  for (const b of state.bookmarks) {
    direct[b.categoryId] = (direct[b.categoryId] || 0) + 1
  }
  // 自底向上累加：先算子分类，再加到父分类头上
  const acc = {}
  const sum = (id) => {
    if (acc[id] != null) return acc[id]
    const children = state.categories.filter((c) => c.parentId === id)
    let n = direct[id] || 0
    for (const c of children) n += sum(c.id)
    acc[id] = n
    return n
  }
  for (const c of state.categories) sum(c.id)
  return acc
})

/** 全部书签按分类分组后的有序数组，用于主页渲染。 */
export const groupedBookmarks = computed(() => {
  const topLevel = state.categories
    .filter((c) => !c.parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

  const collect = (catId) => {
    const self = state.bookmarks
      .filter((b) => b.categoryId === catId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const children = state.categories
      .filter((c) => c.parentId === catId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    /**
     * ⚠️ 这里必须是 `collect(c.id).self`，不能写成 `collect(c.id)`。
     *
     * `collect()` 返回的是 `{ self, sub }` 对象而不是数组。写成对象的话，
     * 下面 `sub.filter((s) => s.bookmarks.length)` 里的 `.length` 是 `undefined`，
     * **所有子分类会被静默滤掉**，一个都不剩。
     *
     * 表现就是「侧栏显示 33，点进去只有 1 个链接」：
     * 侧栏的 `categoryCounts` 是**含子分类**的递归求和（33），
     * 而内容区只渲染 `group.bookmarks`（父分类直属的那 1 条），
     * 子分类的书签一条都不出现。选中子分类更糟 —— `parent.subs.find()` 找不到，
     * 直接返回 `[]`，页面全空。
     */
    const sub = children.map((c) => ({ category: c, bookmarks: collect(c.id).self }))
    return { self, sub }
  }

  return topLevel.map((cat) => {
    const { self, sub } = collect(cat.id)
    return {
      category: cat,
      bookmarks: self,
      subs: sub.filter((s) => s.bookmarks.length),
    }
  })
})

/** 常用书签：按访问次数取前 8 个。 */
export const frequentBookmarks = computed(() => {
  return [...state.bookmarks]
    .map((b) => ({ ...b, visits: state.visits[b.id] || 0 }))
    .filter((b) => b.visits > 0)
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 8)
})

/** 收藏的发现页站点。 */
export const favoriteSites = computed(() =>
  state.sites.filter((s) => state.favorites.includes(s.id || s.url)),
)

/* ------------------------------------------------------------------ 分类 */

export async function createCategory({ name, icon = 'Folder', parentId = null }) {
  const siblings = state.categories.filter((c) => (c.parentId ?? null) === parentId)
  const item = {
    id: uid('cat'),
    name: name.trim(),
    icon,
    parentId,
    sortOrder: siblings.length,
  }
  const prev = clone(state.categories)
  state.categories.push(item)
  const ok = await withRollback(() => {}, () => { state.categories = prev }, storageKeys.categories, state.categories)
  return ok ? item : null
}

export async function updateCategory(id, patch) {
  const prev = clone(state.categories)
  const idx = state.categories.findIndex((c) => c.id === id)
  if (idx < 0) return false
  state.categories[idx] = { ...state.categories[idx], ...patch }
  return withRollback(() => {}, () => { state.categories = prev }, storageKeys.categories, state.categories)
}

/** 删除分类。其下书签移到未分类（categoryId = null），子分类上提为同级。 */
export async function deleteCategory(id) {
  const prevCats = clone(state.categories)
  const prevBms = clone(state.bookmarks)

  const target = state.categories.find((c) => c.id === id)
  if (!target) return false
  const parentId = target.parentId ?? null

  state.categories = state.categories
    .filter((c) => c.id !== id)
    .map((c) => (c.parentId === id ? { ...c, parentId } : c))
  state.bookmarks = state.bookmarks.map((b) => (b.categoryId === id ? { ...b, categoryId: null } : b))

  const ok1 = await persist(storageKeys.categories, state.categories)
  const ok2 = await persist(storageKeys.bookmarks, state.bookmarks)
  if (!ok1 || !ok2) {
    state.categories = prevCats
    state.bookmarks = prevBms
    return false
  }
  return true
}

/** 重排分类（同父级内）。 */
export async function reorderCategories(orderedIds) {
  const prev = clone(state.categories)
  orderedIds.forEach((id, i) => {
    const c = state.categories.find((x) => x.id === id)
    if (c) c.sortOrder = i
  })
  return withRollback(() => {}, () => { state.categories = prev }, storageKeys.categories, state.categories)
}

/* ------------------------------------------------------------------ 书签 */

export async function createBookmark(data) {
  const siblings = state.bookmarks.filter((b) => b.categoryId === data.categoryId)
  const item = {
    id: uid('bm'),
    categoryId: data.categoryId ?? null,
    name: data.name.trim(),
    url: normalizeUrl(data.url),
    description: (data.description || '').trim(),
    icon: data.icon || '',
    sortOrder: siblings.length,
    createdAt: formatDate(),
  }
  const prev = clone(state.bookmarks)
  state.bookmarks.push(item)
  const ok = await withRollback(() => {}, () => { state.bookmarks = prev }, storageKeys.bookmarks, state.bookmarks)
  return ok ? item : null
}

export async function updateBookmark(id, patch) {
  const prev = clone(state.bookmarks)
  const idx = state.bookmarks.findIndex((b) => b.id === id)
  if (idx < 0) return false
  const next = { ...state.bookmarks[idx], ...patch }
  if (patch.url) next.url = normalizeUrl(patch.url)
  state.bookmarks[idx] = next
  return withRollback(() => {}, () => { state.bookmarks = prev }, storageKeys.bookmarks, state.bookmarks)
}

/** URL 的归一化比较键 —— 去尾斜杠 + 小写，与 isDuplicateUrl 同一口径。 */
function bookmarkKey(url) {
  return normalizeUrl(url).replace(/\/$/, '').toLowerCase()
}

/**
 * 批量写入书签：**同 URL 的更新，没有的才新建**。返回 `{ created, updated }`。
 *
 * 为什么不是「逐条 create」：导入文件是可以重新生成的（标题清洗规则一改就得重导），
 * 而用户库里已经有上一份了。逐条 create 会让 975 条整体翻倍，
 * 用户只能先清库重导 —— 那会连带丢掉他自己手加的书签。
 *
 * 为什么按 URL 而不是 id 认人：文件里没有 id（Netscape 格式就没有这个字段）。
 * 唯一稳定的身份就是 URL，而且同一个 URL 出现两次本来也该合并成一条。
 *
 * 覆盖哪几项：name / description / categoryId —— 这三项是「文件说了算」的。
 * 其余（icon、sortOrder、createdAt、访问统计）保留用户侧现状，
 * 重新导入不该把排序打乱、也不该把访问次数清零。
 *
 * ⚠️ 只 persist 一次。原实现是每条 create 都落一次盘（975 次
 * `JSON.stringify` 全量书签），既慢又让 localStorage 反复抖动。
 */
export async function upsertBookmarks(items) {
  const byUrl = new Map()
  for (const b of state.bookmarks) byUrl.set(bookmarkKey(b.url), b)

  const prev = clone(state.bookmarks)
  const nextOrder = {}
  let created = 0
  let updated = 0

  for (const data of items) {
    const url = normalizeUrl(data.url)
    const key = bookmarkKey(url)
    const name = (data.name || '').trim()
    const desc = (data.description || '').trim()
    const cat = data.categoryId ?? null
    const hit = byUrl.get(key)

    if (hit) {
      if (name) hit.name = name
      // 空描述不覆盖 —— 普通 Chrome 导出的 <DD> 常是空的，
      // 照抄会把用户自己写的备注擦掉。想清空请手动编辑。
      if (desc) hit.description = desc
      hit.categoryId = cat
      updated++
      continue
    }

    if (nextOrder[cat] == null) {
      nextOrder[cat] = state.bookmarks.filter((b) => b.categoryId === cat).length
    }
    const item = {
      id: uid('bm'),
      categoryId: cat,
      name: name || url,
      url,
      description: desc,
      icon: data.icon || '',
      sortOrder: nextOrder[cat]++,
      createdAt: formatDate(),
    }
    state.bookmarks.push(item)
    byUrl.set(key, item)
    created++
  }

  const ok = await withRollback(() => {}, () => { state.bookmarks = prev }, storageKeys.bookmarks, state.bookmarks)
  return ok ? { created, updated } : null
}

export async function deleteBookmark(id) {
  const prev = clone(state.bookmarks)
  state.bookmarks = state.bookmarks.filter((b) => b.id !== id)
  return withRollback(() => {}, () => { state.bookmarks = prev }, storageKeys.bookmarks, state.bookmarks)
}

/** 同一分类内重排。 */
export async function reorderBookmarks(orderedIds) {
  const prev = clone(state.bookmarks)
  orderedIds.forEach((id, i) => {
    const b = state.bookmarks.find((x) => x.id === id)
    if (b) b.sortOrder = i
  })
  return withRollback(() => {}, () => { state.bookmarks = prev }, storageKeys.bookmarks, state.bookmarks)
}

/** 把书签移动到另一个分类的指定位置。 */
export async function moveBookmark(id, targetCategoryId, index = null) {
  const prev = clone(state.bookmarks)
  const bm = state.bookmarks.find((b) => b.id === id)
  if (!bm) return false
  bm.categoryId = targetCategoryId
  const siblings = state.bookmarks
    .filter((b) => b.categoryId === targetCategoryId && b.id !== id)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const at = index == null ? siblings.length : Math.max(0, Math.min(index, siblings.length))
  siblings.splice(at, 0, bm)
  siblings.forEach((b, i) => { b.sortOrder = i })
  return withRollback(() => {}, () => { state.bookmarks = prev }, storageKeys.bookmarks, state.bookmarks)
}

/** 检查 URL 是否重复。归一化口径见 bookmarkKey。 */
export function isDuplicateUrl(url, excludeId = null) {
  const u = bookmarkKey(url)
  return state.bookmarks.some((b) => b.id !== excludeId && bookmarkKey(b.url) === u)
}

/** 记录一次访问。 */
export async function recordVisit(id) {
  state.visits[id] = (state.visits[id] || 0) + 1
  await persist(storageKeys.visits, state.visits)
}

/* ------------------------------------------------------------------ 发现页 */

export async function createSite(data, status = 'pending') {
  const item = {
    id: uid('site'),
    title: data.title.trim(),
    url: normalizeUrl(data.url),
    description: (data.description || '').trim(),
    icon: data.icon || '',
    category: data.category || '其他',
    subcategory: data.subcategory || '',
    views: 0,
    collects: 0,
    status,
    submittedBy: state.session?.id || null,
    createdAt: formatDate(),
  }
  const prev = clone(state.sites)
  state.sites.unshift(item)
  const ok = await withRollback(() => {}, () => { state.sites = prev }, storageKeys.sites, state.sites)
  return ok ? item : null
}

export async function updateSite(id, patch) {
  const prev = clone(state.sites)
  const idx = state.sites.findIndex((s) => s.id === id)
  if (idx < 0) return false
  state.sites[idx] = { ...state.sites[idx], ...patch }
  return withRollback(() => {}, () => { state.sites = prev }, storageKeys.sites, state.sites)
}

export async function deleteSite(id) {
  const prev = clone(state.sites)
  state.sites = state.sites.filter((s) => s.id !== id)
  return withRollback(() => {}, () => { state.sites = prev }, storageKeys.sites, state.sites)
}

/**
 * 收藏 / 取消收藏一个发现页站点。
 *
 * ⚠️ `collects`（收藏数）的**权威值在服务端** —— 由 `favorites` 上的
 *    触发器维护，见 `supabase/migrations/004-discover-collects.sql`。
 *    这里只在**内存里** ±1 做即时反馈，**不落盘**：
 *      - 落盘也没用：cloud.js 的 SERVER_MANAGED_COLUMNS 会把这列从 diff 摘掉
 *        （客户端不许写它）；
 *      - 下次 `loadAll()`（刷新 / 登录 / 实时重连）会从库里读回真值，
 *        本地的估算自动被纠正，所以不怕算错。
 *    多设备场景下另一台设备的 ±1 由实时层补，见 useRealtime 的 applyChange。
 */
export async function toggleFavorite(siteId) {
  const prev = clone(state.favorites)
  const site = state.sites.find((s) => s.id === siteId)
  const prevCollects = site?.collects
  const i = state.favorites.indexOf(siteId)
  const adding = i < 0

  if (adding) state.favorites.push(siteId)
  else state.favorites.splice(i, 1)
  if (site) site.collects = Math.max(0, (site.collects || 0) + (adding ? 1 : -1))

  const ok = await withRollback(
    () => {},
    () => {
      state.favorites = prev
      // 计数是跟着收藏一起动的，回滚时也要一起退回去
      if (site && prevCollects !== undefined) site.collects = prevCollects
    },
    storageKeys.favorites,
    state.favorites,
  )
  return ok ? adding : null
}

/**
 * 把某个站点的收藏数 ±1。
 *
 * 给**实时层**用：同一账号的另一台设备收藏/取消收藏了站点时，
 * `favorites` 的变更会推过来，但 `discover_sites` 不在实时订阅里
 * （它是全局表，订阅它等于把每个用户的每次浏览广播给所有人），
 * 所以这边的计数得自己跟着动一下。
 *
 * 只覆盖「同一个账号的另一台设备」。**别人的收藏收不到** ——
 * favorites 的订阅过滤列是 user_id，RLS 也只放行自己的行。
 * 想看别人的最新计数，得等下一次全量读。
 *
 * 找不到站点（比如是待审的、当前用户看不到）就静默跳过。
 */
export function bumpSiteCollects(siteId, delta) {
  const s = state.sites.find((x) => x.id === siteId)
  if (!s) return false
  s.collects = Math.max(0, (s.collects || 0) + delta)
  return true
}

export async function incrementSiteViews(id) {
  const s = state.sites.find((x) => x.id === id)
  if (!s) return
  s.views = (s.views || 0) + 1
  await persist(storageKeys.sites, state.sites)
}

/* ------------------------------------------------------------------ 便签 */

export async function saveNote(note) {
  const prev = clone(state.notes)
  const idx = state.notes.findIndex((n) => n.id === note.id)
  const next = { ...note, updatedAt: formatDate() }
  if (idx >= 0) state.notes[idx] = next
  else state.notes.unshift({ ...next, id: note.id || uid('note'), createdAt: formatDate() })
  return withRollback(() => {}, () => { state.notes = prev }, storageKeys.notes, state.notes)
}

export async function deleteNote(id) {
  const prev = clone(state.notes)
  state.notes = state.notes.filter((n) => n.id !== id)
  return withRollback(() => {}, () => { state.notes = prev }, storageKeys.notes, state.notes)
}

/* ------------------------------------------------------------------ 分享 */

/**
 * 生成一个分享后缀。
 *
 * 为什么要自动生成而不是让用户先填：库里的 `slug` 对**非空**值要求全局唯一，
 * 而前端默认是空串。用户在设置面板里直接点「开启分享」开关时，
 * 若还没有后缀，写下去的会是空串 —— 加上唯一约束就会撞 23505，
 * 而且**只有第二个用户会撞**，单机测试永远发现不了。
 *
 * 所以开启分享时兜一个随机的：`<昵称>-<5 位随机>`。
 * 用户想要好看的后缀，之后在输入框里改就行。
 */
function genSlug(base) {
  const stem =
    String(base || '')
      .toLowerCase()
      .replace(/[^\w-]/g, '')
      .slice(0, 16) || 'nav'
  return `${stem}-${Math.random().toString(36).slice(2, 7)}`
}

export async function updateShare(patch) {
  const next = { ...state.share, ...patch }
  // 开启分享但还没有后缀 → 自动生成一个，别把空串写进库
  if (next.enabled && !String(next.slug || '').trim()) next.slug = genSlug(next.displayName)
  state.share = next
  return persist(storageKeys.share, state.share)
}

/* ------------------------------------------------------------------ 设置联动 */

/** 保存当前登录用户（供 useAuth 调用）。 */
export async function persistSession() {
  return persist(storageKeys.session, state.session)
}

export async function persistUsers() {
  return persist(storageKeys.users, state.users)
}

export async function persistSubmissions() {
  return persist(storageKeys.submissions, state.submissions)
}

export async function persistFeedback() {
  return persist(storageKeys.feedback, state.feedback)
}
