/* =========================================================================
   路由
   -------------------------------------------------------------------------
   ⚠️ **这里的守卫是「体验」，不是「安全」。**
   真正的权限判断在数据库的 RLS 上（`discover_sites` 的写策略只放行
   `is_admin()`）。守卫能拦住的只是「不该看这个页面的人」——
   绕过它（改 JS、直接打 REST）也做不成任何事，因为 RLS 会挡。
   所以它的目标是：**别让人看到一个他什么也做不了的页面**，
   而不是「防止越权」。越权的防线在库上。
   ========================================================================= */

import { createRouter, createWebHistory } from 'vue-router'
import { cloudAuthEnabled, isAdmin, isLoggedIn } from '@/composables/useAuth'
import { translate } from '@/composables/useI18n'
import { toast } from '@/composables/useToast'
const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/HomeView.vue'),
    meta: { title: '首页' },
  },
  {
    path: '/discover',
    name: 'discover',
    component: () => import('@/views/DiscoverView.vue'),
    meta: { title: '发现' },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('@/views/AdminView.vue'),
    meta: { title: '管理后台', requiresAdmin: true },
  },
  {
    /* 参考站把它做成独立路由而不是后台的一个 tab，保持一致 */
    path: '/icon-management',
    name: 'icon-management',
    component: () => import('@/views/IconManagementView.vue'),
    // 它写的是全局表 `discover_sites`（改图标、恢复默认），非 admin 一个字都写不进去。
    // 2026-10-02 之前它连口令闸都没有，任何登录用户点进去都会看到「图标已更新」而库里没变
    // —— 那个 bug 的根因已经修了（见 adapters/cloud.js 的 writeSites），
    // 这里补上「干脆别让人进去」这一半。
    meta: { title: '图标管理', requiresAdmin: true },
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/s/:slug',
    name: 'share',
    component: () => import('@/views/ShareView.vue'),
    meta: { title: '分享' },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

/**
 * 把 `?redirect=` 洗成「站内路径」—— 实现在 `@/utils/helpers` 的 `safeRedirect()`。
 * 放在 helpers 是因为 `LoginView` 也要用，从 `@/router` 反向 import 会绕成一个环。
 */

const router = createRouter({
  /* 用 BASE_URL 而不是 '/'：GitHub Pages 上站点在 /jerry-tools/ 子路径下，
     路由 base 必须跟着走，否则刷新 /jerry-tools/discover 会被当成根路径路由。 */
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * 管理类页面的守卫。
 *
 * ⚠️ **本机模式（没配 Supabase）直接放行**，这是有意的：
 *    本地模式的注册函数 `localRegister()` **永远写 `isAdmin: false`** ——
 *    也就是说本机模式下**没有任何人能是 admin**。真按 `isAdmin` 拦，
 *    站长自己在没配后端的环境里也进不去自己的后台。
 *    本机模式真正的闸是 `AdminView` 里的口令（`ADMIN_PASSWORD`）。
 *
 * ⚠️ **不要加「已登录就别停在 /login」这条规则。** `/login` 在已登录时
 *    是**个人资料页**（头像上传就在那儿），把它跳走会直接废掉换头像。
 *
 * 会话就绪性：`main.js` 的 `bootstrap()` 是
 * `await initSettings() → await initAuth() → await initStore() → mount()`，
 * 三次 await 全跑完才挂载，所以**首次导航时 `state.session` 已经恢复好了**，
 * 这里读 `isLoggedIn` / `isAdmin` 不会读到「还没恢复」的假空值。
 */
router.beforeEach((to) => {
  if (!to.meta?.requiresAdmin) return true
  if (!cloudAuthEnabled) return true

  if (!isLoggedIn.value) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (!isAdmin.value) {
    toast(translate('route.noPermission'), 'error')
    return { path: '/' }
  }
  return true
})

export default router