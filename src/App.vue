<script setup>
/**
 * 应用外壳。
 * 顶部信息栏 + 路由内容 + 页脚，另外挂全局的轻提示、设置面板和搜索浮层。
 */
import { onMounted, ref } from 'vue'
import TopBar from '@/components/TopBar.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SearchOverlay from '@/components/SearchOverlay.vue'
import ToastHost from '@/components/ToastHost.vue'
import { geo, initWeather, weather } from '@/composables/useClock'
import { logout } from '@/composables/useAuth'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'

const { t } = useI18n()

const settingsOpen = ref(false)
const searchOpen = ref(false)
/** 打开设置面板时要直接落到哪个分区（'' = 保持上次的）。 */
const settingsSection = ref('')

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
      <a href="https://jiepijiang.github.io/jerry-blog/" target="_blank" rel="noopener noreferrer">
        {{ t('footer.styleRef') }} Jerry's Blog
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
