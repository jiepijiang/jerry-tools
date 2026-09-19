import { createRouter, createWebHistory } from 'vue-router'

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
    meta: { title: '管理后台' },
  },
  {
    /* 参考站把它做成独立路由而不是后台的一个 tab，保持一致 */
    path: '/icon-management',
    name: 'icon-management',
    component: () => import('@/views/IconManagementView.vue'),
    meta: { title: '图标管理' },
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

export default createRouter({
  /* 用 BASE_URL 而不是 '/'：GitHub Pages 上站点在 /jerry-tools/ 子路径下，
     路由 base 必须跟着走，否则刷新 /jerry-tools/discover 会被当成根路径路由。 */
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
