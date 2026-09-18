<script setup>
/**
 * 分享页。
 * 访客通过 /s/:slug 访问，只读展示某个人的导航页。
 *
 * 当前是纯前端实现：只能读到本机 localStorage 里的那份数据，
 * 所以「分享」实际上只在同一浏览器里生效 —— 这是没有后端时的固有限制，
 * README 里已注明。接上 Supabase 后换成按 slug 拉取即可。
 */
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BookmarkCard from '@/components/BookmarkCard.vue'
import MainSearchBar from '@/components/MainSearchBar.vue'
import { groupedBookmarks, state } from '@/composables/useStore'
import { settings } from '@/composables/useSettings'
import { useI18n } from '@/composables/useI18n'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

/** slug 是否匹配本机保存的分享设置。 */
const matched = computed(
  () => state.share.enabled && state.share.slug && state.share.slug === route.params.slug,
)

const groups = computed(() => groupedBookmarks.value.filter((g) => g.bookmarks.length || g.subs.length))

const gridStyle = computed(() => ({ '--cols': settings.perRow }))

function openBookmark(b) {
  window.open(b.url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div class="share">
    <!-- 分享不可用 -->
    <div v-if="!matched" class="share-empty glass">
      <AppIcon name="Link" :size="34" />
      <strong>{{ t('share.disabled') }}</strong>
      <p>当前是纯前端实现，分享页只能读到本机数据。开启分享并设置链接后缀后即可预览。</p>
      <div class="ops">
        <button class="btn-primary" @click="router.push('/')">{{ t('common.back') }}</button>
      </div>
    </div>

    <!-- 分享内容 -->
    <template v-else>
      <header class="share-head glass">
        <div class="sh-user">
          <div class="sh-avatar">
            <img v-if="state.share.avatar" :src="state.share.avatar" alt="" />
            <span v-else>{{ (state.share.displayName || 'J')[0].toUpperCase() }}</span>
          </div>
          <div class="sh-text">
            <h1>{{ state.share.displayName }}<span>{{ t('share.owner') }}</span></h1>
            <p>{{ t('common.sites', { n: state.bookmarks.length }) }}</p>
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
