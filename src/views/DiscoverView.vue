<script setup>
/**
 * 发现页。
 * 顶部是分类筛选 + 搜索 + 排序切换，下面是网站卡片墙。
 * 每张卡可以收藏、看详情、直接访问；右上角能提交新网站。
 */
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkIcon from '@/components/BookmarkIcon.vue'
import Modal from '@/components/Modal.vue'
import { createSite, incrementSiteViews, state, toggleFavorite } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
import { faviconOf, hostOf, isValidUrl, normalizeUrl } from '@/utils/helpers'

const { t } = useI18n()

/* ---------------------------------------------------------------- 状态 */

const activeCat = ref('')
const keyword = ref('')
const sortBy = ref('recent') // recent | views | collects | mine

const detail = ref(null)
const submitOpen = ref(false)
const submitting = ref(false)
const form = ref({ title: '', url: '', description: '', category: '', subcategory: '', icon: '' })
const formError = ref('')

const CATEGORIES = [
  { id: '', name: '全部', icon: 'Layers' },
  { id: 'AI', name: 'AI', icon: 'Sparkles' },
  { id: '开发', name: '开发', icon: 'Code2' },
  { id: '设计', name: '设计', icon: 'Palette' },
  { id: '办公', name: '办公', icon: 'Briefcase' },
  { id: '学习', name: '学习', icon: 'GraduationCap' },
  { id: '工具', name: '工具', icon: 'Wrench' },
  { id: '软件', name: '软件', icon: 'Cpu' },
  { id: '视频', name: '视频', icon: 'Video' },
  { id: '音乐', name: '音乐', icon: 'Music' },
  { id: '新闻', name: '新闻', icon: 'Newspaper' },
  { id: '生活', name: '生活', icon: 'ShoppingBag' },
  { id: '网盘', name: '网盘', icon: 'Cloud' },
]

/* ---------------------------------------------------------------- 派生 */

const catCounts = computed(() => {
  const m = {}
  for (const s of state.sites) m[s.category] = (m[s.category] || 0) + 1
  return m
})

const subcategories = computed(() => {
  const set = new Set()
  for (const s of state.sites) {
    if (s.subcategory && (!form.value.category || s.category === form.value.category)) {
      set.add(s.subcategory)
    }
  }
  return [...set]
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  let list = state.sites.filter((s) => s.status !== 'pending' && s.status !== 'rejected')

  if (sortBy.value === 'mine') {
    list = state.sites.filter((s) => s.submittedBy && s.submittedBy === state.session?.id)
  } else if (activeCat.value) {
    list = list.filter((s) => s.category === activeCat.value)
  }

  if (k) {
    list = list.filter(
      (s) =>
        s.title?.toLowerCase().includes(k) ||
        s.url?.toLowerCase().includes(k) ||
        (s.description || '').toLowerCase().includes(k),
    )
  }

  if (sortBy.value === 'views') list = [...list].sort((a, b) => (b.views || 0) - (a.views || 0))
  else if (sortBy.value === 'collects') list = [...list].sort((a, b) => (b.collects || 0) - (a.collects || 0))
  else list = [...list].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))

  return list
})

const SORTS = [
  { id: 'recent', labelKey: 'discover.recent', icon: 'Clock' },
  { id: 'views', labelKey: 'discover.views', icon: 'TrendingUp' },
  { id: 'collects', labelKey: 'discover.favorite', icon: 'Star' },
  { id: 'mine', labelKey: 'discover.mine', icon: 'User' },
]

/* ---------------------------------------------------------------- 操作 */

function isFav(s) {
  return state.favorites.includes(s.id)
}

async function onFav(s, e) {
  e?.stopPropagation()
  const added = await toggleFavorite(s.id)
  if (added == null) {
    toast(t('toast.favFail'), 'error')
    return
  }
  toast(added ? t('toast.favOk') : t('toast.favRemoved'))
}

function openDetail(s) {
  detail.value = s
  incrementSiteViews(s.id)
}

function visit(s) {
  incrementSiteViews(s.id)
  window.open(s.url, '_blank', 'noopener,noreferrer')
}

function openSubmit() {
  form.value = { title: '', url: '', description: '', category: '', subcategory: '', icon: '' }
  formError.value = ''
  submitOpen.value = true
}

async function doSubmit() {
  if (!form.value.title.trim() || !isValidUrl(form.value.url)) {
    formError.value = t('bookmark.needFields')
    return
  }
  if (!form.value.category) {
    formError.value = t('discover.category')
    return
  }
  if (subcategories.value.length && !form.value.subcategory) {
    formError.value = t('discover.needSub')
    return
  }
  submitting.value = true
  try {
    const ok = await createSite({ ...form.value, url: normalizeUrl(form.value.url) }, 'pending')
    if (ok) {
      toast(t('discover.submitOk'))
      submitOpen.value = false
    } else {
      toast(t('toast.submitFail'), 'error')
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="discover">
    <!-- 头部 -->
    <header class="dc-head">
      <div class="dc-title">
        <h1>{{ t('discover.title') }}</h1>
        <p>{{ t('discover.subtitle') }}</p>
      </div>
      <button class="btn-primary" @click="openSubmit">
        <AppIcon name="Plus" :size="15" />{{ t('discover.submit') }}
      </button>
    </header>

    <!-- 分类 -->
    <div class="cat-bar">
      <button
        v-for="c in CATEGORIES"
        :key="c.id"
        class="cat-chip"
        :class="{ active: activeCat === c.id && sortBy !== 'mine' }"
        @click="activeCat = c.id; sortBy = sortBy === 'mine' ? 'recent' : sortBy"
      >
        <AppIcon :name="c.icon" :size="14" />
        <span>{{ c.name }}</span>
        <em v-if="c.id && catCounts[c.id]">{{ catCounts[c.id] }}</em>
      </button>
    </div>

    <!-- 工具条 -->
    <div class="dc-tools">
      <div class="search glass">
        <AppIcon name="Search" :size="16" />
        <input v-model="keyword" :placeholder="t('search.short')" />
      </div>
      <div class="seg">
        <button
          v-for="s in SORTS"
          :key="s.id"
          class="seg-item"
          :class="{ active: sortBy === s.id }"
          @click="sortBy = s.id"
        >
          <AppIcon :name="s.icon" :size="14" />{{ t(s.labelKey) }}
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="filtered.length" class="site-grid">
      <article
        v-for="s in filtered"
        :key="s.id"
        class="site-card glass"
        @click="openDetail(s)"
      >
        <div class="sc-top">
          <BookmarkIcon :src="faviconOf(s.url, s.icon)" :name="s.title" :hash-key="s.url" :size="38" :radius="9" />
          <button class="fav-btn" :class="{ on: isFav(s) }" @click="onFav(s, $event)">
            <AppIcon name="Star" :size="15" />
          </button>
        </div>
        <h3 class="sc-title">{{ s.title }}</h3>
        <p class="sc-desc">{{ s.description || hostOf(s.url) }}</p>
        <div class="sc-foot">
          <span class="sc-tag">{{ s.category }}<template v-if="s.subcategory"> · {{ s.subcategory }}</template></span>
          <span class="sc-views"><AppIcon name="Eye" :size="12" />{{ s.views || 0 }}</span>
        </div>
        <button class="sc-go" @click.stop="visit(s)">
          {{ t('discover.visit') }}<AppIcon name="ExternalLink" :size="12" />
        </button>
      </article>
    </div>

    <div v-else class="dc-empty glass">
      <AppIcon name="Compass" :size="32" />
      <strong>{{ t('discover.noResult') }}</strong>
    </div>

    <!-- 详情 -->
    <Modal :model-value="!!detail" size="md" @update:model-value="detail = null">
      <div v-if="detail" class="detail">
        <div class="dt-head">
          <BookmarkIcon :src="faviconOf(detail.url, detail.icon)" :name="detail.title" :hash-key="detail.url" :size="52" :radius="13" />
          <div class="dt-meta">
            <h2>{{ detail.title }}</h2>
            <a :href="detail.url" target="_blank" rel="noopener noreferrer">{{ detail.url }}</a>
          </div>
        </div>
        <p class="dt-desc">{{ detail.description || '—' }}</p>
        <div class="dt-stats">
          <div class="stat">
            <strong>{{ detail.views || 0 }}</strong>
            <span>{{ t('discover.views') }}</span>
          </div>
          <div class="stat">
            <strong>{{ detail.collects || 0 }}</strong>
            <span>{{ t('discover.favorite') }}</span>
          </div>
          <div class="stat">
            <strong>{{ detail.createdAt || '—' }}</strong>
            <span>{{ t('discover.submittedAt') }}</span>
          </div>
        </div>
        <div class="dt-tags">
          <span class="tag">{{ detail.category }}</span>
          <span v-if="detail.subcategory" class="tag">{{ detail.subcategory }}</span>
        </div>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="onFav(detail); detail = null">
          <AppIcon name="Star" :size="15" />{{ isFav(detail) ? t('discover.favorited') : t('discover.favorite') }}
        </button>
        <button class="btn-primary" @click="visit(detail); detail = null">
          <AppIcon name="ExternalLink" :size="15" />{{ t('discover.visit') }}
        </button>
      </template>
    </Modal>

    <!-- 提交 -->
    <Modal v-model="submitOpen" :title="t('discover.submitTitle')" size="md">
      <div class="submit-form">
        <label class="fld">
          <span>{{ t('bookmark.name') }} <em>*</em></span>
          <input v-model="form.title" class="field" :placeholder="t('bookmark.namePlaceholder')" />
        </label>
        <label class="fld">
          <span>{{ t('bookmark.url') }} <em>*</em></span>
          <input v-model="form.url" class="field" placeholder="https://" />
        </label>
        <label class="fld">
          <span>{{ t('bookmark.desc') }}</span>
          <textarea v-model="form.description" class="field" rows="2" :placeholder="t('bookmark.descPlaceholder')" />
        </label>
        <div class="two-col">
          <label class="fld">
            <span>{{ t('discover.category') }} <em>*</em></span>
            <select v-model="form.category" class="field">
              <option value="">—</option>
              <option v-for="c in CATEGORIES.filter((x) => x.id)" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </label>
          <label class="fld">
            <span>{{ t('discover.subcategory') }}</span>
            <select v-model="form.subcategory" class="field">
              <option value="">—</option>
              <option v-for="s in subcategories" :key="s" :value="s">{{ s }}</option>
            </select>
          </label>
        </div>
        <p v-if="formError" class="err">{{ formError }}</p>
      </div>
      <template #footer>
        <button class="btn-ghost" @click="submitOpen = false">{{ t('common.cancel') }}</button>
        <button class="btn-primary" :disabled="submitting" @click="doSubmit">{{ t('common.confirm') }}</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.discover {
  margin: 0 auto;
  max-width: 1340px;
  padding: 22px 18px;
}

/* —— 头部 —— */
.dc-head {
  align-items: flex-end;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 18px;
}

.dc-title h1 {
  font-size: 24px;
  font-weight: 700;
}

.dc-title p {
  color: var(--muted_text_color);
  font-size: 12.5px;
  margin-top: 5px;
}

/* —— 分类 —— */
.cat-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 14px;
}

.cat-chip {
  align-items: center;
  background-color: var(--item_bg_color);
  border: 1px solid var(--item_border_color);
  border-radius: 999px;
  color: var(--muted_text_color);
  display: flex;
  font-size: 12.5px;
  gap: 6px;
  padding: 7px 13px;
  transition: background-color 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.cat-chip:hover {
  background-color: var(--item_hover_color);
  color: var(--main_text_color);
}

.cat-chip.active {
  background-color: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent-text);
  font-weight: 500;
}

.cat-chip em {
  font-size: 10.5px;
  font-style: normal;
  opacity: 0.7;
}

/* —— 工具条 —— */
.dc-tools {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  margin-bottom: 16px;
}

.search {
  align-items: center;
  border-radius: var(--radius);
  display: flex;
  flex: 1;
  gap: 9px;
  max-width: 320px;
  padding: 8px 13px;
}

.search :deep(svg) {
  color: var(--muted_text_color);
  flex-shrink: 0;
}

.search input {
  background: none;
  border: none;
  flex: 1;
  font-size: 13.5px;
  min-width: 0;
}

.seg {
  background-color: var(--text_bg_color);
  border-radius: var(--radius);
  display: inline-flex;
  gap: 3px;
  padding: 3px;
}

.seg-item {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--muted_text_color);
  display: flex;
  font-size: 12.5px;
  gap: 5px;
  padding: 7px 12px;
  transition: background-color 0.18s ease, color 0.18s ease;
}

.seg-item:hover {
  color: var(--main_text_color);
}

.seg-item.active {
  background-color: var(--item_hover_color);
  box-shadow: 0 2px 6px var(--shadow-color);
  color: var(--accent-text);
  font-weight: 500;
}

/* —— 卡片墙 —— */
.site-grid {
  display: grid;
  gap: 13px;
  grid-template-columns: repeat(auto-fill, minmax(228px, 1fr));
}

.site-card {
  border-radius: var(--radius-lg);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 15px;
  position: relative;
  transition: transform 0.3s ease, box-shadow 0.3s ease, background-color 0.2s ease;
}

.site-card:hover {
  background-color: var(--item_hover_color);
  box-shadow: 0 10px 24px -6px var(--shadow-color);
  transform: translateY(-3px);
}

.sc-top {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
}

.fav-btn {
  align-items: center;
  border-radius: 6px;
  color: var(--muted_text_color);
  display: flex;
  height: 26px;
  justify-content: center;
  transition: color 0.18s ease, background-color 0.18s ease;
  width: 26px;
}

.fav-btn:hover {
  background-color: var(--item_hover_color);
}

.fav-btn.on {
  color: var(--warning);
}

.fav-btn.on :deep(svg) {
  fill: currentColor;
}

.sc-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-desc {
  color: var(--muted_text_color);
  display: -webkit-box;
  font-size: 11.5px;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  line-height: 1.55;
  min-height: 36px;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.sc-foot {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.sc-tag {
  color: var(--muted_text_color);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sc-views {
  align-items: center;
  color: var(--muted_text_color);
  display: flex;
  flex-shrink: 0;
  font-size: 11px;
  gap: 4px;
}

.sc-go {
  align-items: center;
  border-top: 1px solid var(--border_color);
  color: var(--accent-text);
  display: flex;
  font-size: 12px;
  gap: 5px;
  justify-content: center;
  margin-top: 3px;
  padding-top: 9px;
  transition: gap 0.2s ease;
}

.sc-go:hover {
  gap: 9px;
}

/* —— 空态 —— */
.dc-empty {
  align-items: center;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 64px 20px;
}

.dc-empty :deep(svg) {
  color: var(--muted_text_color);
  opacity: 0.55;
}

.dc-empty strong {
  color: var(--muted_text_color);
  font-size: 13.5px;
  font-weight: 500;
}

/* —— 详情 —— */
.detail {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.dt-head {
  align-items: center;
  display: flex;
  gap: 14px;
}

.dt-meta h2 {
  font-size: 17px;
  font-weight: 600;
}

.dt-meta a {
  color: var(--accent-text);
  display: block;
  font-size: 12px;
  margin-top: 4px;
  word-break: break-all;
}

.dt-desc {
  color: var(--muted_text_color);
  font-size: 13px;
  line-height: 1.7;
}

.dt-stats {
  background-color: var(--text_bg_color);
  border-radius: var(--radius);
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, 1fr);
  padding: 14px;
  text-align: center;
}

.stat strong {
  display: block;
  font-size: 15px;
  font-weight: 600;
}

.stat span {
  color: var(--muted_text_color);
  display: block;
  font-size: 11px;
  margin-top: 3px;
}

.dt-tags {
  display: flex;
  gap: 7px;
}

/* —— 提交表单 —— */
.submit-form {
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
  color: var(--danger);
  font-style: normal;
}

.two-col {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr 1fr;
}

textarea.field {
  font-family: inherit;
  resize: vertical;
}

select.field {
  cursor: pointer;
}

.err {
  color: var(--danger);
  font-size: 12px;
}

@media (max-width: 640px) {
  .dc-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .search {
    max-width: none;
  }

  .site-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }

  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
