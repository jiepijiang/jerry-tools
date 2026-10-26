/* =========================================================================
   导航主页的种子数据
   -------------------------------------------------------------------------
   2026-10-13：**整套重做**。8 个分类 × 6 条 = 48 条。

   旧版是 6 分类 / 24 条（开发工具 · 设计资源 · AI 工具 · 影音娱乐 ·
   学习成长 · 效率工具），取自参考站 dh.huhage.fun。新版按 Jerry 的要求
   换成「AI / 前端 / 后端 / UI / 工具 / 学习 / 资源 / 娱乐」。

   ── icon 字段怎么来的（**别再手写，用脚本探**）──────────────────────────
   `scripts/probe-seed-urls.mjs` 探站点可达性 + 根目录图标；
   `scripts/probe-seed-icons.mjs` 再解析 HTML 里的 `<link rel="icon">` 取真实路径；
   `scripts/probe-seed-icons-render.mjs` **最后在真浏览器里验每个图标能不能渲染**。
   为什么需要第三个：**HTTP 200 + `image/*` 不等于浏览器能显示**。
   实测（2026-10-13）前两个探针全绿，第三个一跑就抓出 **7 个**加载失败 ——
   其中 6 个是沙箱网络到不了（Perplexity / Hugging Face / YouTube / Spotify /
   Steam / Docker 的 apple-touch 路径），换对路径或走代理就正常；
   1 个是**站点自己的缺陷**（花瓣网的 `/favicon.ico` 返回结构损坏的 ICO，
   请求 200 但 Chromium 拒绝解码，连 `requestfailed` 都不触发）。

   拿不到图标的 6 条**有意留空**，交给渲染层兜底（入口是 `iconSrcFor`）：
     Dribbble（图标 404）、Coolors（403 反爬）、npm（只有 16x16，太小）、
     哔哩哔哩（本机探针连不上，站点本身正常）、
     PDF24（其 /favicon.ico 能回落，写死反而多一个常量）、
     花瓣网（ICO 损坏，见上）。

   ⚠️ **留空 ≠ 一定显示首字母块**（2026-10-14 起）。书签走 `iconSrcFor(item)`，
      favicon 模式会**先读页面 HTML 抓 `<link rel="icon">`**，抓不到才回落到
      `origin/favicon.ico`，两者都失败才由 `BookmarkIcon` 显示首字母块。
      所以上面这 6 条实际可能显示出站点声明的真图标 —— PDF24 和 npm 的
      `/favicon.ico` 本来就是通的，它们**不会**显示字母块。
      真正的字母块是「站点确实没有可用图标」的那一类（404 / 403 反爬 / ICO 损坏）。

   ⚠️ **YouTube 的图标带构建 hash**（`/s/desktop/95e3a3fe/img/favicon_144x144.png`）。
      它的 `/favicon.ico` 只有 16x16，26px 的卡片上会糊。这个 hash 路径是
      旧版种子就在用的，暂时稳；万一哪天 404，卡片会退回首字母，不会崩。

   ⚠️ **探针在本机连不上 ≠ 站点失效**：哔哩哔哩直连和走代理都 ECONNRESET
   （沙箱网络问题）。项目既有判据 —— Cloudflare / 反爬拦截（403 / 401 / 202）
   **不算失效**，实测 Stack Overflow / npm / Coolors / Unsplash / 阮一峰
   都是 403 但浏览器里正常。

   ── 老用户怎么办 ────────────────────────────────────────────────────
   **本版整套替换，但故意不推送给老用户。** Jerry 2026-10-13 明确选了
   「不动，只在点『恢复默认数据』时整套替换」。

   所以：
     · `SEED_VERSION` **不 +1** —— 那个机制是「把新增条目补给老用户」，
       而这次的需求恰恰相反（不碰老用户的数据）。+1 会违背需求。
     · `SEED_ADDITIONS` **不加新条目**，理由同上。
     · 老用户想换成这套 → 设置面板 →「恢复默认数据」（`resetToDefaults()`，
       整套覆盖分类 + 书签，有二次确认）。

   ⚠️ **b22 / b23 / b24 是历史 id，必须保留原义** —— 它们是
   `useStore.js` 的 `SEED_ADDITIONS` v2 / v3 登记过的 id。
   换 id 会让那两版升级路径变成静默空操作（代码里有守卫，不会崩，
   但等于把一条活路径悄悄废掉）。所以这三条继续用旧 id，
   其余用 `分类前缀-序号`（`ai-1` / `fe-1` …）—— id 对用户不可见，
   前缀只是给读这个文件的人看的。
   ========================================================================= */

export const seedCategories = [
  { id: 'ai', name: 'AI 工具', icon: 'Sparkles', parentId: null, sortOrder: 0 },
  { id: 'frontend', name: '前端', icon: 'Code2', parentId: null, sortOrder: 1 },
  { id: 'backend', name: '后端', icon: 'Database', parentId: null, sortOrder: 2 },
  { id: 'ui', name: 'UI 设计', icon: 'Palette', parentId: null, sortOrder: 3 },
  { id: 'tools', name: '工具', icon: 'Wrench', parentId: null, sortOrder: 4 },
  { id: 'learn', name: '学习', icon: 'GraduationCap', parentId: null, sortOrder: 5 },
  { id: 'resource', name: '资源', icon: 'Folder', parentId: null, sortOrder: 6 },
  { id: 'media', name: '娱乐', icon: 'Film', parentId: null, sortOrder: 7 },
]

export const seedBookmarks = [
  /* —— AI 工具 —— */
  { id: 'ai-1', categoryId: 'ai', name: 'DeepSeek', url: 'https://chat.deepseek.com', description: '国产大模型对话', icon: 'https://fe-static.deepseek.com/chat/icon-180.png', sortOrder: 0 },
  { id: 'ai-2', categoryId: 'ai', name: 'Kimi', url: 'https://www.kimi.com', description: '长文本 AI 助手', icon: 'https://www.kimi.com/pwa-192.png', sortOrder: 1 },
  { id: 'ai-3', categoryId: 'ai', name: '豆包', url: 'https://www.doubao.com', description: '字节跳动 AI 助手', icon: 'https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/favicon/new-doubao/180x180.png', sortOrder: 2 },
  { id: 'ai-4', categoryId: 'ai', name: 'Perplexity', url: 'https://www.perplexity.ai', description: 'AI 搜索引擎', icon: 'https://www.perplexity.ai/apple-touch-icon.png', sortOrder: 3 },
  { id: 'ai-5', categoryId: 'ai', name: 'Hugging Face', url: 'https://huggingface.co', description: '开源模型与数据集社区', icon: 'https://huggingface.co/favicon.ico', sortOrder: 4 },
  { id: 'ai-6', categoryId: 'ai', name: 'Ollama', url: 'https://ollama.com', description: '本地大模型运行工具', icon: 'https://ollama.com/public/apple-touch-icon.png', sortOrder: 5 },

  /* —— 前端 —— */
  { id: 'fe-1', categoryId: 'frontend', name: 'MDN Web Docs', url: 'https://developer.mozilla.org', description: 'Web 技术权威文档', icon: 'https://developer.mozilla.org/apple-touch-icon.png', sortOrder: 0 },
  { id: 'fe-2', categoryId: 'frontend', name: 'Can I use', url: 'https://caniuse.com', description: '浏览器兼容性查询', icon: 'https://caniuse.com/img/favicon-128.png', sortOrder: 1 },
  { id: 'fe-3', categoryId: 'frontend', name: 'Vue.js', url: 'https://vuejs.org', description: '渐进式前端框架', icon: 'https://vuejs.org/logo.svg', sortOrder: 2 },
  { id: 'fe-4', categoryId: 'frontend', name: 'React', url: 'https://react.dev', description: '组件化 UI 库', icon: 'https://react.dev/apple-touch-icon.png', sortOrder: 3 },
  { id: 'fe-5', categoryId: 'frontend', name: 'Vite', url: 'https://vite.dev', description: '下一代前端构建工具', icon: 'https://vite.dev/logo-without-border.svg', sortOrder: 4 },
  { id: 'fe-6', categoryId: 'frontend', name: 'Tailwind CSS', url: 'https://tailwindcss.com', description: '原子化 CSS 框架', icon: 'https://tailwindcss.com/favicon.ico', sortOrder: 5 },

  /* —— 后端 —— */
  { id: 'be-1', categoryId: 'backend', name: 'GitHub', url: 'https://github.com', description: '全球最大的代码托管平台', icon: 'https://github.com/apple-touch-icon.png', sortOrder: 0 },
  { id: 'be-2', categoryId: 'backend', name: 'Stack Overflow', url: 'https://stackoverflow.com', description: '开发者问答社区', icon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon.png', sortOrder: 1 },
  { id: 'be-3', categoryId: 'backend', name: 'PostgreSQL', url: 'https://www.postgresql.org', description: '开源关系型数据库', icon: 'https://www.postgresql.org/favicon.ico', sortOrder: 2 },
  { id: 'be-4', categoryId: 'backend', name: 'Redis', url: 'https://redis.io', description: '内存键值数据库', icon: 'https://redis.io/favicon.ico', sortOrder: 3 },
  { id: 'be-5', categoryId: 'backend', name: 'Docker', url: 'https://www.docker.com', description: '容器化平台', icon: 'https://www.docker.com/favicon.ico', sortOrder: 4 },
  { id: 'be-6', categoryId: 'backend', name: 'Supabase', url: 'https://supabase.com', description: '开源后端即服务', icon: 'https://supabase.com/favicon/apple-icon-180x180.png', sortOrder: 5 },

  /* —— UI 设计 —— */
  { id: 'ui-1', categoryId: 'ui', name: 'Figma', url: 'https://www.figma.com', description: '在线协作设计工具', icon: 'https://www.figma.com/favicon.ico', sortOrder: 0 },
  { id: 'ui-2', categoryId: 'ui', name: 'Dribbble', url: 'https://dribbble.com', description: '设计师灵感社区', sortOrder: 1 },
  { id: 'ui-3', categoryId: 'ui', name: 'Unsplash', url: 'https://unsplash.com', description: '免费高清图片素材', icon: 'https://unsplash.com/apple-touch-icon.png', sortOrder: 2 },
  { id: 'ui-4', categoryId: 'ui', name: 'Coolors', url: 'https://coolors.co', description: '配色方案生成器', sortOrder: 3 },
  { id: 'ui-5', categoryId: 'ui', name: '阿里巴巴矢量图标库', url: 'https://www.iconfont.cn', description: '国内最大的图标库', icon: 'https://www.iconfont.cn/apple-touch-icon.png', sortOrder: 4 },
  { id: 'ui-6', categoryId: 'ui', name: '花瓣网', url: 'https://huaban.com', description: '设计灵感采集', sortOrder: 5 },

  /* —— 工具 —— */
  { id: 'tl-1', categoryId: 'tools', name: 'Notion', url: 'https://www.notion.so', description: '全能笔记与协作工具', icon: 'https://www.notion.so/front-static/logo-ios.png', sortOrder: 0 },
  { id: 'tl-2', categoryId: 'tools', name: 'Excalidraw', url: 'https://excalidraw.com', description: '手绘风格白板工具', icon: 'https://excalidraw.com/apple-touch-icon.png', sortOrder: 1 },
  /**
   * ⚠️ 历史 id（`SEED_ADDITIONS` v3 登记过），**不要改**。
   * icon 留空是有意的，但理由 2026-10-14 之后变了：
   *   · 留空（favicon 模式）→ **先读 HTML 抓站点声明的真图标**，抓不到才回落
   *     `https://tools.pdf24.org/favicon.ico`（实测 200，但是 143 KB 的 ico）。
   *   · 写死同一个地址 → **固定**用那个 143 KB 的 ico，反而**阻止**用真图标
   *     （`iconSrcFor` 只在 favicon 模式下去解析 HTML，custom 模式直接用给定地址）。
   * 所以「写死效果一样」已经不成立 —— 留空更好，不只是为了少一个常量。
   */
  { id: 'b24', categoryId: 'tools', name: 'PDF24 Tools', url: 'https://tools.pdf24.org/zh/', description: '免费在线 PDF 工具箱', sortOrder: 2 },
  { id: 'tl-4', categoryId: 'tools', name: 'TinyPNG', url: 'https://tinypng.com', description: '图片无损压缩', icon: 'https://tinypng.com/images/apple-touch-icon.png', sortOrder: 3 },
  { id: 'tl-5', categoryId: 'tools', name: 'regex101', url: 'https://regex101.com', description: '正则表达式调试', icon: 'https://regex101.com/favicon.ico', sortOrder: 4 },
  /**
   * ⚠️ 历史 id（`SEED_ADDITIONS` v2 登记过），**不要改**。
   *
   * Jerry 是「前端 + 嵌入式前端」，串口调试是日常活。挑它的原因：
   *   - 纯 Web Serial，不用装驱动、不用装客户端，Chrome / Edge 打开就能连
   *   - 功能比一般的在线版全：协议解析、YMODEM 固件升级、数据可视化
   *   - 作者就是本站 UI 的复刻对象 xywml.com —— 同一个站长自己的产品
   *
   * ⚠️ 依赖 Web Serial API，**只有 Chromium 系（Chrome / Edge）能用**，
   *    Safari 和 Firefox 打不开串口；且必须 HTTPS 或 localhost。
   *    所以描述里带「· 需 Chrome」—— 比让人点进去发现连不上强。
   *
   * ⚠️ 描述占满两行，这张卡比同组高（65.3 → 81.4px）。它独占一行
   *    （tools 第 6 条，每行 5 个），`.grid` 的 `align-items: stretch`
   *    只影响它自己，所以代价可控。别为省 16px 砍掉「与固件升级」。
   */
  { id: 'b22', categoryId: 'tools', name: '串口助手', url: 'https://serial.xywml.com/', description: '在线串口调试与固件升级 · 需 Chrome', icon: 'https://serial.xywml.com/apple-touch-icon.png', sortOrder: 5 },

  /* —— 学习 —— */
  { id: 'ln-1', categoryId: 'learn', name: '掘金', url: 'https://juejin.cn', description: '开发者技术社区', icon: 'https://juejin.cn/favicon.ico', sortOrder: 0 },
  { id: 'ln-2', categoryId: 'learn', name: '菜鸟教程', url: 'https://www.runoob.com', description: '编程入门教程', icon: 'https://www.runoob.com/favicon.ico', sortOrder: 1 },
  { id: 'ln-3', categoryId: 'learn', name: '阮一峰的网络日志', url: 'https://www.ruanyifeng.com/blog/', description: '中文技术随笔', icon: 'https://www.ruanyifeng.com/favicon.ico', sortOrder: 2 },
  { id: 'ln-4', categoryId: 'learn', name: 'freeCodeCamp', url: 'https://www.freecodecamp.org', description: '免费编程学习平台', icon: 'https://www.freecodecamp.org/icons/icon-192x192.png', sortOrder: 3 },
  { id: 'ln-5', categoryId: 'learn', name: 'Coursera', url: 'https://www.coursera.org', description: '国际在线课程', icon: 'https://www.coursera.org/favicon.ico', sortOrder: 4 },
  /**
   * ⚠️ 历史 id（`SEED_ADDITIONS` v3 登记过），**不要改**。
   *
   * 站点真名取自它自己的 `<title>`：「Agent Lab · 学习工作台」。
   * ⚠️ **只存站点根地址** —— Jerry 复制过来的是
   *    `?date=2026-09-29&week=1#overview`，写死日期过一周就指向旧周次，
   *    而且这是给**所有人**看的默认值。
   * ⚠️ **icon 必须写死**：它的 `/favicon.ico` 是 404（返回 JSON，那台机器
   *    是纯 API 服务），真图标是 HTML 里声明的 `/assets/favicon.svg`。
   */
  { id: 'b23', categoryId: 'learn', name: 'Agent Lab', url: 'https://ai-study-exam.onrender.com/', description: 'AI 学习工作台', icon: 'https://ai-study-exam.onrender.com/assets/favicon.svg', sortOrder: 5 },

  /* —— 资源 —— */
  { id: 'rs-1', categoryId: 'resource', name: 'npm', url: 'https://www.npmjs.com', description: 'Node.js 包管理器', sortOrder: 0 },
  { id: 'rs-2', categoryId: 'resource', name: 'Google Fonts', url: 'https://fonts.google.com', description: '免费开源字体', icon: 'https://www.gstatic.com/images/branding/product/2x/google_fonts_96dp.png', sortOrder: 1 },
  { id: 'rs-3', categoryId: 'resource', name: 'Iconify', url: 'https://icon-sets.iconify.design', description: '开源图标集合', icon: 'https://icon-sets.iconify.design/apple-touch-icon.png', sortOrder: 2 },
  { id: 'rs-4', categoryId: 'resource', name: 'cdnjs', url: 'https://cdnjs.com', description: '前端 CDN 资源库', icon: 'https://cdnjs.com/favicon.ico', sortOrder: 3 },
  { id: 'rs-5', categoryId: 'resource', name: 'unDraw', url: 'https://undraw.co', description: '开源插画素材', icon: 'https://undraw.co/apple-touch-icon.png', sortOrder: 4 },
  { id: 'rs-6', categoryId: 'resource', name: 'Lorem Picsum', url: 'https://picsum.photos', description: '占位图生成服务', icon: 'https://picsum.photos/favicon.ico', sortOrder: 5 },

  /* —— 娱乐 —— */
  { id: 'md-1', categoryId: 'media', name: 'YouTube', url: 'https://www.youtube.com', description: '全球视频分享平台', icon: 'https://www.youtube.com/s/desktop/95e3a3fe/img/favicon_144x144.png', sortOrder: 0 },
  { id: 'md-2', categoryId: 'media', name: '哔哩哔哩', url: 'https://www.bilibili.com', description: '年轻人的视频社区', sortOrder: 1 },
  { id: 'md-3', categoryId: 'media', name: 'Spotify', url: 'https://www.spotify.com', description: '在线音乐流媒体', icon: 'https://www.spotify.com/apple-touch-icon.png', sortOrder: 2 },
  { id: 'md-4', categoryId: 'media', name: '知乎', url: 'https://www.zhihu.com', description: '中文问答社区', icon: 'https://www.zhihu.com/favicon.ico', sortOrder: 3 },
  { id: 'md-5', categoryId: 'media', name: '豆瓣', url: 'https://www.douban.com', description: '书影音评分社区', icon: 'https://www.douban.com/favicon.ico', sortOrder: 4 },
  { id: 'md-6', categoryId: 'media', name: 'Steam', url: 'https://store.steampowered.com', description: '全球游戏平台', icon: 'https://store.steampowered.com/apple-touch-icon.png', sortOrder: 5 },
]

/** 可选的默认搜索引擎。 */
export const searchEngines = [
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', color: '#2932e1' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=', color: '#008373' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', color: '#4285f4' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=', color: '#24292f' },
  { id: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=', color: '#cb3837' },
]
