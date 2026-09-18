/* =========================================================================
   导航主页的种子数据
   -------------------------------------------------------------------------
   分类与书签取自参考站 dh.huhage.fun 的内置默认数据（6 分类 / 21 书签），
   已剔除无法访问的 2 条：
     - ChatGPT  （OpenAI 拦截代理/VPN 出口，实测 403）
     - Claude   （App unavailable in region）
   其余 19 条全部实测可访问（Cloudflare 反爬拦截不算失效）。
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
  { id: 'b1', categoryId: 'dev', name: 'GitHub', url: 'https://github.com', description: '全球最大的代码托管平台', sortOrder: 0 },
  { id: 'b2', categoryId: 'dev', name: 'VS Code', url: 'https://code.visualstudio.com', description: '轻量级代码编辑器', sortOrder: 1 },
  { id: 'b3', categoryId: 'dev', name: 'Stack Overflow', url: 'https://stackoverflow.com', description: '开发者问答社区', sortOrder: 2 },
  { id: 'b4', categoryId: 'dev', name: 'MDN Web Docs', url: 'https://developer.mozilla.org', description: 'Web 技术权威文档', sortOrder: 3 },
  { id: 'b5', categoryId: 'dev', name: 'npm', url: 'https://www.npmjs.com', description: 'Node.js 包管理器', sortOrder: 4 },

  { id: 'b6', categoryId: 'design', name: 'Figma', url: 'https://www.figma.com', description: '在线协作设计工具', sortOrder: 0 },
  { id: 'b7', categoryId: 'design', name: 'Dribbble', url: 'https://dribbble.com', description: '设计师灵感社区', sortOrder: 1 },
  { id: 'b8', categoryId: 'design', name: 'Unsplash', url: 'https://unsplash.com', description: '免费高清图片素材', sortOrder: 2 },
  { id: 'b9', categoryId: 'design', name: 'Coolors', url: 'https://coolors.co', description: '配色方案生成器', sortOrder: 3 },

  { id: 'b10', categoryId: 'ai', name: 'Perplexity', url: 'https://www.perplexity.ai', description: 'AI 搜索引擎', sortOrder: 0 },
  { id: 'b11', categoryId: 'ai', name: 'Midjourney', url: 'https://www.midjourney.com', description: 'AI 图像生成', sortOrder: 1 },
  { id: 'b12', categoryId: 'ai', name: 'Hugging Face', url: 'https://huggingface.co', description: '开源模型与数据集社区', sortOrder: 2 },
  { id: 'b13', categoryId: 'ai', name: 'Ollama', url: 'https://ollama.com', description: '本地大模型运行工具', sortOrder: 3 },

  { id: 'b14', categoryId: 'media', name: 'YouTube', url: 'https://www.youtube.com', description: '全球视频分享平台', sortOrder: 0 },
  { id: 'b15', categoryId: 'media', name: '哔哩哔哩', url: 'https://www.bilibili.com', description: '年轻人的视频社区', sortOrder: 1 },
  { id: 'b16', categoryId: 'media', name: 'Spotify', url: 'https://www.spotify.com', description: '在线音乐流媒体', sortOrder: 2 },

  { id: 'b17', categoryId: 'learn', name: '掘金', url: 'https://juejin.cn', description: '开发者技术社区', sortOrder: 0 },
  { id: 'b18', categoryId: 'learn', name: 'Coursera', url: 'https://www.coursera.org', description: '在线学习平台', sortOrder: 1 },

  { id: 'b19', categoryId: 'tools', name: 'Notion', url: 'https://www.notion.so', description: '全能笔记与协作工具', sortOrder: 0 },
  { id: 'b20', categoryId: 'tools', name: 'Todoist', url: 'https://todoist.com', description: '任务管理工具', sortOrder: 1 },
  { id: 'b21', categoryId: 'tools', name: 'Excalidraw', url: 'https://excalidraw.com', description: '手绘风格白板工具', sortOrder: 2 },
]

/** 可选的默认搜索引擎。 */
export const searchEngines = [
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=', color: '#2932e1' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=', color: '#008373' },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=', color: '#4285f4' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=', color: '#24292f' },
  { id: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=', color: '#cb3837' },
]
