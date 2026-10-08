import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initSettings } from '@/composables/useSettings'
import { initStore, refreshSitesFromCloud } from '@/composables/useStore'
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

  /*
   * 🔴 挂载之后再补「发现页」的云端数据 —— **故意不 await**。
   *
   * 未登录访客的 `active` 适配器是本地那个，读到的 `jt:sites` 是
   * 第一次访问灌进去的种子快照，而且**永远不会更新**（`sites` 不在
   * `SEED_ADDITIONS` 里）→ 后台新审核的站点对未登录访客不可见。
   *
   * 放在 `mount()` **之后**是关键：未登录访客的 boot 现在是纯本地的，
   * 阻塞读会给多数访客的挂载 +250ms。这里先让页面用种子渲染出来，
   * 云端数据到了再覆盖（reactive，发现页会自己更新）。
   *
   * 函数内部自己吞掉所有异常，所以这里不需要 `.catch()`。
   */
  refreshSitesFromCloud()
}

bootstrap()
