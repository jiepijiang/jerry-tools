/* =========================================================================
   导航主页的种子数据
   -------------------------------------------------------------------------
   分类与书签取自参考站 dh.huhage.fun 的内置默认数据（6 分类 / 21 书签），
   已剔除无法访问的 2 条：
     - ChatGPT  （OpenAI 拦截代理/VPN 出口，实测 403）
     - Claude   （App unavailable in region）
   其余 19 条全部实测可访问（Cloudflare 反爬拦截不算失效）。

   2026-09-20 追加 1 条（b22 串口助手），共 **22 条** —— 见文件末尾的说明。

   icon 字段：能拿到高清图标的直接写死（与参考站把图标存进数据的做法一致），
   拿不到的留空，由 faviconOf() 退回站点自己的 /favicon.ico。
   这样运行时不需要依赖任何第三方图标服务，国内也能正常显示。

   ⚠️ **往这个文件里增删条目时，必须同步 +1 `SEED_VERSION` 并登记到
   useStore.js 的 `SEED_ADDITIONS`** —— 否则老用户（localStorage 里已经有数据）
   永远看不到新条目。原因见 useStore.js 顶部那段注释。
   ========================================================================= */

export const seedCategories = [
  { id: 'dev', name: '开发工具', icon: 'Code2', parentId: null, sortOrder: 0 },
  { id: 'design', name: '设计资源', icon: 'Palette', parentId: null, sortOrder: 1 },
  { id: 'ai', name: 'AI 工具', icon: 'Sparkles', parentId: null, sortOrder: 2 },
  { id: 'media', name: '影音娱乐', icon: 'Film', parentId: null, sortOrder: 3 },
  { id: 'learn', name: '学习成长', icon: 'GraduationCap', parentId: null, sortOrder: 4 },
  { id: 'tools', name: '效率工具', icon: 'Zap', parentId: null, sortOrder: 5 },
]

export const seedBookmarks = [
  { id: 'b1', categoryId: 'dev', name: 'GitHub', url: 'https://github.com', description: '全球最大的代码托管平台', icon: 'https://github.githubassets.com/favicons/favicon.png', sortOrder: 0 },
  { id: 'b2', categoryId: 'dev', name: 'VS Code', url: 'https://code.visualstudio.com', description: '轻量级代码编辑器', sortOrder: 1 },
  { id: 'b3', categoryId: 'dev', name: 'Stack Overflow', url: 'https://stackoverflow.com', description: '开发者问答社区', icon: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/apple-touch-icon.png', sortOrder: 2 },
  { id: 'b4', categoryId: 'dev', name: 'MDN Web Docs', url: 'https://developer.mozilla.org', description: 'Web 技术权威文档', icon: 'https://developer.mozilla.org/apple-touch-icon.png', sortOrder: 3 },
  { id: 'b5', categoryId: 'dev', name: 'npm', url: 'https://www.npmjs.com', description: 'Node.js 包管理器', sortOrder: 4 },

  /**
   * 2026-09-20 追加。Jerry 是「前端 + 嵌入式前端」，串口调试是日常活，
   * 但这类工具几乎全是 Windows 桌面软件，浏览器能直接用的很少。
   *
   * 挑它的原因：
   *   - 纯 Web Serial，不用装驱动、不用装客户端，Chrome / Edge 打开就能连
   *   - 功能比一般的在线版全：协议解析、YMODEM 固件升级、数据可视化
   *   - 作者就是本站 UI 的复刻对象 xywml.com —— 同一个站长自己的产品
   *     （主站 project 区那四张卡里本来就有「串口助手」，只是当时没找到
   *      稳定可用的在线实现才拿掉的，见 jerry-site 的 site.js）
   *
   * ⚠️ 依赖 Web Serial API，**只有 Chromium 系（Chrome / Edge）能用**，
   *    Safari 和 Firefox 打不开串口；且必须 HTTPS 或 localhost。
   *    这条要是在卡片上写清楚，比让人点进去发现连不上强。
   */
  { id: 'b22', categoryId: 'dev', name: '串口助手', url: 'https://serial.xywml.com/', description: '在线串口调试与固件升级', icon: 'https://serial.xywml.com/apple-touch-icon.png', sortOrder: 5 },

  { id: 'b6', categoryId: 'design', name: 'Figma', url: 'https://www.figma.com', description: '在线协作设计工具', icon: 'https://static.figma.com/app/icon/2/touch-120.png', sortOrder: 0 },
  { id: 'b7', categoryId: 'design', name: 'Dribbble', url: 'https://dribbble.com', description: '设计师灵感社区', sortOrder: 1 },
  { id: 'b8', categoryId: 'design', name: 'Unsplash', url: 'https://unsplash.com', description: '免费高清图片素材', sortOrder: 2 },
  { id: 'b9', categoryId: 'design', name: 'Coolors', url: 'https://coolors.co', description: '配色方案生成器', sortOrder: 3 },

  { id: 'b10', categoryId: 'ai', name: 'Perplexity', url: 'https://www.perplexity.ai', description: 'AI 搜索引擎', sortOrder: 0 },
  { id: 'b11', categoryId: 'ai', name: 'Midjourney', url: 'https://www.midjourney.com', description: 'AI 图像生成', sortOrder: 1 },
  { id: 'b12', categoryId: 'ai', name: 'Hugging Face', url: 'https://huggingface.co', description: '开源模型与数据集社区', icon: 'https://huggingface.co/front/assets/huggingface_logo-noborder.svg', sortOrder: 2 },
  { id: 'b13', categoryId: 'ai', name: 'Ollama', url: 'https://ollama.com', description: '本地大模型运行工具', icon: 'https://ollama.com/public/apple-touch-icon.png', sortOrder: 3 },

  { id: 'b14', categoryId: 'media', name: 'YouTube', url: 'https://www.youtube.com', description: '全球视频分享平台', icon: 'https://www.youtube.com/s/desktop/95e3a3fe/img/favicon_144x144.png', sortOrder: 0 },
  { id: 'b15', categoryId: 'media', name: '哔哩哔哩', url: 'https://www.bilibili.com', description: '年轻人的视频社区', sortOrder: 1 },
  { id: 'b16', categoryId: 'media', name: 'Spotify', url: 'https://www.spotify.com', description: '在线音乐流媒体', icon: 'https://open.spotifycdn.com/cdn/images/favicon32.b64ecc03.png', sortOrder: 2 },

  { id: 'b17', categoryId: 'learn', name: '掘金', url: 'https://juejin.cn', description: '开发者技术社区', icon: 'https://lf-web-assets.juejin.cn/obj/juejin-web/xitu_juejin_web/static/favicons/apple-touch-icon.png', sortOrder: 0 },
  { id: 'b18', categoryId: 'learn', name: 'Coursera', url: 'https://www.coursera.org', description: '在线学习平台', sortOrder: 1 },

  { id: 'b19', categoryId: 'tools', name: 'Notion', url: 'https://www.notion.so', description: '全能笔记与协作工具', icon: 'https://www.notion.so/front-static/logo-ios.png', sortOrder: 0 },
  { id: 'b20', categoryId: 'tools', name: 'Todoist', url: 'https://todoist.com', description: '任务管理工具', icon: 'https://todoist.com/static/favicon-32x32.png', sortOrder: 1 },
  { id: 'b21', categoryId: 'tools', name: 'Excalidraw', url: 'https://excalidraw.com', description: '手绘风格白板工具', icon: 'https://excalidraw.com/apple-touch-icon.png', sortOrder: 2 },
]

/** 可选的默认搜索引擎。 */
export const searchEngines = [
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', color: '#2932e1' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=', color: '#008373' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', color: '#4285f4' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=', color: '#24292f' },
  { id: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=', color: '#cb3837' },
]
