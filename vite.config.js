import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/*
 * GitHub Pages 把站点挂在 https://<user>.github.io/<repo>/ 这个子路径下，
 * 所以构建时必须带 base，否则 /assets/*.js 全部 404。
 * 本地 dev 仍用 '/'，不然访问地址会变成 http://127.0.0.1:5174/jerry-tools/。
 */
const REPO_NAME = 'jerry-tools'

/*
 * GitHub Pages 没有 SPA fallback：直接打开 /jerry-tools/discover 或刷新该页会 404。
 * 官方推荐的做法是额外提供一份 404.html，内容与 index.html 相同。
 *
 * 输出目录从 configResolved 里取，不要写死 ./dist ——
 * 否则用 `vite build --outDir xxx` 时 404.html 会被写到 dist 去。
 */
function spaFallbackPlugin() {
  let outDir = null
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    configResolved(config) {
      const dir = config.build.outDir
      outDir = path.isAbsolute(dir) ? dir : path.resolve(config.root, dir)
    },
    closeBundle() {
      if (!outDir) return
      const index = path.join(outDir, 'index.html')
      if (existsSync(index)) copyFileSync(index, path.join(outDir, '404.html'))
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  plugins: [vue(), spaFallbackPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5174, host: '127.0.0.1' },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        /*
         * 拆包（2026-10-14）。
         *
         * ## 只拆这一块的理由
         *
         * 拆之前主包 **571KB raw / 166KB gzip**，里面三样东西混在一起：
         *   · `@supabase/supabase-js` —— 227KB raw
         *   · `seed-discover`（377 条发现页数据）—— 91KB raw
         *   · 其余业务代码
         *
         * ⚠️ **拆包本身不等于变快。** 拆出来的 chunk 如果仍被主包静态依赖，
         *    Vite 会给它加 `<link rel="modulepreload">` —— 浏览器照样**并行下载**
         *    全部字节，总量甚至因为 chunk 边界而略微变大。这是实测出来的，
         *    别把「主包数字变小」当成「首屏变快」。
         *
         * 所以这里只做一件**有真实收益**的事，其余交给别的机制：
         *
         *   ① `@supabase/supabase-js` 单独成块 —— 它的版本一升才变，
         *      而主包**每次部署都变**。分开之后，回访访客的这份 227KB
         *      能一直命中缓存，不必跟着主包重下。
         *
         *   ② `seed-discover` **故意不写在这里** —— 它由 `useStore.readSites()`
         *      用**动态 import** 按需加载（只有首次访客、且只到发现页才用得上），
         *      因此不会进 index.html 的 preload 列表。写进 manualChunks 反而
         *      会把它拉回静态依赖、又被预加载，等于把优化抵消掉。
         *
         *   ③ `seed.js`（9KB）也**不拆** —— 太小，多一个请求不划算。
         */
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'vendor-supabase'
        },
      },
    },
  },
}))
