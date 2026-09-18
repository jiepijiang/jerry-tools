import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initSettings } from '@/composables/useSettings'
import { initStore } from '@/composables/useStore'

import '@/styles/root.css'
import '@/styles/base.css'

/**
 * 先初始化设置（主题属性要尽早写到 <html>，避免闪白），
 * 再初始化数据仓库，最后挂载。
 */
async function bootstrap() {
  await initSettings()
  await initStore()
  createApp(App).use(router).mount('#app')
}

bootstrap()
