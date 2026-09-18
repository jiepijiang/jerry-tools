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
import { fetchWeather } from '@/composables/useClock'
import { logout } from '@/composables/useAuth'
import { settings } from '@/composables/useSettings'
import { useI18n } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'

const { t } = useI18n()

const settingsOpen = ref(false)
const searchOpen = ref(false)

onMounted(() => {
  fetchWeather(settings.weatherCity)
})

async function onLogout() {
  await logout()
  toast(t('auth.logout'))
}
</script>

<template>
  <div class="app-shell">
    <TopBar @open-settings="settingsOpen = true" @open-search="searchOpen = true" @logout="onLogout" />

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

    <SettingsPanel v-model="settingsOpen" />
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
