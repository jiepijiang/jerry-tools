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
import { replyFeedback, submitFeedback } from '@/data/feedback'
import { buildTree, bookmarkKey, clone, flattenTree, formatDate, normalizeUrl, uid } from '@/utils/helpers'

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
  /**
   * 「键存在但读不出来」的那些键。
   *
   * ⚠️ 这是**数据完整性告警**，不是普通错误 —— 用户需要知道
   *    「你有一份数据我读不出来，我没有动它」，否则他只会看到
   *    一个空页面，然后（在修这个 bug 之前）被种子数据冒充。
   *    见 `seedIfEmpty()` 与 `readState()` 的注释。
   */
  readProblems: [],
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

/* ------------------------------------------------------------ 跨标签页同步 */

/**
 * 业务键 → `state` 上的字段 + 期望的形状。
 *
 * ⚠️ 只列 `useStore` 自己拥有、且用 `persist()` **整表写**的那些键。
 *    不在这里的：
 *      · `settings` —— 归 `useSettings`（另一个 store，有自己的 persist 和订阅）；
 *      · `seedVersion` —— 它是「补种子进度」的标记，不是业务数据。
 */
const CROSS_TAB_FIELDS = {
  [storageKeys.categories]: { field: 'categories', kind: 'array' },
  [storageKeys.bookmarks]: { field: 'bookmarks', kind: 'array' },
  [storageKeys.sites]: { field: 'sites', kind: 'array' },
  [storageKeys.favorites]: { field: 'favorites', kind: 'array' },
  [storageKeys.submissions]: { field: 'submissions', kind: 'array' },
  [storageKeys.feedback]: { field: 'feedback', kind: 'array' },
  [storageKeys.notes]: { field: 'notes', kind: 'array' },
  [storageKeys.users]: { field: 'users', kind: 'array' },
  [storageKeys.visits]: { field: 'visits', kind: 'object' },
  /*
   * ⚠️ `session` 要**允许 `null`** —— 退出登录写的就是 `JSON.stringify(null)`
   *    （也就是字符串 `"null"`）。按「必须是对象」判会把它当成坏值挡掉，
   *    于是**另一个标签页退了登录，这一页还显示登录着**。
   */
  [storageKeys.session]: { field: 'session', kind: 'object', nullable: true },
  // `share` 是「合并」语义（见 `loadAll()`），不是整表替换
  [storageKeys.share]: { field: 'share', kind: 'object', merge: true },
}

/** 整个 storage 被 `clear()`（或某个键被 `removeItem`）时，各字段回到什么值。 */
const CROSS_TAB_EMPTY = {
  visits: () => ({}),
  session: () => null,
  share: () => ({ enabled: false, slug: '', displayName: 'Jerry', avatar: '' }),
}

let crossTabBound = false

/**
 * 监听 `storage` 事件，让**同一个浏览器里另一个标签页**的改动同步进来。
 *
 * ⚠️⚠️ 为什么必须做：`persist(key, value)` 是**整表按内存写** —— 既不重读、
 *    也不合并。两个标签页各拿一份快照，于是**谁后写谁把对方抹掉**。
 *    实测（`/tmp/jerry-sb/multi-tab.mjs`，修复前 **9 / 6**）：
 *      · A 加一条、B 再加一条 → 存储里**只剩 B 的**，A 那条**永久消失**
 *        （刷新也不在）；
 *      · 反向顺序同样（不是「谁先谁赢」的偶然）；
 *      · A 删一条、B 再加一条 → **被删的那条复活**；
 *      · A 改了数据，B 的界面**毫无反应**，而 B 的 localStorage 已经变了 ——
 *        也就是 B 的**内存态已经落后于存储**。
 *    最后一条正是前两条的成因：B 之后任何一次写盘都会把 A 的改动抹掉。
 *
 * ⚠️ `storage` 事件**只发给「其他」标签页**（写的那一页收不到自己发的事件），
 *    所以这里不会自伤 —— 本页写盘不会把本页刚做的改动回滚掉。
 *
 * ⚠️ 云端模式直接返回：那边有 `useRealtime` 的 `supabase.channel()`，
 *    而且这些业务键在云端模式下本来就不写 localStorage。
 *    **本地实现与云端实现不对称，本身就是信号** —— 云端有实时通道，
 *    本地却连「同一个浏览器里另一个标签页」都不同步（而 localStorage
 *    本来就有 `storage` 事件可用）。
 *
 * ⚠️ 还剩一个**很窄的竞态**（这里不修，如实记着）：如果两个标签页在
 *    **同一个事件循环 tick 内**先后写盘，先写的那页可能还没来得及处理
 *    `storage` 事件就被覆盖。正常人手操作（几百毫秒级）撞不上，
 *    真要根治得把 `persist()` 改成「读-改-写」，而整表语义下
 *    「合并」会把删除操作又复活回来 —— 那正是本条要修的 bug。
 */
function initCrossTab() {
  if (crossTabBound) return
  crossTabBound = true

  window.addEventListener('storage', (e) => {
    // 云端模式下这些键不写 localStorage，且有自己的实时通道
    if (isCloudActive()) return

    // `key === null` 表示另一个标签页调了 `localStorage.clear()`。
    // ⚠️ 这里**不写盘** —— 写盘会再触发一轮事件，两个标签页可能来回打。
    //    应用自己从不调 `clear()`（只有外部工具 / DevTools 会），
    //    所以把内存态对齐成「都没有」就够了。
    if (e.key == null) {
      for (const { field } of Object.values(CROSS_TAB_FIELDS)) {
        state[field] = CROSS_TAB_EMPTY[field] ? CROSS_TAB_EMPTY[field]() : []
      }
      return
    }

    const spec = CROSS_TAB_FIELDS[e.key]
    if (!spec) return

    // 键被删掉了（`removeItem`）—— 回到空值，别留着上一个标签页的旧数据
    if (e.newValue == null) {
      state[spec.field] = CROSS_TAB_EMPTY[spec.field] ? CROSS_TAB_EMPTY[spec.field]() : []
      return
    }

    let value
    try {
      value = JSON.parse(e.newValue)
    } catch {
      /*
       * 另一个标签页写进去的是坏 JSON。
       * ⚠️ **保持现有状态，别跟着变空** —— 这正是上一轮
       *    「读不出来 ≠ 没有数据」的同一个原则：读不出来时
       *    最坏的选择是把它当成「没有」。
       */
      if (!state.readProblems.some((p) => p.key === e.key)) {
        state.readProblems.push({ key: e.key, reason: 'bad_json' })
      }
      return
    }

    // 形状不对也当成读不出来（同 `readTyped`）
    const okShape =
      spec.kind === 'array'
        ? Array.isArray(value)
        : value == null
          ? !!spec.nullable
          : typeof value === 'object'
    if (!okShape) {
      if (!state.readProblems.some((p) => p.key === e.key)) {
        state.readProblems.push({ key: e.key, reason: 'bad_shape' })
      }
      return
    }

    state[spec.field] = spec.merge ? { ...state[spec.field], ...value } : value
  })
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
const SEED_VERSION = 3

/**
 * 每个版本**新增**的条目 id，按实体分组。
 *
 * ⚠️ 迁移时**只补这里列出的 id**，不要写成「补所有缺失的 id」——
 * 后者会把用户自己删掉的条目复活（他把 GitHub 删了，下次打开又回来了）。
 */
const SEED_ADDITIONS = {
  // v2（2026-09-20）：导航主页「开发工具」加一条在线串口助手
  2: { bookmarks: ['b22'] },
  /*
   * v3（2026-09-29）：Jerry 点名要的两条
   *   b23 Agent Lab（学习工作台）→ 学习成长
   *   b24 PDF24 Tools            → 效率工具
   *
   * ⚠️ 只登记 id、**不覆盖已有条目的字段** —— 所以老用户拿到的只是
   *    「多了两条」，他自己改过的名字 / 描述 / 分类不会被牵动。
   *    这是**唯一**能让「localStorage 里已经有数据的自己」看到这两条的路径
   *    （`seedIfEmpty()` 只在键不存在时才灌，见那个函数的注释）。
   */
  3: { bookmarks: ['b23', 'b24'] },
}

/**
 * 读一个键，并把「**形状不对**」也算成读不出来。
 *
 * ⚠️ 为什么形状不对要归到 `unreadable` 而不是「空」：
 *    `normalizeSnapshot()` **只校验键名、不校验值的形状**，所以
 *    「恢复了一个不是本站导出的 JSON」会把 `{"bookmarks": {"a":1}}`
 *    原样写进存储。下次启动若把它当成「空」，就会用种子把它顶掉 ——
 *    用户刚恢复的（哪怕是错的）那份数据就没了。
 */
async function readTyped(key, kind) {
  const st = await storage.readState(key)
  if (st.state !== 'ok') return st
  const okShape =
    kind === 'array' ? Array.isArray(st.value) : st.value != null && typeof st.value === 'object'
  return okShape ? st : { state: 'unreadable', value: null, reason: 'bad_shape' }
}

/**
 * 读一个键，读不出来就记一笔并返回兜底值。
 *
 * ⚠️ 别写成 `(await storage.read(k)) || fallback` —— 那会把「读不出来」
 *    和「真的没有」一起静默变成空，用户只看到一个空列表，没有任何解释。
 *    实测：`jt:notes` 存成 `'{'` 时，导出的备份里它**静默消失**，
 *    而 toast 说的是「备份已下载」。
 */
async function readOr(key, fallback) {
  const st = await storage.readState(key)
  if (st.state === 'unreadable') state.readProblems.push({ key, reason: st.reason })
  return st.state === 'ok' && st.value != null ? st.value : fallback
}

/**
 * 首次启动时把种子数据写进去。
 *
 * ⚠️⚠️ 判据**不是**「读出来是空的」。
 *    原来的 `!v || !v.length` 把三种情况混成了一种，后果都很难看：
 *
 *    **① 用户主动清空了**（写的是 `[]`）→ 被判成「首次启动」→ 灌种子。
 *       实测（`/tmp/jerry-sb/empty-vs-first.mjs`）：
 *       点「清除所有书签」→ 刷新 → **22 条种子全回来**；
 *       删掉**最后一条**书签、点「清除分类」，同样复活。
 *       这是用户明确表达「我要清空」，刷新就把它撤销，说不过去。
 *
 *    **② 键存在但读不出来**（坏 JSON / 形状不对）→ 被判成「空」→
 *       `persist()` 把原值**覆盖**掉，用户的原始字节永久消失。
 *       实测（`read-fail-audit.mjs`）：`jt:bookmarks` 存成 `'{'` 之后打开页面，
 *       它被 22 条种子顶掉，界面显示的正是那些种子 —— 用户看到的是
 *       「我的书签变成了默认数据」，而且**连原始字节都救不回来**。
 *
 *    根因是 `read()` 的返回类型 `any | null` 分不清「不存在」和「读不出来」，
 *    所以才有了 `readState()`。现在的判据：
 *
 *      键不存在 + **从没灌过种子** → 灌
 *      其余一律**保持原样**（读不出来的还会记进 `state.readProblems`）
 *
 * ⚠️ 「从没灌过种子」用 `seedVersion` 判断。它在云端模式是 LOCAL_ONLY
 *    （回落到 localStorage），标记的是「**这台设备**有没有灌过」——
 *    正是我们要的语义：首次启动要灌，之后任何一次「空」都不再灌。
 */
async function seedIfEmpty() {
  // 判据之一：这台设备有没有灌过种子（`seedVersion` 一旦落盘就永远在）
  const seeded = (await storage.read(storageKeys.seedVersion)) != null

  /**
   * 决定一个键怎么处理。
   * 返回值：'use'（用读到的值）/ 'seed'（灌种子）/ 'keep'（别动，保持空 + 记一笔）
   */
  const decide = (st) => {
    if (st.state === 'unreadable') return 'keep'
    if (st.state === 'ok') return 'use'
    return seeded ? 'keep' : 'seed' // absent
  }

  const handle = async (key, kind, seedData) => {
    const st = await readTyped(key, kind)
    const action = decide(st)
    if (action === 'use') return st.value
    if (action === 'seed') {
      const fresh = clone(seedData)
      await persist(key, fresh)
      return fresh
    }
    // 'keep'：读不出来、或者「空的但已经灌过种子」。
    // 两种情况都**不写盘** —— 写盘就是覆盖用户的原始数据。
    if (st.state === 'unreadable') state.readProblems.push({ key, reason: st.reason })
    return []
  }

  state.categories = await handle(storageKeys.categories, 'array', seedCategories)
  state.bookmarks = await handle(storageKeys.bookmarks, 'array', seedBookmarks)

  /*
   * ⚠️ `sites`（发现页）在**云端模式下不落盘**。
   *    `discover_sites` 是全局公开表，只有 admin 能写；
   *    普通用户登录后如果在这里把 377 条种子写一遍，
   *    会撞上 RLS、刷一屏 `new row violates row-level security policy`。
   *    全局数据由 `supabase/seed-discover.mjs` 用 service_role 灌一次，
   *    这里只在读到空的时候**在内存里**用种子兜底显示。
   */
  {
    const st = await readTyped(storageKeys.sites, 'array')
    const action = decide(st)
    if (action === 'use') {
      state.sites = st.value
    } else if (action === 'seed') {
      state.sites = clone(seedSites)
      if (!isCloudActive()) await persist(storageKeys.sites, state.sites)
    } else {
      // ⚠️ 发现页读不出来时**不能退回种子** —— 377 条全局数据不是用户数据，
      //    拿种子顶上去会让用户以为「发现页就这些」。保持空 + 记一笔。
      if (st.state === 'unreadable') state.readProblems.push({ key: storageKeys.sites, reason: st.reason })
      state.sites = []
    }
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
 * 把默认分类 + 默认书签**整套**灌回来（**覆盖**现有的分类与书签）。
 *
 * ⚠️⚠️ 为什么需要它 —— 「清空之后没有任何路能回到默认数据」：
 *    `seedIfEmpty()` 的判据是「**键不存在** + 从没灌过种子」，所以
 *    `seedVersion` 一落盘，用户清空之后**再也不会**被灌种子
 *    （这是 2026-09-27 有意改的：用户主动清空，刷新不该复活数据）。
 *    而设置面板里那个「恢复默认」按钮走的是 `useSettings.resetSettings()`，
 *    它只重置**设置项**，一个书签都不动。
 *    实测 `/tmp/jerry-sb/reset-default.mjs`：
 *      · 场景 3 —— 清空书签+分类 → 刷新 → 仍然是 0 / 0（回不来）；
 *      · 场景 1 —— 点「恢复默认(设置)」→ 书签 3 条、分类 2 个，**一条没变**。
 *    两条合起来就是「按了『恢复默认』，数据不但没回来、还什么都没发生」。
 *
 * ⚠️ **破坏性操作**：调用方必须先二次确认。见 `SettingsPanel.vue` 的
 *    `doResetData()` —— 它把确认文案写成了「会覆盖、不可撤销」。
 *
 * ⚠️ 写盘失败要**回滚内存 + 返回 false**，由调用方如实报错。这是本项目的
 *    硬纪律（见 `write-fail-audit.mjs`：写失败却报成功是违约，不是取舍）。
 *
 * ⚠️ 如实记着的残留：两个键**不是原子的**。categories 写成功、bookmarks 写失败时，
 *    内存会整体回滚，但存储里的 categories 已经是新的了 —— 刷新后会看到
 *    「新分类 + 旧书签」。localStorage 没有事务，要根治得把两份数据合成一个键
 *    （会牵动所有读写路径）。这里选择与 `clearCategories()` 保持同一种做法，
 *    并把它记在这里，而不是假装原子。
 *
 * @returns {Promise<boolean>} 是否整套落盘成功
 */
export async function resetToDefaults() {
  const prevCats = state.categories
  const prevBms = state.bookmarks

  // clone：种子是模块级常量，直接塞进 state 会被后续编辑改坏（下一次恢复就脏了）
  const cats = clone(seedCategories)
  const bms = clone(seedBookmarks)

  state.categories = cats
  const okCats = await persist(storageKeys.categories, cats)

  state.bookmarks = bms
  const okBms = await persist(storageKeys.bookmarks, bms)

  if (!okCats || !okBms) {
    state.categories = prevCats
    state.bookmarks = prevBms
    return false
  }

  /*
   * 把「补种子进度」也推到当前版本。
   *
   * 不推也不会重复灌（种子里的 id 现在都在 `state` 里了），但推了语义更准 ——
   * `seedVersion` 记的就是「**这台设备**同步到第几版了」。
   *
   * ⚠️ 这一步失败**不算整体失败**：业务数据已经正确落盘了，
   *    为了一个进度标记把刚恢复好的数据回滚掉才是真的糟糕。
   */
  await persist(storageKeys.seedVersion, SEED_VERSION)

  return true
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
  /*
   * 紧跟其后：给老用户补种子里新增的条目（全新用户这里是空操作）。
   *
   * ⚠️ 有读不出来的键时**什么都别补** —— `syncSeedAdditions()` 会
   *    `persist(storageKeys.bookmarks, …)`，那就是拿种子去覆盖那个
   *    读不出来的原值，正好是 `seedIfEmpty()` 刚刚避开的那个坑。
   *    （`seedVersion` 缺失 + 书签读不出来时真的会走到这条：它会把
   *     `state.bookmarks`（此时是空数组）补成 `[b22]` 然后写盘。）
   */
  if (!state.readProblems.length) await syncSeedAdditions()

  /*
   * ⚠️ 这里以前是 `(await storage.read(k)) || []` —— 读不出来时静默变成空，
   *    用户看到的是一个空列表，没有任何解释。这些键**不会被种子覆盖**
   *    （危害小于上面两个），但同样该让用户知道，所以一起记进 `readProblems`。
   */
  state.favorites = await readOr(storageKeys.favorites, [])
  state.submissions = await readOr(storageKeys.submissions, [])
  state.feedback = await readOr(storageKeys.feedback, [])
  state.notes = await readOr(storageKeys.notes, [])
  state.users = await readOr(storageKeys.users, [])
  state.visits = await readOr(storageKeys.visits, {})

  if (!isCloudActive()) {
    state.session = await readOr(storageKeys.session, null)
  }

  const share = await readOr(storageKeys.share, null)
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
  /*
   * ⚠️ 挂在 `state.ready` 判断**之前**：`initStore()` 可能被调多次
   *    （main.js 一次、切适配器后 `reloadStore()` 一次），
   *    而监听只需要绑一次。放在后面的话「第二次调用」会直接 return，
   *    监听就永远没绑上（而且这个失败是静默的）。
   */
  initCrossTab()
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

/**
 * 「未分类」虚拟分组的 id。
 *
 * ⚠️ 它**只活在渲染层，绝不落库** —— 书签的 `categoryId` 存的是 `null`，
 *    不是这个字符串。别把它当成真分类写进数据（`moveBookmark` 收到它要翻成 `null`）。
 *    前缀用 `__` 双下划线：真实分类 id 是 `createCategory` 生成的时间戳串，不会撞。
 */
export const UNCATEGORIZED_ID = '__uncategorized__'

/**
 * 把「分类数组 + 书签数组」分组成 `{ category, bookmarks, subs, virtual? }` 的有序数组。
 *
 * ⚠️ **主页和分享页必须共用这一个函数**。原来两边各写了一份（`groupedBookmarks`
 *    和 ShareView 里的 `groupShared`），逻辑重复 → 修一边忘一边。事实上两边都
 *    各自踩过同一个 `.self` 的坑，注释也是抄的。
 *
 * ⚠️ 末尾会补一个「未分类」虚拟分组，收那些 `categoryId` 对不上任何现存分类的
 *    书签（`null`，或指向一个已被删掉 / 云端数据不一致的分类 id）。
 *
 *    这一条是**补一个真 bug**（2026-09-27）：`deleteCategory()` 把该分类下的书签
 *    置成 `categoryId: null`，删除确认框也白纸黑字写着「书签将移至未分类」——
 *    但这里**根本没有「未分类」这个分组**，于是那些书签：
 *      卡片上不渲染（不属于任何分组）→ 看不见、编辑不了、删不掉，
 *      而 `bookmarks.length` 照样把它们算进「N 个网址」的计数里。
 *    实测：删掉一个装着 3 条书签的分类后，卡片 5 → 2 张，
 *    而计数仍写「5 个网址」，那 3 条在整页文字里一个都搜不到。
 *    设置面板的「清除分类」更狠 —— 它把**所有**书签都置成 `null`
 *    （注意它是 SettingsPanel 里自己内联实现的，不走 `deleteCategory`），
 *    于是整页 0 张卡、计数还写着 N。用户从此没有任何入口能再看到自己的书签。
 *    （探针：`/tmp/jerry-sb/orphan-bookmarks.mjs`）
 *
 *    补上这个分组之后，**每一条书签都必然落在某个分组里**，
 *    所以 `bookmarks.length` 这个计数口径自动就对了，不用另外改。
 *
 * @param {Array} categories 分类（扁平，含 parentId）
 * @param {Array} bookmarks  书签（扁平）
 */
export function groupBookmarks(categories, bookmarks) {
  const topLevel = categories
    .filter((c) => !c.parentId)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

  const collect = (catId) => {
    const self = bookmarks
      .filter((b) => b.categoryId === catId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    const children = categories
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

  const groups = topLevel.map((cat) => {
    const { self, sub } = collect(cat.id)
    return {
      category: cat,
      bookmarks: self,
      subs: sub.filter((s) => s.bookmarks.length),
    }
  })

  /*
   * 孤儿书签：`categoryId` 为空、或指向一个不存在的分类。
   * `categoryId` 为空字符串也当孤儿（历史数据 / 导入可能留下空串）。
   */
  const knownIds = new Set(categories.map((c) => c.id))
  const orphans = bookmarks
    .filter((b) => !b.categoryId || !knownIds.has(b.categoryId))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))

  if (orphans.length) {
    groups.push({
      /* `virtual` 让视图层知道「名字要走 i18n、这个 id 不是真分类」 */
      virtual: true,
      category: { id: UNCATEGORIZED_ID, name: '', icon: 'Inbox', parentId: null },
      bookmarks: orphans,
      subs: [],
    })
  }

  return groups
}

/** 当前数据的分类分组（主页用）。 */
export const groupedBookmarks = computed(() => groupBookmarks(state.categories, state.bookmarks))

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

/* ------------------------------------------------------------------ 反馈 */

/**
 * 提一条反馈。
 *
 * ⚠️ **不经过 `persist()`** —— `feedback` 在客户端是**只读表**
 *    （`SPECS.feedback.rpcOnly = true`），写入只能走 RPC。
 *    见 `src/data/feedback.js` 与 `supabase/migrations/006-feedback-rpc.sql`。
 *
 * 这里手写「乐观更新 + 失败回滚」，而不是复用 `withRollback()` ——
 * 后者的 `persist()` 走的是整表写，对只读表会被 `writeCloud()` 直接拒掉。
 *
 * @returns {Promise<{ ok: boolean, reason?: string, id?: string }>}
 */
export async function addFeedback({ content, contact = '' }) {
  const text = String(content || '').trim()
  if (!text) return { ok: false, reason: 'empty' }

  const prev = clone(state.feedback)
  const item = {
    id: uid('fb'),
    // 管理员回复要按 (user_id, id) 定位，所以自己的行也带上 ——
    // 云端读回来的行由 SPECS.feedback.fromDb 补这个字段。
    userId: state.session?.id || null,
    content: text,
    contact: String(contact || '').trim(),
    status: 'open',
    reply: '',
    createdAt: formatDate(),
  }
  state.feedback.unshift(item)

  try {
    const { ok, reason } = await submitFeedback({
      id: item.id,
      content: item.content,
      contact: item.contact,
    })
    if (!ok) {
      state.feedback = prev
      return { ok: false, reason }
    }
    return { ok: true, id: item.id }
  } catch (err) {
    console.warn('[feedback] 提交失败，已回滚：', err)
    state.feedback = prev
    return { ok: false, reason: 'error' }
  }
}

/**
 * 管理员回复一条反馈。
 *
 * ⚠️ 必须带 `userId`（被回复那条反馈的**所有者**）——
 *    表的主键是 `(user_id, id)`，`id` 单独并不唯一。
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function setFeedbackReply(fb, reply) {
  const text = String(reply || '').trim()
  if (!text) return { ok: false, reason: 'empty' }
  if (!fb?.userId || !fb?.id) return { ok: false, reason: 'rejected' }

  const idx = state.feedback.findIndex((x) => x.id === fb.id && x.userId === fb.userId)
  if (idx < 0) return { ok: false, reason: 'rejected' }

  const prev = clone(state.feedback)
  state.feedback[idx] = {
    ...state.feedback[idx],
    reply: text,
    status: 'replied',
    repliedAt: formatDate(),
  }

  try {
    const { ok, reason } = await replyFeedback({ userId: fb.userId, id: fb.id, reply: text })
    if (!ok) {
      state.feedback = prev
      return { ok: false, reason }
    }
    return { ok: true }
  } catch (err) {
    console.warn('[feedback] 回复失败，已回滚：', err)
    state.feedback = prev
    return { ok: false, reason: 'error' }
  }
}
