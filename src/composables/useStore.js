/* =========================================================================
   业务数据仓库
   -------------------------------------------------------------------------
   模块级单例：所有组件共享同一份 reactive 状态，任何改动都会立即落盘。
   每个写操作都遵循「先改内存 → 写盘 → 失败则回滚」的模式，
   与参考站的乐观更新 + 回滚行为一致。
   ========================================================================= */

import { computed, reactive } from 'vue'
import { storage } from '@/data/storage'
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

/** 首次启动时把种子数据写进去。 */
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
  if (!sites || !sites.length) {
    state.sites = clone(seedSites)
    await persist(storageKeys.sites, state.sites)
  } else {
    state.sites = sites
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

/** 应用启动时调一次。 */
export async function initStore() {
  if (state.ready) return

  await seedIfEmpty()
  // 紧跟其后：给老用户补种子里新增的条目（全新用户这里是空操作）
  await syncSeedAdditions()

  state.favorites = (await storage.read(storageKeys.favorites)) || []
  state.submissions = (await storage.read(storageKeys.submissions)) || []
  state.feedback = (await storage.read(storageKeys.feedback)) || []
  state.notes = (await storage.read(storageKeys.notes)) || []
  state.users = (await storage.read(storageKeys.users)) || []
  state.session = await storage.read(storageKeys.session)
  state.visits = (await storage.read(storageKeys.visits)) || {}

  const share = await storage.read(storageKeys.share)
  if (share) state.share = { ...state.share, ...share }

  // 预置一个管理员账号，方便直接体验后台
  if (!state.users.length) {
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

/** 分类 id → 该书签数量（含子分类）。 */
export const categoryCounts = computed(() => {
  const direct = {}
  for (const b of state.bookmarks) {
    direct[b.categoryId] = (direct[b.categoryId] || 0) + 1
  }
  const total = {}
  const walk = (nodes) => {
    for (const n of nodes) {
      const childSum = n.children?.length ? walk(n.children) : 0
      total[n.id] = (direct[n.id] || 0) + childSum
    }
    return total[nodes[0]?.id] != null ? 0 : 0
  }
  // 自底向上累加
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
  void walk
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
    const sub = children.map((c) => ({ category: c, bookmarks: collect(c.id) }))
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

/** 检查 URL 是否重复。 */
export function isDuplicateUrl(url, excludeId = null) {
  const u = normalizeUrl(url).replace(/\/$/, '').toLowerCase()
  return state.bookmarks.some((b) => b.id !== excludeId && b.url.replace(/\/$/, '').toLowerCase() === u)
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

export async function toggleFavorite(siteId) {
  const prev = clone(state.favorites)
  const i = state.favorites.indexOf(siteId)
  if (i >= 0) state.favorites.splice(i, 1)
  else state.favorites.push(siteId)
  const ok = await withRollback(() => {}, () => { state.favorites = prev }, storageKeys.favorites, state.favorites)
  return ok ? i < 0 : null
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

export async function updateShare(patch) {
  state.share = { ...state.share, ...patch }
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
