<script setup>
/**
 * 应用外壳。
 * 顶部信息栏 + 路由内容 + 页脚，另外挂全局的轻提示、设置面板和搜索浮层。
 */
import { computed, onMounted, ref } from 'vue'
import TopBar from '@/components/TopBar.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SearchOverlay from '@/components/SearchOverlay.vue'
import ToastHost from '@/components/ToastHost.vue'
import AppIcon from '@/components/AppIcon.vue'
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

    <footer class="app-footer">
      <span>{{ t('app.name') }} · {{ t('footer.builtWith') }}</span>
      <span class="sep">·</span>
      <a href="https://dh.huhage.fun/" target="_blank" rel="noopener noreferrer">
        {{ t('footer.reference') }} dh.huhage.fun
      </a>
      <span class="sep">·</span>
      <a href="https://jiepijiang.github.io/jerry-site/" target="_blank" rel="noopener noreferrer">
        {{ t('footer.styleRef') }} Jerry Site
      </a>
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

.app-footer {
  align-items: center;
  color: var(--muted_text_color);
  display: flex;
  flex-wrap: wrap;
  font-size: 11.5px;
  gap: 6px;
  justify-content: center;
  padding: 18px 16px 22px;
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
</style>
