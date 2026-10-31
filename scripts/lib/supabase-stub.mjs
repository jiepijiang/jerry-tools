/* =========================================================================
   supabase-stub.mjs —— 让 `@/data/supabase` 在裸 `node` 下也能被 import

   为什么需要（2026-10-31）：

     `src/data/adapters/cloud.js` 里有全项目**最权威**的一份表清单（`SPECS`），
     实时订阅的表（`REALTIME_TABLES`）就是它推出来的。可这个模块一行都测不了 ——
     它 import 了 `@/data/supabase`，而那个文件第一句就是

         const url = String(import.meta.env.VITE_SUPABASE_URL || '').trim()

     `import.meta.env` 是 **Vite 构建期替换**的，裸 node 下是 `undefined`，
     于是 `undefined.VITE_SUPABASE_URL` 直接 TypeError。
     （顺带还会去加载 `@supabase/supabase-js`，一个几百 KB 的真库。）

   所以 `alias-loader.mjs` 把 `@/data/supabase` 重定向到本文件。
   这不是「用假货糊弄测试」—— 那个模块在 node 下**本来就加载不起来**，
   桩是唯一能让它加载的路，不存在「真货被替换」这回事。

   ⚠️ 边界：这里**没有真客户端**。
      `supabase` 是个 Proxy，任何属性访问都抛一句人话，
      而不是让你在 `Cannot read properties of null` 里猜半天。
      要验「真事件有没有推过来」请用 `probe-realtime-live.mjs`
      （真浏览器 + 探针账号 + 真网络），那是另一回事。
   ========================================================================= */

const NO_CLIENT =
  '[探针] 这是 node 下的 Supabase 桩，没有真客户端。\n' +
  '      本文件只用来让 adapters/cloud.js 里的常量表能被 import。\n' +
  '      要验真实事件推送请跑 npm run probe:realtime（真浏览器 + 探针账号）。'

/** 任何属性访问都抛 —— 与其让人对着 null 猜，不如直接说清楚。 */
export const supabase = new Proxy(
  {},
  {
    get(_t, prop) {
      // `then` 要特殊对待：否则 `await import()` / Promise 检查会把它当 thenable，
      // 报一个和真实原因毫无关系的错。
      if (prop === 'then') return undefined
      throw new Error(`${NO_CLIENT}\n      被访问的属性：supabase.${String(prop)}`)
    },
    apply() {
      throw new Error(NO_CLIENT)
    },
  },
)

/** 与真模块同名同义：没配置后端。 */
export const supabaseConfigured = false

/** 与真模块同名同义：空串。 */
export const SUPABASE_URL = ''

export async function currentToken() {
  return null
}

export async function currentUserId() {
  return null
}
