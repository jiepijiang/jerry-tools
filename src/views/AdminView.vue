<script setup>
/**
 * 管理后台。
 * 入口有一道本地口令（默认 jerry，见 useAuth 的 ADMIN_PASSWORD），
 * 过闸后分五个分区：统计 / 网站审核 / 用户管理 / 图标管理 / 反馈。
 */
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import Modal from '@/components/Modal.vue'
import {
  adminCreateUser,
  adminDeleteUser,
  adminUpdateUser,
  checkAdminPassword,
  publicUser,
} from '@/composables/useAuth'
import {
  deleteSite,
  state,
  updateSite,
} from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { useRouter } from 'vue-router'
import { toast } from '@/composables/useToast'
import { faviconOf, hostOf } from '@/utils/helpers'

const { t } = useI18n()

const TABS = [
  { id: 'stats', labelKey: 'admin.stats', icon: 'BarChart3' },
  { id: 'sites', labelKey: 'admin.sites', icon: 'Compass' },
  { id: 'users', labelKey: 'admin.users', icon: 'Users' },
  { id: 'icons', labelKey: 'admin.icons', icon: 'Image' },
  { id: 'feedback', labelKey: 'admin.feedback', icon: 'MessageSquare' },
]

const unlocked = ref(false)
const password = ref('')
const pwError = ref('')
const tab = ref('stats')
const router = useRouter()

const siteQuery = ref('')
const iconQuery = ref('')

const userDialog = ref({ open: false, user: null })
const userForm = ref({ email: '', password: '', nickname: '', isAdmin: false })
const noteDialog = ref({ open: false, user: null, note: '' })

const replyDialog = ref({ open: false, item: null, text: '' })

/* ---------------------------------------------------------------- 派生 */

const stats = computed(() => ({
  sites: state.sites.length,
  approved: state.sites.filter((s) => s.status !== 'pending' && s.status !== 'rejected').length,
  pending: state.sites.filter((s) => s.status === 'pending').length,
  users: state.users.length,
  bookmarks: state.bookmarks.length,
  categories: state.categories.length,
  favorites: state.favorites.length,
  views: state.sites.reduce((n, s) => n + (s.views || 0), 0),
  collects: state.sites.reduce((n, s) => n + (s.collects || 0), 0),
}))

const pendingSites = computed(() => state.sites.filter((s) => s.status === 'pending'))

const filteredSites = computed(() => {
  const k = siteQuery.value.trim().toLowerCase()
  if (!k) return state.sites
  return state.sites.filter(
    (s) => s.title?.toLowerCase().includes(k) || s.url?.toLowerCase().includes(k),
  )
})

const iconSites = computed(() => {
  const k = iconQuery.value.trim().toLowerCase()
  const list = state.sites.filter((s) => faviconOf(s.url, s.icon))
  if (!k) return list.slice(0, 120)
  return list.filter(
    (s) => s.title?.toLowerCase().includes(k) || s.url?.toLowerCase().includes(k),
  ).slice(0, 120)
})

/** 按 url 找重复项。 */
const duplicates = computed(() => {
  const seen = {}
  const dup = []
  for (const s of state.sites) {
    const k = String(s.url || '').replace(/\/$/, '').toLowerCase()
    if (seen[k]) dup.push(s)
    else seen[k] = s
  }
  return dup
})

const feedbackList = computed(() => state.feedback)

/* ---------------------------------------------------------------- 操作 */

function unlock() {
  if (checkAdminPassword(password.value)) {
    unlocked.value = true
    pwError.value = ''
  } else {
    pwError.value = t('admin.wrongPassword')
  }
}

async function approve(s) {
  await updateSite(s.id, { status: 'approved' })
  toast(t('discover.approved'))
}

async function reject(s) {
  await updateSite(s.id, { status: 'rejected' })
  toast(t('discover.rejected'))
}

async function removeSite(s) {
  await deleteSite(s.id)
  toast(t('toast.deleted'))
}

async function dedupe() {
  if (!duplicates.value.length) {
    toast(t('admin.noDuplicates'), 'warning')
    return
  }
  for (const s of duplicates.value) await deleteSite(s.id)
  toast(t('toast.clearOk'))
}

/* —— 用户 —— */
function openUserDialog(user) {
  userDialog.value = { open: true, user }
  userForm.value = user
    ? { email: user.email, password: '', nickname: user.nickname, isAdmin: !!user.isAdmin }
    : { email: '', password: '', nickname: '', isAdmin: false }
}

async function saveUser() {
  if (userDialog.value.user) {
    await adminUpdateUser(userDialog.value.user.id, {
      nickname: userForm.value.nickname,
      isAdmin: userForm.value.isAdmin,
    })
    toast(t('toast.updated'))
  } else {
    const created = await adminCreateUser(userForm.value)
    if (!created) {
      toast(t('toast.createFail'), 'error')
      return
    }
    toast(t('toast.created'))
  }
  userDialog.value.open = false
}

async function removeUser(u) {
  if (!confirm(t('admin.deleteUser'))) return
  await adminDeleteUser(u.id)
  toast(t('toast.deleted'))
}

async function toggleDisabled(u) {
  await adminUpdateUser(u.id, { disabled: !u.disabled })
  toast(t('toast.updated'))
}

function openNote(u) {
  noteDialog.value = { open: true, user: u, note: u.note || '' }
}

async function saveNote() {
  await adminUpdateUser(noteDialog.value.user.id, { note: noteDialog.value.note })
  noteDialog.value.open = false
  toast(t('toast.saved'))
}

/* —— 图标 —— */
async function restoreIcon(s) {
  await updateSite(s.id, { icon: '' })
  toast(t('admin.iconRestore'))
}

async function setIcon(s, url) {
  await updateSite(s.id, { icon: url })
  toast(t('toast.updated'))
}

/* —— 反馈 —— */
function openReply(item) {
  replyDialog.value = { open: true, item, text: '' }
}

async function sendReply() {
  const { item, text } = replyDialog.value
  if (!text.trim()) return
  item.replies = item.replies || []
  item.replies.push({ content: text.trim(), isAdmin: true, createdAt: new Date().toISOString().slice(0, 10) })
  replyDialog.value.open = false
  toast(t('admin.feedbackSend'))
}
</script>

<template>
  <div class="admin">
    <!-- 口令闸 -->
    <div v-if="!unlocked" class="gate glass">
      <div class="gate-icon"><AppIcon name="Lock" :size="24" /></div>
      <h2>{{ t('admin.title') }}</h2>
      <p>{{ t('admin.needAuth') }}</p>
      <input
        v-model="password"
        class="field"
        type="password"
        placeholder="••••"
        @keydown.enter="unlock"
      />
      <p v-if="pwError" class="err">{{ pwError }}</p>
      <button class="btn-primary wide" @click="unlock">{{ t('common.confirm') }}</button>
    </div>

    <template v-else>
      <header class="ad-head">
        <h1>{{ t('admin.title') }}</h1>
        <div class="tabs">
          <button
            v-for="x in TABS"
            :key="x.id"
            class="tab"
            :class="{ active: tab === x.id }"
            @click="tab = x.id"
          >
            <AppIcon :name="x.icon" :size="14" />{{ t(x.labelKey) }}
            <em v-if="x.id === 'sites' && stats.pending">{{ stats.pending }}</em>
          </button>
        </div>
      </header>

      <!-- ============ 统计 ============ -->
      <section v-if="tab === 'stats'" class="panel">
        <div class="stat-grid">
          <div class="stat-card glass">
            <AppIcon name="Compass" :size="18" />
            <strong>{{ stats.sites }}</strong>
            <span>{{ t('admin.totalSites') }}</span>
          </div>
          <div class="stat-card glass">
            <AppIcon name="Users" :size="18" />
            <strong>{{ stats.users }}</strong>
            <span>{{ t('admin.totalUsers') }}</span>
          </div>
          <div class="stat-card glass">
            <AppIcon name="Bookmark" :size="18" />
            <strong>{{ stats.bookmarks }}</strong>
            <span>{{ t('admin.totalBookmarks') }}</span>
          </div>
          <div class="stat-card glass">
            <AppIcon name="Folder" :size="18" />
            <strong>{{ stats.categories }}</strong>
            <span>{{ t('common.allCategories') }}</span>
          </div>
          <div class="stat-card glass">
            <AppIcon name="Eye" :size="18" />
            <strong>{{ stats.views }}</strong>
            <span>{{ t('discover.views') }}</span>
          </div>
          <div class="stat-card glass">
            <AppIcon name="Star" :size="18" />
            <strong>{{ stats.favorites }}</strong>
            <span>{{ t('discover.favorite') }}</span>
          </div>
          <div class="stat-card glass warn">
            <AppIcon name="Clock" :size="18" />
            <strong>{{ stats.pending }}</strong>
            <span>{{ t('admin.pendingCount') }}</span>
          </div>
          <div class="stat-card glass">
            <AppIcon name="CheckCircle" :size="18" />
            <strong>{{ stats.approved }}</strong>
            <span>{{ t('discover.approved') }}</span>
          </div>
        </div>
      </section>

      <!-- ============ 网站审核 ============ -->
      <section v-else-if="tab === 'sites'" class="panel">
        <div class="panel-bar">
          <div class="mini-search glass">
            <AppIcon name="Search" :size="15" />
            <input v-model="siteQuery" :placeholder="t('admin.iconSearchPlaceholder')" />
          </div>
          <button class="btn-ghost" @click="dedupe">
            <AppIcon name="RotateCcw" :size="15" />
            {{ t('admin.duplicates', { n: duplicates.length }) }}
          </button>
        </div>

        <div v-if="pendingSites.length" class="pending-block">
          <h3><AppIcon name="Clock" :size="15" />{{ t('admin.pendingCount') }} · {{ pendingSites.length }}</h3>
          <div class="row-list">
            <div v-for="s in pendingSites" :key="s.id" class="row glass">
              <BookmarkIcon :src="faviconOf(s.url, s.icon)" :name="s.title" :hash-key="s.url" :size="30" :radius="7" />
              <div class="row-text">
                <strong>{{ s.title }}</strong>
                <span>{{ s.category }}<template v-if="s.subcategory"> · {{ s.subcategory }}</template> · {{ s.url }}</span>
              </div>
              <button class="btn-ghost sm ok" @click="approve(s)"><AppIcon name="Check" :size="14" />{{ t('admin.approve') }}</button>
              <button class="btn-ghost sm no" @click="reject(s)"><AppIcon name="X" :size="14" />{{ t('admin.reject') }}</button>
            </div>
          </div>
        </div>

        <div class="row-list">
          <div v-for="s in filteredSites" :key="s.id" class="row glass">
            <BookmarkIcon :src="faviconOf(s.url, s.icon)" :name="s.title" :hash-key="s.url" :size="30" :radius="7" />
            <div class="row-text">
              <strong>{{ s.title }}</strong>
              <span>{{ hostOf(s.url) }} · {{ s.category }} · {{ s.views || 0 }} {{ t('discover.views') }}</span>
            </div>
            <span class="status" :class="s.status || 'approved'">{{ t('discover.' + (s.status || 'approved')) }}</span>
            <button class="mini" @click="removeSite(s)"><AppIcon name="Trash2" :size="14" /></button>
          </div>
        </div>
      </section>

      <!-- ============ 用户管理 ============ -->
      <section v-else-if="tab === 'users'" class="panel">
        <div class="panel-bar">
          <span class="count-hint">{{ stats.users }} {{ t('admin.totalUsers') }}</span>
          <button class="btn-primary" @click="openUserDialog(null)">
            <AppIcon name="Plus" :size="15" />{{ t('admin.newUser') }}
          </button>
        </div>
        <div class="row-list">
          <div v-for="u in state.users" :key="u.id" class="row glass">
            <div class="user-avatar">
              <img v-if="u.avatar" :src="u.avatar" alt="" />
              <span v-else>{{ (u.nickname || 'U')[0].toUpperCase() }}</span>
            </div>
            <div class="row-text">
              <strong>
                {{ u.nickname }}
                <span v-if="u.isAdmin" class="tag tiny">admin</span>
                <span v-if="u.disabled" class="tag tiny danger">disabled</span>
              </strong>
              <span>{{ u.email }} · {{ u.createdAt }}</span>
            </div>
            <button class="mini" :title="t('admin.setAdmin')" @click="adminUpdateUser(u.id, { isAdmin: !u.isAdmin })">
              <AppIcon name="Shield" :size="14" />
            </button>
            <button class="mini" :title="t('admin.needAuth')" @click="toggleDisabled(u)">
              <AppIcon :name="u.disabled ? 'XCircle' : 'CheckCircle'" :size="14" />
            </button>
            <button class="mini" :title="'备注'" @click="openNote(u)"><AppIcon name="Pencil" :size="14" /></button>
            <button class="mini danger" @click="removeUser(u)"><AppIcon name="Trash2" :size="14" /></button>
          </div>
        </div>
      </section>

      <!-- ============ 图标管理 ============ -->
      <section v-else-if="tab === 'icons'" class="panel">
        <div class="panel-bar">
          <div class="mini-search glass">
            <AppIcon name="Search" :size="15" />
            <input v-model="iconQuery" :placeholder="t('admin.iconSearchPlaceholder')" />
          </div>
          <span class="count-hint">{{ iconSites.length }} / {{ stats.sites }}</span>
          <!-- 参考站把图标管理也做成了独立路由 /icon-management，这里给个入口 -->
          <button class="btn-ghost sm" @click="router.push('/icon-management')">
            <AppIcon name="ArrowRight" :size="14" />{{ t('iconMgmt.title') }}
          </button>
        </div>
        <div class="icon-grid">
          <div v-for="s in iconSites" :key="s.id" class="icon-card glass">
            <BookmarkIcon :src="faviconOf(s.url, s.icon)" :name="s.title" :hash-key="s.url" :size="34" :radius="8" />
            <div class="ic-text">
              <strong>{{ s.title }}</strong>
              <span>{{ hostOf(s.url) }}</span>
            </div>
            <div class="ic-ops">
              <button class="mini" :title="t('admin.iconAuto')" @click="restoreIcon(s)">
                <AppIcon name="RotateCcw" :size="13" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- ============ 反馈 ============ -->
      <section v-else class="panel">
        <div class="row-list">
          <div v-for="f in feedbackList" :key="f.id" class="fb-card glass">
            <div class="fb-head">
              <strong>{{ f.userEmail || t('auth.anonymous') }}</strong>
              <span>{{ f.createdAt }}</span>
            </div>
            <p class="fb-body">{{ f.content }}</p>
            <div v-for="(r, i) in f.replies || []" :key="i" class="fb-reply" :class="{ admin: r.isAdmin }">
              <span class="who">{{ r.isAdmin ? 'admin' : 'user' }}</span>
              <p>{{ r.content }}</p>
            </div>
            <button class="btn-ghost sm" @click="openReply(f)">
              <AppIcon name="MessageSquare" :size="14" />{{ t('admin.feedbackReply') }}
            </button>
          </div>
          <div v-if="!feedbackList.length" class="empty glass">
            <AppIcon name="Inbox" :size="28" />
            <span>{{ t('common.empty') }}</span>
          </div>
        </div>
      </section>
    </template>

    <!-- 用户弹窗 -->
    <Modal v-model="userDialog.open" :title="userDialog.user ? t('common.edit') : t('admin.newUser')" size="sm">
      <div class="dlg-form">
        <label class="fld">
          <span>{{ t('auth.email') }}</span>
          <input v-model="userForm.email" class="field" :disabled="!!userDialog.user" />
        </label>
        <label v-if="!userDialog.user" class="fld">
          <span>{{ t('auth.password') }}</span>
          <input v-model="userForm.password" class="field" type="password" placeholder="••••••" />
        </label>
        <label class="fld">
          <span>{{ t('auth.nickname') }}</span>
          <input v-model="userForm.nickname" class="field" />
        </label>
        <label class="toggle">
          <span>{{ t('admin.setAdmin') }}</span>
          <input v-model="userForm.isAdmin" type="checkbox" />
        </label>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="userDialog.open = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" @click="saveUser">{{ t('common.save') }}</button>
      </template>
    </Modal>

    <!-- 备注弹窗 -->
    <Modal v-model="noteDialog.open" :title="'编辑备注'" size="sm">
      <textarea v-model="noteDialog.note" class="field" rows="3" placeholder="输入备注信息..." />
      <template #footer>
        <button class="btn-ghost" @click="noteDialog.open = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" @click="saveNote">{{ t('common.save') }}</button>
      </template>
    </Modal>

    <!-- 回复弹窗 -->
    <Modal v-model="replyDialog.open" :title="t('admin.feedbackReply')" size="sm">
      <textarea v-model="replyDialog.text" class="field" rows="3" :placeholder="t('admin.feedbackPlaceholder')" />
      <template #footer>
        <button class="btn-ghost" @click="replyDialog.open = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" @click="sendReply">{{ t('admin.feedbackSend') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.admin {
  margin: 0 auto;
  max-width: 1340px;
  padding: 22px 18px;
}

/* —— 口令闸 —— */
.gate {
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 11px;
  margin: 60px auto;
  max-width: 348px;
  padding: 30px 26px;
  text-align: center;
}

.gate-icon {
  align-items: center;
  background: var(--accent);
  border-radius: 12px;
  color: var(--on-accent);
  display: flex;
  height: 48px;
  justify-content: center;
  margin: 0 auto 4px;
  width: 48px;
}

.gate h2 {
  font-size: 17px;
  font-weight: 600;
}

.gate p {
  color: var(--muted_text_color);
  font-size: 12.5px;
}

.gate .err {
  color: var(--danger);
  font-size: 12px;
}

.btn-primary.wide {
  justify-content: center;
  padding: 10px;
  width: 100%;
}

/* —— 头部 —— */
.ad-head {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 20px;
}

.ad-head h1 {
  font-size: 22px;
  font-weight: 700;
}

.tabs {
  background-color: var(--text_bg_color);
  border-radius: var(--radius);
  display: inline-flex;
  gap: 3px;
  padding: 3px;
}

.tab {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  font-size: 12.5px;
  gap: 6px;
  padding: 7px 13px;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.tab:hover {
  color: var(--main_text_color);
}

.tab.active {
  background-color: var(--item_hover_color);
  box-shadow: 0 2px 6px var(--shadow-color);
  color: var(--accent-text);
  font-weight: 500;
}

.tab em {
  background-color: var(--danger);
  border-radius: 999px;
  color: #fff;
  font-size: 10px;
  font-style: normal;
  padding: 1px 6px;
}

/* —— 统计 —— */
.stat-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(158px, 1fr));
}

.stat-card {
  align-items: flex-start;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 16px;
  transition: transform 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
}

.stat-card :deep(svg) {
  color: var(--accent-text);
  margin-bottom: 3px;
}

.stat-card strong {
  font-size: 22px;
  font-weight: 700;
}

.stat-card span {
  color: var(--muted_text_color);
  font-size: 11.5px;
}

.stat-card.warn :deep(svg) {
  color: var(--warning);
}

/* —— 通用面板 —— */
.panel-bar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: space-between;
  margin-bottom: 14px;
}

.mini-search {
  align-items: center;
  border-radius: var(--radius);
  display: flex;
  gap: 8px;
  max-width: 300px;
  padding: 7px 12px;
}

.mini-search :deep(svg) {
  color: var(--muted_text_color);
}

.mini-search input {
  background: none;
  border: none;
  flex: 1;
  font-size: 13px;
  min-width: 0;
}

.count-hint {
  color: var(--muted_text_color);
  font-size: 12px;
}

.row-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  align-items: center;
  border-radius: var(--radius);
  display: flex;
  gap: 11px;
  padding: 11px 13px;
  transition: background-color 0.18s ease;
}

.row:hover {
  background-color: var(--item_hover_color);
}

.row-text {
  flex: 1;
  min-width: 0;
}

.row-text strong {
  align-items: center;
  display: flex;
  font-size: 13px;
  font-weight: 500;
  gap: 6px;
}

.row-text span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11.5px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag.tiny {
  font-size: 10px;
  padding: 1px 7px;
}

.tag.tiny.danger {
  background-color: rgba(229, 72, 77, 0.16);
  color: var(--danger);
}

.status {
  border-radius: 999px;
  flex-shrink: 0;
  font-size: 11px;
  padding: 3px 10px;
}

.status.approved {
  background-color: rgba(48, 163, 108, 0.16);
  color: var(--success);
}

.status.pending {
  background-color: rgba(245, 165, 36, 0.16);
  color: var(--warning);
}

.status.rejected {
  background-color: rgba(229, 72, 77, 0.16);
  color: var(--danger);
}

.btn-ghost.sm {
  font-size: 12px;
  padding: 6px 11px;
}

.btn-ghost.sm.ok:hover {
  border-color: var(--success);
  color: var(--success);
}

.btn-ghost.sm.no:hover {
  border-color: var(--danger);
  color: var(--danger);
}

.mini {
  align-items: center;
  border-radius: 6px;
  color: var(--muted_text_color);
  display: flex;
  flex-shrink: 0;
  height: 28px;
  justify-content: center;
  transition: background-color 0.16s ease, color 0.16s ease;
  width: 28px;
}

.mini:hover {
  background-color: var(--accent-soft);
  color: var(--accent-text);
}

.mini.danger:hover {
  background-color: rgba(229, 72, 77, 0.16);
  color: var(--danger);
}

.pending-block {
  margin-bottom: 20px;
}

.pending-block h3 {
  align-items: center;
  color: var(--warning);
  display: flex;
  font-size: 13px;
  font-weight: 600;
  gap: 6px;
  margin-bottom: 10px;
}

/* —— 用户 —— */
.user-avatar {
  align-items: center;
  background: var(--accent);
  border-radius: 50%;
  color: var(--on-accent);
  display: flex;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
  height: 34px;
  justify-content: center;
  overflow: hidden;
  width: 34px;
}

.user-avatar img {
  height: 100%;
  object-fit: cover;
  width: 100%;
}

/* —— 图标管理 —— */
.icon-grid {
  display: grid;
  gap: 9px;
  grid-template-columns: repeat(auto-fill, minmax(224px, 1fr));
}

.icon-card {
  align-items: center;
  border-radius: var(--radius);
  display: flex;
  gap: 10px;
  padding: 10px 12px;
}

.ic-text {
  flex: 1;
  min-width: 0;
}

.ic-text strong {
  display: block;
  font-size: 12.5px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-text span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ic-ops {
  display: flex;
  opacity: 0;
  transition: opacity 0.18s ease;
}

.icon-card:hover .ic-ops {
  opacity: 1;
}

/* —— 反馈 —— */
.fb-card {
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px;
}

.fb-head {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.fb-head strong {
  font-size: 13px;
  font-weight: 500;
}

.fb-head span {
  color: var(--muted_text_color);
  font-size: 11.5px;
}

.fb-body {
  color: var(--muted_text_color);
  font-size: 13px;
  line-height: 1.65;
}

.fb-reply {
  background-color: var(--text_bg_color);
  border-left: 2px solid var(--border_color);
  border-radius: var(--radius-sm);
  padding: 8px 11px;
}

.fb-reply.admin {
  border-left-color: var(--accent);
}

.fb-reply .who {
  color: var(--accent-text);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
}

.fb-reply p {
  font-size: 12.5px;
  margin-top: 3px;
}

.fb-card > .btn-ghost {
  align-self: flex-start;
}

.empty {
  align-items: center;
  border-radius: var(--radius);
  color: var(--muted_text_color);
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 46px;
}

/* —— 弹窗 —— */
.dlg-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.fld > span {
  color: var(--muted_text_color);
  display: block;
  font-size: 12px;
  margin-bottom: 6px;
}

.toggle {
  align-items: center;
  display: flex;
  font-size: 13px;
  justify-content: space-between;
}

.toggle input[type='checkbox'] {
  accent-color: var(--accent);
  height: 16px;
  width: 16px;
}

textarea.field {
  font-family: inherit;
  resize: vertical;
  width: 100%;
}

@media (max-width: 760px) {
  .ad-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .tabs {
    overflow-x: auto;
    width: 100%;
  }

  .tab {
    flex-shrink: 0;
  }

  .row {
    flex-wrap: wrap;
  }
}
</style>
