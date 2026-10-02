/* =========================================================================
   反馈：提反馈 / 管理员回复
   -------------------------------------------------------------------------
   这两个操作**不经过数据适配层**，直接打 RPC —— 理由见
   `supabase/migrations/006-feedback-rpc.sql` 的文件头，简单说：

   1. 🔴 适配层的 `rowToLocal()` 会把 `user_id` 丢掉、`localToRow()` 又会给
      每一行盖上**当前用户**的 uid。管理员能看到所有人的反馈，于是
      「读回全部 → 改一条 → 整表写回」会把别人的行也盖上管理员的 uid，
      `on conflict (user_id, id)` 匹配不上 → **插出一条副本**，原行纹丝不动。
   2. 🔴 被 RLS 挡掉的 update 不报错，只影响 0 行（PostgREST 返回 204）。
   3. 这两个函数**显式 return boolean**，客户端拿到的是真信号。

   配合 `cloud.js` 里 `SPECS[feedback].rpcOnly = true` ——
   `feedback` 在客户端是**只读表**，想绕也绕不过去。

   返回 `{ ok, reason }` 而不是裸 boolean：调用方要区分
     · `offline`  —— 纯本机模式 / 没配后端，压根没有反馈后端
     · `rejected` —— 后端明确说不（非管理员、空内容、未登录）
   这两种的提示文案不一样。
   ========================================================================= */

import { supabase, supabaseConfigured } from '@/data/supabase'

/**
 * 提一条反馈。
 *
 * @param {{ id: string, content: string, contact?: string }} p
 * @returns {Promise<{ ok: boolean, reason?: 'offline' | 'rejected' }>}
 * @throws {Error} 网络 / HTTP 层失败时抛（`error.code === 'submit-failed'`）
 */
export async function submitFeedback({ id, content, contact = '' }) {
  if (!supabaseConfigured) return { ok: false, reason: 'offline' }

  const { data, error } = await supabase.rpc('submit_feedback', {
    p_id: id,
    p_content: content,
    p_contact: contact,
  })
  if (error) {
    const e = new Error(`提交反馈失败：${error.message}`)
    e.code = 'submit-failed'
    e.cause = error
    throw e
  }
  return data === true ? { ok: true } : { ok: false, reason: 'rejected' }
}

/**
 * 管理员回复一条反馈。
 *
 * ⚠️ 必须带 `userId`（被回复那条反馈的**所有者**）——
 *    主键是 `(user_id, id)`，`id` 单独并不唯一，只按 id 找会打到别人的行。
 *
 * @param {{ userId: string, id: string, reply: string }} p
 * @returns {Promise<{ ok: boolean, reason?: 'offline' | 'rejected' }>}
 * @throws {Error} 网络 / HTTP 层失败时抛（`error.code === 'reply-failed'`）
 */
export async function replyFeedback({ userId, id, reply }) {
  if (!supabaseConfigured) return { ok: false, reason: 'offline' }

  const { data, error } = await supabase.rpc('reply_feedback', {
    p_user_id: userId,
    p_id: id,
    p_reply: reply,
  })
  if (error) {
    const e = new Error(`回复反馈失败：${error.message}`)
    e.code = 'reply-failed'
    e.cause = error
    throw e
  }
  return data === true ? { ok: true } : { ok: false, reason: 'rejected' }
}
