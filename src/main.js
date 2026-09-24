import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initSettings } from '@/composables/useSettings'
import { initStore } from '@/composables/useStore'
import { initAuth } from '@/composables/useAuth'

import '@/styles/root.css'
import '@/styles/base.css'

/**
 * 初始化顺序（**不能换**）：
 *   1. 设置 —— 主题属性要尽早写到 <html>，避免闪白
 *   2. 认证 —— 恢复已有会话；已登录的话会把存储适配器切到云端
 *      并完成「本机数据 → 云端」的首次迁移
 *   3. 数据仓库 —— 上一步已经加载过就跳过（state.ready 挡着）
 *
 * 为什么认证必须在数据仓库前面：`initStore` 里的 seedIfEmpty 会往
 * 「当前适配器」写种子。如果先跑它，适配器还是本地那个，
 * 云端用户第一次登录时本机数据还没搬上去 —— 迁移就会被跳过。
 */
async function bootstrap() {
  await initSettings()
  await initAuth()
  await initStore()
  createApp(App).use(router).mount('#app')
}

bootstrap()
