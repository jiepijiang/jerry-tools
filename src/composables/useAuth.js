/* =========================================================================
   用户系统（本地模拟）
   -------------------------------------------------------------------------
   没有后端，账号存在 localStorage 里，密码是明文 —— 仅用于演示完整交互，
   不具备任何安全性。接 Supabase Auth 时替换本文件即可。
   ========================================================================= */

import { computed } from 'vue'
import { state, persistSession, persistUsers } from '@/composables/useStore'
import { uid } from '@/utils/helpers'

/** 管理后台口令（本地写死，接后端后应换成角色校验）。 */
export const ADMIN_PASSWORD = 'jerry'

export const currentUser = computed(() => state.session)
export const isLoggedIn = computed(() => !!state.session)
export const isAdmin = computed(() => !!state.session?.isAdmin)

function publicUser(u) {
  if (!u) return null
  const { password, ...rest } = u
  return rest
}

/**
 * 注册。
 * @returns {{ok: boolean, error?: string, user?: object}}
 */
export async function register({ email, password, nickname }) {
  const mail = String(email || '').trim().toLowerCase()
  if (!mail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    return { ok: false, error: 'invalid_email' }
  }
  if (!password || String(password).length < 6) {
    return { ok: false, error: 'weak_password' }
  }
  if (state.users.some((u) => u.email.toLowerCase() === mail)) {
    return { ok: false, error: 'email_taken' }
  }

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

/** 登录。 */
export async function login({ email, password }) {
  const mail = String(email || '').trim().toLowerCase()
  const u = state.users.find((x) => x.email.toLowerCase() === mail)
  if (!u || u.password !== String(password)) {
    return { ok: false, error: 'bad_credentials' }
  }
  if (u.disabled) return { ok: false, error: 'disabled' }
  state.session = publicUser(u)
  await persistSession()
  return { ok: true, user: state.session }
}

/** 退出。 */
export async function logout() {
  state.session = null
  await persistSession()
}

/** 改资料。 */
export async function updateProfile(patch) {
  if (!state.session) return false
  const idx = state.users.findIndex((u) => u.id === state.session.id)
  if (idx < 0) return false
  state.users[idx] = { ...state.users[idx], ...patch }
  state.session = publicUser(state.users[idx])
  await persistUsers()
  await persistSession()
  return true
}

/* ---------------------------------------------------------------- 管理端 */

/** 校验管理口令。 */
export function checkAdminPassword(pwd) {
  return String(pwd) === ADMIN_PASSWORD
}

/** 管理员新建用户。 */
export async function adminCreateUser({ email, password, nickname, isAdmin: admin = false }) {
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

/** 管理员改用户。 */
export async function adminUpdateUser(id, patch) {
  const idx = state.users.findIndex((u) => u.id === id)
  if (idx < 0) return false
  state.users[idx] = { ...state.users[idx], ...patch }
  await persistUsers()
  return true
}

/** 管理员删用户。 */
export async function adminDeleteUser(id) {
  state.users = state.users.filter((u) => u.id !== id)
  if (state.session?.id === id) {
    state.session = null
    await persistSession()
  }
  await persistUsers()
  return true
}

export { publicUser }
