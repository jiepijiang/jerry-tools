/* =========================================================================
   用户系统
   -------------------------------------------------------------------------
   两套实现，按后端是否配置自动选：

     配了 Supabase → supabase.auth（真认证、真会话、密码不落前端）
     没配          → 本地模拟（账号存 localStorage、密码明文，仅够跑交互）

   ⚠️ 本地模拟那套**没有任何安全性**，只用于没配后端的降级场景。
      别用真实密码注册。

   登录 / 退出都会**切换存储适配器**并重新加载内存数据 ——
   否则会出现「退出登录了还看得见云端书签」这种串档。
   ========================================================================= */

import { computed } from 'vue'
import { state, persistSession, persistUsers, reloadStore } from '@/composables/useStore'
import { supabase, supabaseConfigured } from '@/data/supabase'
import { useCloudStorage, useLocalStorage, localStorageAdapter, isCloudActive, storage } from '@/data/storage'
import { storageKeys } from '@/data/options'
import { uid } from '@/utils/helpers'

/** 管理后台的口令闸（本地写死）。云端模式下这只是个「你确定吗」的二次确认， */
/** 真正的权限判断在 profiles.role 和数据库 RLS 上。 */
export const ADMIN_PASSWORD = 'jerry'

export const currentUser = computed(() => state.session)
export const isLoggedIn = computed(() => !!state.session)
export const isAdmin = computed(() => !!state.session?.isAdmin)

/** 后端是否已配置（决定登录注册走哪条路）。 */
export const cloudAuthEnabled = supabaseConfigured

/** 云端模式下「删除用户」实际是禁用 —— 删 auth 用户需要 service_role，前端做不到。 */
export const userRemovalMode = computed(() => (isCloudActive() ? 'disable' : 'delete'))

function publicUser(u) {
  if (!u) return null
  const { password, ...rest } = u
  return rest
}

/* ------------------------------------------------------------ 错误映射 */

/**
 * 把 Supabase 的英文报错翻成项目里已有的 error code。
 * 前端各处只认这几个 code（见 i18n 的 auth.* 文案），
 * 直接把 `error.message` 丢给用户会看到一长串英文。
 */
function mapAuthError(error) {
  const m = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  if (code === 'invalid_credentials' || m.includes('invalid login credentials')) return 'bad_credentials'
  if (m.includes('already registered') || code === 'user_already_exists') return 'email_taken'
  if (m.includes('at least 6 characters') || code === 'weak_password') return 'weak_password'
  if (m.includes('email not confirmed')) return 'email_not_confirmed'
  if (m.includes('signups not allowed') || code === 'signup_disabled') return 'signup_disabled'
  if (m.includes('rate limit') || m.includes('too many')) return 'rate_limited'
  return 'unknown'
}

/* ------------------------------------------------------------ 云端实现 */

/** 读 profiles 里自己那行，拼成前端用的 user 对象。 */
async function loadCloudProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.warn('[auth] 读 profile 失败：', error.message)
    return null
  }
  if (!data) return null
  return {
    id: data.id,
    email: data.email,
    nickname: data.nickname,
    avatar: data.avatar,
    isAdmin: data.role === 'admin',
    disabled: data.disabled,
    note: data.note,
    createdAt: String(data.created_at || '').slice(0, 10),
  }
}

/**
 * 首次登录时把本机数据搬上云端。
 *
 * ⚠️ 判断「云端是否已有数据」必须**直接查云端**，不能看 `state`：
 *    1. 这个函数跑在 initStore 之前，state 此刻还是空的；
 *    2. 就算 state 有内容，那也是**本机**那份，拿它当"云端非空"是循环论证。
 *
 * ⚠️ 而且**必须在第一次 reloadStore 之前调**。反过来的话，
 *    reloadStore 里的 seedIfEmpty 会先往空云端灌一套种子，
 *    之后这里就判定"云端非空"、直接跳过 ——
 *    用户自己的书签永远上不去，看到的是默认种子。
 *
 * 只在云端为空时执行；云端已有数据时**绝不覆盖**（多设备场景下那是灾难）。
 */
async function migrateLocalToCloud() {
  const cloudCats = await storage.read(storageKeys.categories)
  if ((cloudCats?.length || 0) > 0) return { migrated: false }
  const cloudBms = await storage.read(storageKeys.bookmarks)
  if ((cloudBms?.length || 0) > 0) return { migrated: false }

  // 本机那份从 localStorageAdapter 直接读 —— 此时适配器已经切到云端了
  const localCats = await localStorageAdapter.read(storageKeys.categories)
  const localBms = await localStorageAdapter.read(storageKeys.bookmarks)
  const localNotes = await localStorageAdapter.read(storageKeys.notes)
  const hasLocal = (localCats?.length || 0) > 0 || (localBms?.length || 0) > 0
  if (!hasLocal) return { migrated: false }

  if (localCats?.length) await storage.write(storageKeys.categories, localCats)
  if (localBms?.length) await storage.write(storageKeys.bookmarks, localBms)
  if (localNotes?.length) await storage.write(storageKeys.notes, localNotes)
  return { migrated: true, categories: localCats?.length || 0, bookmarks: localBms?.length || 0 }
}

/**
 * 切到云端模式的**唯一入口**。
 *
 * 登录、注册、启动恢复会话三条路都要走这里 —— 之前分开写，
 * 结果注册那条漏了迁移，新用户注册后云端是空的、
 * 页面上显示的是默认种子而不是他本机那份数据。
 *
 * ⚠️ 顺序不能变：迁移 → reloadStore。
 *    反过来的话 reloadStore 里的 seedIfEmpty 会先往空云端灌一套种子，
 *    迁移就判定「云端非空」跳过了。
 */
async function enterCloudMode(profile) {
  useCloudStorage()
  state.session = profile
  await migrateLocalToCloud()
  await reloadStore()
  // reloadStore 在云端模式不碰 session（那是 Auth 的事），保险起见再钉一次
  state.session = profile
}

async function cloudRegister({ email, password, nickname }) {
  const mail = String(email || '').trim().toLowerCase()
  if (!mail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, error: 'invalid_email' }
  if (!password || String(password).length < 6) return { ok: false, error: 'weak_password' }

  const { data, error } = await supabase.auth.signUp({
    email: mail,
    password: String(password),
    options: { data: { nickname: String(nickname || '').trim() } },
  })
  if (error) return { ok: false, error: mapAuthError(error) }

  // 邮箱确认没关的话这里没有 session，用户得先去收邮件
  if (!data.session) return { ok: false, error: 'email_not_confirmed' }

  const profile = await loadCloudProfile(data.user.id)
  if (!profile) return { ok: false, error: 'no_profile' }
  await enterCloudMode(profile)
  return { ok: true, user: profile }
}

async function cloudLogin({ email, password }) {
  const mail = String(email || '').trim().toLowerCase()
  const { data, error } = await supabase.auth.signInWithPassword({ email: mail, password: String(password) })
  if (error) return { ok: false, error: mapAuthError(error) }

  const profile = await loadCloudProfile(data.user.id)
  if (!profile) {
    // 有 auth 账号但没有 profile —— 触发器漏了或者被删了。
    // 明确报出来，别让用户对着一个空白账号发懵。
    await supabase.auth.signOut()
    return { ok: false, error: 'no_profile' }
  }
  if (profile.disabled) {
    await supabase.auth.signOut()
    return { ok: false, error: 'disabled' }
  }

  await enterCloudMode(profile)
  return { ok: true, user: profile }
}

/* ------------------------------------------------------------ 本地实现 */

async function localRegister({ email, password, nickname }) {
  const mail = String(email || '').trim().toLowerCase()
  if (!mail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return { ok: false, error: 'invalid_email' }
  if (!password || String(password).length < 6) return { ok: false, error: 'weak_password' }
  if (state.users.some((u) => u.email.toLowerCase() === mail)) return { ok: false, error: 'email_taken' }

  const user = {
    id: uid('u'),
    email: mail,
    password: String(password),
    nickname: String(nickname || '').trim() || mail.split('@')[0],
    avatar: '',
    isAdmin: false,
    disabled: false,
    note: '',
    createdAt: new Date().toISOString().slice(0, 10),
  }
  state.users.push(user)
  await persistUsers()
  state.session = publicUser(user)
  await persistSession()
  return { ok: true, user: state.session }
}

async function localLogin({ email, password }) {
  const mail = String(email || '').trim().toLowerCase()
  const u = state.users.find((x) => x.email.toLowerCase() === mail)
  if (!u || u.password !== String(password)) return { ok: false, error: 'bad_credentials' }
  if (u.disabled) return { ok: false, error: 'disabled' }
  state.session = publicUser(u)
  await persistSession()
  return { ok: true, user: state.session }
}

/* ------------------------------------------------------------ 对外接口 */

/** 注册。 */
export async function register(form) {
  return supabaseConfigured ? cloudRegister(form) : localRegister(form)
}

/** 登录。 */
export async function login(form) {
  return supabaseConfigured ? cloudLogin(form) : localLogin(form)
}

/** 退出。切回本地存储并重载数据，避免退出后还看得见云端内容。 */
export async function logout() {
  if (supabaseConfigured && isCloudActive()) {
    await supabase.auth.signOut()
  }
  useLocalStorage()
  state.session = null
  await reloadStore()
  await persistSession()
}

/** 改资料。 */
export async function updateProfile(patch) {
  if (!state.session) return false

  if (supabaseConfigured && isCloudActive()) {
    // ⚠️ 只允许改这三项。role / disabled 不能从这里走 ——
    //    RLS 的 with check 会把它们钉死，改也改不动，不如不写。
    const row = {}
    if (patch.nickname !== undefined) row.nickname = String(patch.nickname)
    if (patch.avatar !== undefined) row.avatar = String(patch.avatar)
    const { error } = await supabase.from('profiles').update(row).eq('id', state.session.id)
    if (error) {
      console.warn('[auth] 改资料失败：', error.message)
      return false
    }
    state.session = { ...state.session, ...row }
    const idx = state.users.findIndex((u) => u.id === state.session.id)
    if (idx >= 0) state.users[idx] = { ...state.users[idx], ...row }
    return true
  }

  const idx = state.users.findIndex((u) => u.id === state.session.id)
  if (idx < 0) return false
  state.users[idx] = { ...state.users[idx], ...patch }
  state.session = publicUser(state.users[idx])
  await persistUsers()
  await persistSession()
  return true
}

/* ---------------------------------------------------------------- 管理端 */

/** 校验管理口令（只是个二次确认，不是权限判断）。 */
export function checkAdminPassword(pwd) {
  return String(pwd) === ADMIN_PASSWORD
}

/**
 * 管理员新建用户。
 *
 * ⚠️ 云端模式下**前端做不到** —— 创建 auth 用户要 service_role key，
 *    那个 key 绝对不能进浏览器（它能绕过所有 RLS）。
 *    这里返回 null 让调用方报错，并说明正确的做法。
 */
export async function adminCreateUser({ email, password, nickname, isAdmin: admin = false }) {
  if (supabaseConfigured && isCloudActive()) {
    console.warn(
      '[auth] 云端模式下不能从前端新建用户：创建 auth 账号需要 service_role key。\n' +
        '请让对方自行注册，或到 Supabase Dashboard → Authentication → Users 里加。',
    )
    return null
  }
  const mail = String(email || '').trim().toLowerCase()
  if (!mail || state.users.some((u) => u.email.toLowerCase() === mail)) return null
  const user = {
    id: uid('u'),
    email: mail,
    password: String(password || '123456'),
    nickname: String(nickname || '').trim() || mail.split('@')[0],
    avatar: '',
    isAdmin: !!admin,
    disabled: false,
    note: '',
    createdAt: new Date().toISOString().slice(0, 10),
  }
  state.users.push(user)
  await persistUsers()
  return publicUser(user)
}

/** 管理员改用户（角色 / 禁用 / 备注 / 昵称）。 */
export async function adminUpdateUser(id, patch) {
  const idx = state.users.findIndex((u) => u.id === id)
  if (idx < 0) return false
  state.users[idx] = { ...state.users[idx], ...patch }
  const ok = await persistUsers()
  if (state.session?.id === id) {
    state.session = { ...state.session, ...patch }
    await persistSession()
  }
  return ok
}

/**
 * 管理员删用户。
 *
 * 云端模式下**只能禁用**（软删除）：删 auth 账号同样需要 service_role。
 * 直接删 profiles 那行会留下孤儿数据 —— 用户的书签还在库里，
 * 但谁也看不见、也清不掉。所以宁可禁用。
 */
export async function adminDeleteUser(id) {
  if (supabaseConfigured && isCloudActive()) {
    return adminUpdateUser(id, { disabled: true })
  }
  state.users = state.users.filter((u) => u.id !== id)
  if (state.session?.id === id) {
    state.session = null
    await persistSession()
  }
  await persistUsers()
  return true
}

/* ---------------------------------------------------------------- 启动 */

/**
 * 应用启动时调一次：恢复已有会话 + 订阅登录态变化。
 *
 * 为什么不只靠 `getSession()`：access token 会过期，
 * 自动续期和跨标签页的登录/退出都通过 `onAuthStateChange` 通知。
 */
export async function initAuth() {
  if (!supabaseConfigured) return

  const { data } = await supabase.auth.getSession()
  if (data?.session?.user) {
    useCloudStorage()
    const profile = await loadCloudProfile(data.session.user.id)
    if (profile && !profile.disabled) {
      state.session = profile
      // ⚠️ 迁移必须在第一次 reloadStore 之前 —— 见 migrateLocalToCloud 的注释
      await migrateLocalToCloud()
      await reloadStore()
      state.session = profile
    } else if (profile?.disabled) {
      await supabase.auth.signOut()
    }
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    // 只处理「会话没了」的情况。登录/退出都由上面的显式调用负责，
    // 在这里再处理一遍会和 reloadStore 抢执行顺序。
    if (event === 'SIGNED_OUT' && !session) {
      useLocalStorage()
      state.session = null
      await reloadStore()
    }
  })
}

export { publicUser }
