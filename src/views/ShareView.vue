<script setup>
/**
 * 分享页。
 * 访客通过 /s/:slug 访问，只读展示某个人的导航页。
 *
 * 两条路：
 *   配了 Supabase → 调 `get_shared_nav(slug)` 这个 SECURITY DEFINER 函数，
 *                   访客**不需要登录**就能拿到数据。函数只放行
 *                   显式开启了分享的 slug，不会顺带暴露别人的书签。
 *   没配          → 退回纯前端行为：只能读本机 localStorage，
 *                   也就是「分享」只在同一个浏览器里生效（README 已注明）。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkCard from '@/components/BookmarkCard.vue'
import MainSearchBar from '@/components/MainSearchBar.vue'
import { groupedBookmarks, state } from '@/composables/useStore'
import { settings } from '@/composables/useSettings'
import { useI18n } from '@/composables/useI18n'
import { supabase, supabaseConfigured } from '@/data/supabase'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

/** 云端拿到的分享数据（null = 没开启 / slug 不存在）。 */
const shared = ref(null)
const loading = ref(supabaseConfigured)
const loadError = ref('')

/** 按 sortOrder 排序的小工具。 */
const byOrder = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)

/**
 * 把 RPC 返回的扁平数组分组成和主页一致的结构。
 *
 * ⚠️ 子分类必须取 `collect(c.id).self`，不能写成 `collect(c.id)` ——
 *    后者返回的是 `{self, sub}` 对象，`.length` 是 undefined，
 *    所有子分类会被静默滤掉。主页那边踩过同一个坑，见 useStore 的注释。
 */
function groupShared(data) {
  const cats = data?.categories || []
  const bms = data?.bookmarks || []
  const top = cats.filter((c) => !c.parentId).sort(byOrder)

  const collect = (catId) => {
    const self = bms.filter((b) => b.categoryId === catId).sort(byOrder)
    const sub = cats
      .filter((c) => c.parentId === catId)
      .sort(byOrder)
      .map((c) => ({ category: c, bookmarks: bms.filter((b) => b.categoryId === c.id).sort(byOrder) }))
    return { self, sub }
  }

  return top.map((cat) => {
    const { self, sub } = collect(cat.id)
    return { category: cat, bookmarks: self, subs: sub.filter((s) => s.bookmarks.length) }
  })
}

/** slug 是否可用。云端模式看 RPC 结果，本地模式比对本机分享设置。 */
const matched = computed(() => {
  if (supabaseConfigured) return !!shared.value
  return state.share.enabled && state.share.slug && state.share.slug === route.params.slug
})

/** 主人信息（头像 / 昵称）。 */
const owner = computed(() => {
  if (supabaseConfigured) {
    return { displayName: shared.value?.displayName || '', avatar: shared.value?.avatar || '' }
  }
  return { displayName: state.share.displayName, avatar: state.share.avatar }
})

const totalCount = computed(() => {
  if (supabaseConfigured) return (shared.value?.bookmarks || []).length
  return state.bookmarks.length
})

const groups = computed(() => {
  if (supabaseConfigured) return groupShared(shared.value).filter((g) => g.bookmarks.length || g.subs.length)
  return groupedBookmarks.value.filter((g) => g.bookmarks.length || g.subs.length)
})

const gridStyle = computed(() => ({ '--cols': settings.perRow }))

function openBookmark(b) {
  window.open(b.url, '_blank', 'noopener,noreferrer')
}

async function loadShared(slug) {
  if (!supabaseConfigured) return
  loading.value = true
  loadError.value = ''
  shared.value = null
  try {
    const { data, error } = await supabase.rpc('get_shared_nav', { p_slug: slug })
    if (error) throw error
    // 没开启分享 / slug 不存在时函数返回 null —— 这是正常结果，不是错误
    shared.value = data || null
  } catch (e) {
    loadError.value = e?.message || String(e)
    console.warn('[share] 读取分享数据失败：', loadError.value)
  } finally {
    loading.value = false
  }
}

// 同一路由内换 slug 也要重新拉
watch(() => route.params.slug, (s) => { if (s) loadShared(s) }, { immediate: true })
</script>

<template>
  <div class="share">
    <!-- 读取中 -->
    <div v-if="loading" class="share-empty glass">
      <AppIcon name="Loader" :size="30" class="spin" />
      <strong>{{ t('common.loading') }}</strong>
    </div>

    <!-- 分享不可用 -->
    <div v-else-if="!matched" class="share-empty glass">
      <AppIcon name="Link" :size="34" />
      <strong>{{ t('share.disabled') }}</strong>
      <p v-if="loadError">读取分享数据时出错：{{ loadError }}</p>
      <p v-else-if="supabaseConfigured">
        这个链接对应的分享没有开启，或者后缀不对。请找分享者确认链接。
      </p>
      <p v-else>当前是纯前端实现，分享页只能读到本机数据。开启分享并设置链接后缀后即可预览。</p>
      <div class="ops">
        <button class="btn-primary" @click="router.push('/')">{{ t('common.back') }}</button>
      </div>
    </div>

    <!-- 分享内容 -->
    <template v-else>
      <header class="share-head glass">
        <div class="sh-user">
          <div class="sh-avatar">
            <img v-if="owner.avatar" :src="owner.avatar" alt="" />
            <span v-else>{{ (owner.displayName || 'J')[0].toUpperCase() }}</span>
          </div>
          <div class="sh-text">
            <h1>{{ owner.displayName }}<span>{{ t('share.owner') }}</span></h1>
            <p>{{ t('common.sites', { n: totalCount }) }}</p>
          </div>
        </div>
        <button class="btn-ghost" @click="router.push('/')">
          <AppIcon name="Home" :size="15" />{{ t('nav.home') }}
        </button>
      </header>

      <MainSearchBar @open="openBookmark" />

      <section v-for="group in groups" :key="group.category.id" class="cat-group">
        <header class="group-head">
          <div class="gh-icon"><AppIcon :name="group.category.icon || 'Folder'" :size="15" /></div>
          <h2>{{ group.category.name }}</h2>
        </header>
        <div class="grid" :style="gridStyle">
          <BookmarkCard
            v-for="b in group.bookmarks"
            :key="b.id"
            :bookmark="b"
            @open="openBookmark"
          />
        </div>
        <div v-for="sub in group.subs" :key="sub.category.id" class="sub-group">
          <h3 class="sub-head">{{ sub.category.name }}</h3>
          <div class="grid" :style="gridStyle">
            <BookmarkCard v-for="b in sub.bookmarks" :key="b.id" :bookmark="b" @open="openBookmark" />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.share {
  margin: 0 auto;
  max-width: 1340px;
  padding: 20px 18px;
}

/* —— 不可用 —— */
.share-empty {
  align-items: center;
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 50px auto;
  max-width: 460px;
  padding: 48px 28px;
  text-align: center;
}

.share-empty :deep(svg) {
  color: var(--muted_text_color);
  opacity: 0.6;
}

.share-empty strong {
  font-size: 15px;
}

.share-empty p {
  color: var(--muted_text_color);
  font-size: 12.5px;
  line-height: 1.7;
}

.ops {
  margin-top: 8px;
}

/* 加载态的图标转起来 —— 静止的 Loader 图标看着像坏了 */
.share-empty .spin {
  animation: share-spin 1.1s linear infinite;
}

@keyframes share-spin {
  to {
    transform: rotate(360deg);
  }
}

/* —— 头部 —— */
.share-head {
  align-items: center;
  border-radius: var(--radius-lg);
  display: flex;
  gap: 14px;
  justify-content: space-between;
  margin-bottom: 16px;
  padding: 16px 20px;
}

.sh-user {
  align-items: center;
  display: flex;
  gap: 13px;
}

.sh-avatar {
  align-items: center;
  background: var(--accent);
  border-radius: 50%;
  color: var(--on-accent);
  display: flex;
  flex-shrink: 0;
  font-size: 20px;
  font-weight: 600;
  height: 48px;
  justify-content: center;
  overflow: hidden;
  width: 48px;
}

.sh-avatar img {
  height: 100%;
  object-fit: cover;
  width: 100%;
}

.sh-text h1 {
  font-size: 17px;
  font-weight: 600;
}

.sh-text h1 span {
  color: var(--muted_text_color);
  font-size: 13px;
  font-weight: 400;
}

.sh-text p {
  color: var(--muted_text_color);
  font-size: 11.5px;
  margin-top: 3px;
}

/* —— 分组 —— */
.cat-group {
  margin-top: 26px;
}

.group-head {
  align-items: center;
  display: flex;
  gap: 9px;
  margin-bottom: 12px;
}

.gh-icon {
  align-items: center;
  background-color: var(--accent-soft);
  border-radius: 7px;
  color: var(--accent-text);
  display: flex;
  height: 26px;
  justify-content: center;
  width: 26px;
}

.group-head h2 {
  font-size: 14.5px;
  font-weight: 600;
}

.grid {
  display: grid;
  gap: 11px;
  grid-template-columns: repeat(var(--cols, 5), minmax(0, 1fr));
}

.sub-group {
  margin-top: 16px;
}

.sub-head {
  color: var(--muted_text_color);
  font-size: 12.5px;
  font-weight: 500;
  margin-bottom: 9px;
}

@media (max-width: 1000px) {
  .grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .share-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
