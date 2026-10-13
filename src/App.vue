<script setup>
/**
 * 应用外壳。
 * 顶部信息栏 + 路由内容 + 页脚，另外挂全局的轻提示、设置面板和搜索浮层。
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import TopBar from '@/components/TopBar.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SearchOverlay from '@/components/SearchOverlay.vue'
import ToastHost from '@/components/ToastHost.vue'
import AppIcon from '@/components/AppIcon.vue'
import { repo, siblings } from '@/data/site'
import { geo, initWeather, weather } from '@/composables/useClock'
import { logout } from '@/composables/useAuth'
import { state } from '@/composables/useStore'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'

const { t } = useI18n()

const settingsOpen = ref(false)
const searchOpen = ref(false)
/** 打开设置面板时要直接落到哪个分区（'' = 保持上次的）。 */
const settingsSection = ref('')
/** 数据完整性告警条被用户关掉了吗（只影响这一次浏览，不落盘）。 */
const dataNoticeClosed = ref(false)

/**
 * 页脚「管理」入口的图标：登录后是盾牌、未登录是锁。
 *
 * ⚠️ 页脚**不隐藏**这个入口（顶栏那个是 `isAdmin` 才出现的条件项）——
 *    技能站的页脚也是给所有访客看一个「管理」小字，理由一样：
 *    它长得最弱，不抢 GitHub / 姊妹站的注意力，但让站主自己一步可达，
 *    不用去背 `/admin` 这个 URL。
 */
const isAdmin = computed(() => !!state.session?.isAdmin)

/**
 * 有「键存在但读不出来」的数据时给一条**常驻**提示。
 *
 * ⚠️ 为什么不用 toast：toast 几秒就没了，而这是一条**数据完整性**告警 ——
 *    用户需要知道「我有一份数据读不出来、但**没有被覆盖**」，
 *    否则他只会看到一个空列表（修这个 bug 之前更糟：会被种子数据冒充成
 *    「你的书签就是这些」）。
 *    `state.readProblems` 由 `useStore` 在加载时填，见 `readState()` 的注释。
 */
const hasReadProblems = computed(() => state.readProblems.length > 0)

/** 同一个会话里「定位没拿到」只提醒一次，别每次刷新都弹。 */
const GEO_NOTICE_KEY = 'jt:geo-notice-shown'

function openSettings(section = '') {
  settingsSection.value = section
  settingsOpen.value = true
}

// 首次进入会请求浏览器定位授权；用户拒绝或超时则回落到设置里的城市。
// 回落到的默认城市不是用户所在地，所以这里必须说一声，不能默默显示。
onMounted(async () => {
  await initWeather()
  if (weather.source !== 'default' || !geo.error) return
  try {
    if (sessionStorage.getItem(GEO_NOTICE_KEY)) return
    sessionStorage.setItem(GEO_NOTICE_KEY, '1')
  } catch {
    /* 隐私模式下读不到 sessionStorage，那就每次都提醒 */
  }
  toast(t('weather.geoFallbackHint', { name: weather.city }), 'warning')
})

async function onLogout() {
  await logout()
  toast(t('auth.logout'))
}
</script>

<template>
  <div class="app-shell">
    <TopBar @open-settings="openSettings" @open-search="searchOpen = true" @logout="onLogout" />

    <div v-if="hasReadProblems && !dataNoticeClosed" class="data-notice" role="alert">
      <AppIcon name="AlertCircle" :size="15" />
      <span class="data-notice-text">{{ t('data.readProblem', { n: state.readProblems.length }) }}</span>
      <button class="data-notice-action" type="button" @click="openSettings('data')">
        {{ t('data.readProblemAction') }}
      </button>
      <button
        class="data-notice-close"
        type="button"
        :aria-label="t('common.close')"
        @click="dataNoticeClosed = true"
      >
        <AppIcon name="X" :size="14" />
      </button>
    </div>

    <main class="app-main">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>

    <!--
      页脚（2026-10-13 改成与技能站 `HubFooter.vue` 同一套样式与结构）：
        版权 · 本站名 · GitHub · 姊妹站… · 管理
      ⚠️ 本站自己**不在姊妹站列表里** —— 页脚列的是「去别处」的入口。
      姊妹站地址来自 `data/site.js`（顶栏也用同一份，别在这里写死 URL）。
    -->
    <footer class="app-footer">
      <div class="app-footer-inner">
        <span>{{ t('footer.copyright') }} · {{ t('app.name') }}</span>

        <span class="sep">·</span>
        <a :href="repo" target="_blank" rel="noopener noreferrer">GitHub</a>

        <template v-for="s in siblings" :key="s.href">
          <span class="sep">·</span>
          <a :href="s.href" target="_blank" rel="noopener noreferrer">{{ t(s.labelKey) }}</a>
        </template>

        <span class="sep">·</span>
        <RouterLink class="admin-entry" :class="{ on: isAdmin }" to="/admin">
          <AppIcon :name="isAdmin ? 'Shield' : 'Lock'" :size="12" />
          {{ t('nav.admin') }}
        </RouterLink>
      </div>
    </footer>

    <SettingsPanel v-model="settingsOpen" :initial-section="settingsSection" />
    <SearchOverlay v-model="searchOpen" />
    <ToastHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.app-main {
  flex: 1;
  min-height: 0;
}

/*
 * 数据完整性告警条。
 *
 * ⚠️ 用**常驻**样式而不是 toast —— 这是一条「你的数据读不出来，
 *    但我没有覆盖它」的告警，用户需要有时间读完并决定怎么办。
 *    配色跟设置面板里的错误提示保持一致（`--danger` 系），
 *    但用描边而不是实底，避免在浅色主题下过于刺眼。
 */
.data-notice {
  align-items: center;
  background: color-mix(in srgb, var(--danger) 9%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 28%, transparent);
  color: var(--danger);
  display: flex;
  font-size: 12.5px;
  gap: 8px;
  padding: 8px 16px;
}

.data-notice-text {
  flex: 1;
  min-width: 0;
}

.data-notice-action,
.data-notice-close {
  align-items: center;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  padding: 2px 9px;
  transition: background 0.18s ease;
  white-space: nowrap;
}

.data-notice-close {
  border-color: transparent;
  padding: 2px 5px;
}

.data-notice-action:hover,
.data-notice-close:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

/* —— 页脚 ——
   结构 / 尺寸对齐技能站的 `HubFooter.vue`（2026-10-13）。
   ⚠️ 变量名两边不同、值一一对应，改的时候别照着抄变量名：
        --hub_line           → --border_color
        --footer_text_color  → --muted_text_color
        --hub_accent         → --accent-text
        --hub_ok             → --success
        --item_hover_color   → 同名 */
.app-footer {
  border-top: 1px solid var(--border_color);
  color: var(--muted_text_color);
  margin-top: 40px;
  padding: 18px 20px 26px;
}

.app-footer-inner {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  font-size: 13px;
  gap: 6px;
  justify-content: center;
  margin: 0 auto;
  max-width: 1150px;
  /* ⚠️ 这里**故意不加** `opacity: 0.75` —— 技能站的 `HubFooter.vue` 有，
     但那是**纯白字压在深色底**上，乘 0.75 之后还有 5.3:1。
     本站的 `--muted_text_color` 本身已经是灰的（浅色 #5b6472），
     再乘一次 0.75 → 有效色 ≈ #808793、对比度掉到 **3.19:1**，
     低于 WCAG AA 的 4.5:1 —— 页脚会淡到读不清（实测过）。

     **「弱化」的意图保留，手段跟着主题走**：靠「灰 vs 正文的近黑」拉开层次，
     不靠透明度。当前 5.28:1。
     `probe-footer.mjs` 有一条断言把有效对比度钉在 ≥ 4.5:1。 */
}

.app-footer a {
  color: var(--muted_text_color);
  transition: color 0.2s ease;
}

.app-footer a:hover {
  color: var(--accent-text);
}

.sep {
  opacity: 0.5;
}

/* 管理入口：故意做成最弱的一档 —— 它是站主自己用的，
   不该跟「GitHub / 姊妹站」这些给访客看的链接抢注意力。
   （技能站的页脚同款，理由一样。） */
.admin-entry {
  align-items: center;
  border-radius: 6px;
  color: inherit;
  display: inline-flex;
  gap: 4px;
  opacity: 0.6;
  padding: 2px 6px;
  text-decoration: none;
  transition: background-color 0.2s ease, color 0.2s ease, opacity 0.2s ease;
}

.admin-entry:hover {
  background-color: var(--item_hover_color);
  color: var(--accent-text);
  opacity: 1;
}

/* 已登录：盾牌 + 绿色 —— 和顶栏那个「管理」是同一个语义，
   让人一眼看出「我现在是登录态」。 */
.admin-entry.on {
  color: var(--success);
  opacity: 0.9;
}

.admin-entry :deep(svg) {
  flex-shrink: 0;
}
</style>
