/* =========================================================================
   Supabase 客户端
   -------------------------------------------------------------------------
   配置从构建期环境变量读：
     VITE_SUPABASE_URL        https://<ref>.supabase.co
     VITE_SUPABASE_ANON_KEY   anon / publishable key

   两个都没配 → `supabase === null`，整个 app 退回纯 localStorage 模式
   （即接入前的行为）。这是**刻意保留的降级路径**：
   本地开发、CI 跑测试、或者哪天 Supabase 挂了，页面都不该白屏。

   ⚠️ anon key 是**设计上就要发给浏览器的**，安全性由 RLS 保证，
      不要把它当秘密（跟飞书 webhook 那种情况不一样）。
      真正不能进前端的是 service_role key —— 那个能绕过所有 RLS。

   ⚠️ `import.meta.env.VITE_*` 是在**构建时**做静态文本替换的，
      所以改完 .env 必须重启 dev server / 重新 build，
      热更新不会让新值生效。
   ========================================================================= */

import { createClient } from '@supabase/supabase-js'

const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim()
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

/** 是否配置了后端。没配就一律走本地模式。 */
export const supabaseConfigured = Boolean(url && anonKey)

export const SUPABASE_URL = url

export const supabase = supabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /**
         * 关掉 URL 里 token 的自动探测。
         *
         * 本站用邮箱密码登录，不走 magic link / OAuth 回调，
         * 开着它反而会让 Supabase 去解析路由里的 query / hash ——
         * 我们用的是 createWebHistory，任何多余的 hash 处理都可能
         * 和 vue-router 打架。
         */
        detectSessionInUrl: false,
        storageKey: 'jt:auth',
      },
    })
  : null

/** 拿当前会话的 access token；没登录返回 null。 */
export async function currentToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token ?? null
}

/** 拿当前登录用户的 id；没登录返回 null。 */
export async function currentUserId() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.user?.id ?? null
}
