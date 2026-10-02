<script setup>
/**
 * 登录 / 注册 / 个人资料。
 * 未登录时显示登录注册表单；已登录时显示资料编辑（头像、昵称）与账号信息。
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { ADMIN_PASSWORD, isLoggedIn, login, logout, register, updateProfile } from '@/composables/useAuth'
import { state } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { uploadImage } from '@/data/iconStorage'
import { safeRedirect } from '@/utils/helpers'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const mode = ref('login') // login | register
const form = ref({ email: '', password: '', nickname: '' })
const error = ref('')
const busy = ref(false)
const fileInput = ref(null)

const user = computed(() => state.session)

/**
 * 后端错误码 → i18n key。
 *
 * ⚠️ 这几条**只在输错的时候**才出现，所以 `i18n-render`（扫正常渲染的页面）
 *    永远碰不到它们 —— 2026-10-02 之前它们就是硬编码中文，
 *    表现是英文界面下报中文错。补的第三道守卫是 `scan-hardcoded-text.mjs`。
 */
const ERROR_KEYS = {
  invalid_email: 'auth.errInvalidEmail',
  weak_password: 'auth.errWeakPassword',
  email_taken: 'auth.errEmailTaken',
  bad_credentials: 'auth.errBadCredentials',
  disabled: 'auth.errDisabled',
}

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const res =
      mode.value === 'login'
        ? await login({ email: form.value.email, password: form.value.password })
        : await register(form.value)
    if (res.ok) {
      toast(mode.value === 'login' ? t('auth.login') : t('auth.register'))
      /**
       * 登录后跳回**来处**。
       *
       * 路由守卫拦下未登录的人时，会带上 `?redirect=<原路径>`（见 `@/router`），
       * 比如直接打开 `/admin` 会被送到 `/login?redirect=/admin`。
       * 不认这个参数的话，登录完落回首页，用户还得自己再点一次。
       *
       * ⚠️ 必须过 `safeRedirect()` —— 只收站内路径，
       *    `?redirect=//evil.com` 是**开放重定向**。
       */
      router.push(safeRedirect(route.query.redirect) || '/')
    } else {
      error.value = ERROR_KEYS[res.error] ? t(ERROR_KEYS[res.error]) : t('auth.errGeneric')
    }
  } finally {
    busy.value = false
  }
}

async function onLogout() {
  await logout()
  toast(t('auth.logout'))
  router.push('/')
}

function pickAvatar() {
  fileInput.value?.click()
}

async function onAvatar(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!/^image\//.test(file.type)) {
    toast(t('auth.needImage'), 'error')
    return
  }
  if (file.size > 2 * 1024 * 1024) {
    toast(t('auth.imageTooBig'), 'error')
    return
  }
  /*
   * 已登录才可能走到这里（本页就是登录页的已登录态），所以正常路径一定是
   * 传到 Storage 拿公开 URL。传失败就报错 —— 不回落 base64，理由见
   * `data/iconStorage.js` 顶部：悄悄存成 base64 等于把要修的问题又做一遍。
   */
  try {
    const { url } = await uploadImage(file, 'avatar')
    await updateProfile({ avatar: url })
    toast(t('auth.avatarUpdated'))
  } catch (err) {
    console.warn('[avatar] 上传失败，未写入：', err)
    toast(t('toast.uploadFail'), 'error')
  }
}

const nickname = ref('')
async function saveNickname() {
  if (!nickname.value.trim()) return
  await updateProfile({ nickname: nickname.value.trim() })
  toast(t('auth.nicknameUpdated'))
}

function fillAdmin() {
  form.value = { email: 'admin@jerry.tools', password: 'admin123', nickname: '' }
  mode.value = 'login'
}
</script>

<template>
  <div class="login-page">
    <!-- 已登录：资料 -->
    <div v-if="isLoggedIn" class="card glass">
      <div class="avatar-big" @click="pickAvatar">
        <img v-if="user.avatar" :src="user.avatar" alt="" />
        <span v-else>{{ (user.nickname || 'J')[0].toUpperCase() }}</span>
        <div class="avatar-mask"><AppIcon name="Image" :size="20" /></div>
      </div>
      <h2>{{ user.nickname }}</h2>
      <p class="mail">{{ user.email }}</p>
      <span v-if="user.isAdmin" class="tag">管理员</span>

      <div class="profile-form">
        <label class="fld">
          <span>{{ t('auth.nickname') }}</span>
          <div class="inline">
            <input v-model="nickname" class="field" :placeholder="user.nickname" />
            <button class="btn-primary" @click="saveNickname">{{ t('common.save') }}</button>
          </div>
        </label>
        <div class="meta-row">
          <span>{{ t('discover.submittedAt') }}</span>
          <strong>{{ user.createdAt }}</strong>
        </div>
      </div>

      <div class="actions">
        <button v-if="user.isAdmin" class="btn-ghost" @click="router.push('/admin')">
          <AppIcon name="Shield" :size="15" />{{ t('nav.admin') }}
        </button>
        <button class="btn-ghost danger" @click="onLogout">
          <AppIcon name="LogOut" :size="15" />{{ t('auth.logout') }}
        </button>
      </div>
    </div>

    <!-- 未登录：登录 / 注册 -->
    <div v-else class="card glass">
      <div class="logo"><AppIcon name="Sparkle" :size="22" /></div>
      <h2>{{ mode === 'login' ? t('auth.loginTitle') : t('auth.registerTitle') }}</h2>

      <div class="seg">
        <button class="seg-item" :class="{ active: mode === 'login' }" @click="mode = 'login'">
          {{ t('auth.login') }}
        </button>
        <button class="seg-item" :class="{ active: mode === 'register' }" @click="mode = 'register'">
          {{ t('auth.register') }}
        </button>
      </div>

      <div class="form">
        <label v-if="mode === 'register'" class="fld">
          <span>{{ t('auth.nickname') }}</span>
          <input v-model="form.nickname" class="field" :placeholder="t('auth.nickname')" />
        </label>
        <label class="fld">
          <span>{{ t('auth.email') }}</span>
          <input v-model="form.email" class="field" type="email" placeholder="you@example.com" @keydown.enter="submit" />
        </label>
        <label class="fld">
          <span>{{ t('auth.password') }} <em>{{ t('auth.passwordHint') }}</em></span>
          <input v-model="form.password" class="field" type="password" placeholder="••••••" @keydown.enter="submit" />
        </label>

        <p v-if="error" class="err"><AppIcon name="AlertCircle" :size="13" />{{ error }}</p>

        <button class="btn-primary wide" :disabled="busy" @click="submit">
          {{ mode === 'login' ? t('auth.login') : t('auth.register') }}
        </button>
      </div>

      <button class="hint-btn" @click="fillAdmin">
        演示账号：admin@jerry.tools / admin123（管理后台口令 {{ ADMIN_PASSWORD }}）
      </button>
    </div>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="onAvatar" />
  </div>
</template>

<style scoped>
.login-page {
  align-items: flex-start;
  display: flex;
  justify-content: center;
  padding: 54px 18px;
}

.card {
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  padding: 32px 28px;
  width: 100%;
  max-width: 396px;
}

.card h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 18px;
  text-align: center;
}

.logo {
  align-items: center;
  background: var(--accent);
  border-radius: 12px;
  color: var(--on-accent);
  display: flex;
  height: 46px;
  justify-content: center;
  margin: 0 auto 14px;
  width: 46px;
}

/* —— 分段 —— */
.seg {
  background-color: var(--text_bg_color);
  border-radius: var(--radius);
  display: flex;
  gap: 3px;
  margin-bottom: 18px;
  padding: 3px;
}

.seg-item {
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  flex: 1;
  font-size: 13px;
  padding: 8px;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.seg-item.active {
  background-color: var(--item_hover_color);
  box-shadow: 0 2px 6px var(--shadow-color);
  color: var(--accent-text);
  font-weight: 500;
}

/* —— 表单 —— */
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fld {
  display: block;
}

.fld > span {
  color: var(--muted_text_color);
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}

.fld em {
  font-size: 11px;
  font-style: normal;
  opacity: 0.7;
}

.err {
  align-items: center;
  color: var(--danger);
  display: flex;
  font-size: 12px;
  gap: 5px;
}

.btn-primary.wide {
  justify-content: center;
  margin-top: 4px;
  padding: 11px;
  width: 100%;
}

.hint-btn {
  color: var(--muted_text_color);
  font-size: 11px;
  margin-top: 16px;
  text-align: center;
  transition: color 0.2s ease;
}

.hint-btn:hover {
  color: var(--accent-text);
}

/* —— 资料 —— */
.avatar-big {
  border-radius: 50%;
  cursor: pointer;
  height: 82px;
  margin: 0 auto 14px;
  overflow: hidden;
  position: relative;
  width: 82px;
}

.avatar-big span,
.avatar-big img {
  align-items: center;
  background: var(--accent);
  color: var(--on-accent);
  display: flex;
  font-size: 30px;
  font-weight: 600;
  height: 100%;
  justify-content: center;
  object-fit: cover;
  width: 100%;
}

.avatar-mask {
  align-items: center;
  background-color: rgba(0, 0, 0, 0.5);
  color: #fff;
  display: flex;
  inset: 0;
  justify-content: center;
  opacity: 0;
  position: absolute;
  transition: opacity 0.2s ease;
}

.avatar-big:hover .avatar-mask {
  opacity: 1;
}

.mail {
  color: var(--muted_text_color);
  font-size: 12.5px;
  margin-top: 4px;
  text-align: center;
}

.card > .tag {
  align-self: center;
  margin-top: 9px;
}

.profile-form {
  border-top: 1px solid var(--border_color);
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 20px;
  padding-top: 18px;
}

.inline {
  display: flex;
  gap: 8px;
}

.meta-row {
  align-items: center;
  color: var(--muted_text_color);
  display: flex;
  font-size: 12px;
  justify-content: space-between;
}

.meta-row strong {
  color: var(--main_text_color);
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 9px;
  margin-top: 20px;
}

.actions > * {
  flex: 1;
}

.btn-ghost.danger:hover {
  background-color: rgba(229, 72, 77, 0.14);
  border-color: var(--danger);
  color: var(--danger);
}
</style>
