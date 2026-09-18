# Jerry 导航（jerry-tools）

个人网址导航 / 书签管理工具。**功能**参考 [dh.huhage.fun](https://dh.huhage.fun/) 实现，
**UI、动效、交互**沿用 [Jerry's Blog](https://jiepijiang.github.io/jerry-blog/) 的设计语言。

> **当前进度：第一版（纯前端）**
>
> 数据全部存在浏览器 `localStorage` 里，**没有后端**。因此登录、跨设备同步、
> 分享页这些依赖服务端的能力只在单机范围内生效，详见下方「数据层与已知限制」。

---

## 快速开始

```bash
npm install
npm run dev      # 开发预览 http://127.0.0.1:5174
npm run build    # 产出 dist/
npm run preview  # 预览构建产物
```

---

## 在线预览

- 线上：`https://jiepijiang.github.io/jerry-tools/`
- 博客入口：`https://jiepijiang.github.io/jerry-blog/`

### 部署说明

推送 `main` 即自动部署（GitHub Actions，见 `.github/workflows/deploy.yml`）。
Pages 的 source 必须是 **GitHub Actions**。

站点挂在 `/<仓库名>/` 子路径下，相关适配：

- `vite.config.js` 顶部常量 `REPO_NAME` —— **改仓库名时唯一需要动的地方**。
  build 时 `base = /jerry-tools/`，dev 仍为 `/`。
- `spaFallbackPlugin` 在 build 后把 `index.html` 复制成 `404.html`，做 SPA 深链回退。
  **代价：深链的 HTTP 状态码仍是 404**（页面能正常渲染）。若在意，可换
  `createHashHistory`，代价是 URL 变成 `/#/discover`。
- `src/utils/helpers.js` 的 `asset()` 助手统一加 `import.meta.env.BASE_URL` 前缀。
  **关键：Vite 只重写 index.html 和 CSS `url()` 里的绝对路径，
  JS 字符串里的 `/static/...` 不会被处理**，新增资源必须包 `asset()`。
- 路由用 `createWebHistory(import.meta.env.BASE_URL)`。

> 不要用 `vite preview` 验证子路径：它对所有路径都回退成 `index.html`
> （连 JS/CSS 请求都返回 `text/html`），会误报一堆 404。

---

## 功能清单

### 导航主页

- **分类树**：多级分类、侧栏筛选、拖拽排序、移动、增删改
- **书签卡片**：图标自动获取（favicon）/ 手填图标 URL / 上传本地图片（转 dataURL）
- **搜索**：本地书签实时匹配 + 5 种搜索引擎切换（百度 / Bing / Google / GitHub / npm），
  无匹配时回车直接用搜索引擎搜
- **三种布局**：网格（左栏 + 分组网格）/ 抽屉（分类手风琴）/ 极简（高密度列表）
- **三种卡片风格**：原始（毛玻璃）/ 柔和阴影（浮雕质感）/ 圆角方块（紧凑）
- **每行数量**：3 ~ 8 列可调
- **展示范围**：标准宽度 / 铺满屏幕
- **常用书签**：按访问次数排序，展示在搜索框下方（可关）
- **书签提示框**：悬停显示详情（可关）
- **编辑模式**：一键开关所有增删改入口

### 顶部信息栏

- 实时时钟 + 日期
- **农历**：完整历法换算（1900–2100），含闰月、24 节气、公历/农历节日
- **天气**：Open-Meteo 实况 + 温度区间，6 种天气动效（晴 / 多云 / 阴 / 雨 / 雪 / 雷暴），
  30 分钟缓存，可切换城市
- **便签**：随手记，支持增删改
- 语言切换（中 / 英）、10 套主题色、浅色/深色/跟随系统、设置面板、登录入口

### 发现页

- 377 个精选站点，12 个一级分类 + 二级分类
- 分类筛选、关键词搜索
- 四种排序：最近收录 / 浏览量 / 收藏数 / 我提交的
- 收藏、详情弹窗、直接访问
- 提交网站（走待审核流程）

### 用户系统（本地模拟）

- 注册 / 登录 / 退出、头像与昵称编辑
- 演示账号：`admin@jerry.tools` / `admin123`

### 管理后台

- 口令闸（默认口令 `jerry`，见 `src/composables/useAuth.js` 的 `ADMIN_PASSWORD`）
- 数据统计：站点数 / 用户数 / 书签数 / 分类数 / 浏览量 / 收藏数 / 待审核数
- 网站审核：通过 / 拒绝 / 删除、重复网址一键去重
- 用户管理：新建 / 编辑 / 删除、设为管理员、禁用、备注
- 图标管理：搜索、恢复自动图标
- 反馈：查看与回复

### 数据

- 导出书签（JSON）、导入浏览器书签（Chrome / Edge / Firefox 导出的 `.html`）
- 全量备份 / 恢复
- 清除分类 / 清除所有书签

---

## 数据层与已知限制

数据访问统一走 `src/data/storage.js` 里的适配器，当前实现是 `localStorage`。
所有方法都返回 Promise，接口固定为 `read / write / remove / readAll / writeAll`。

> ⚠️ 注意：接口抽象能省掉一部分工作，但**换 Supabase 并不是「只替换这个对象」**。
> 这里的接口是「整表读写」语义，而 Supabase 是行级操作，
> 所以 `useStore` 里约 20 个写函数仍需改成行级 CRUD。
> 完整的改造清单见下方「接 Supabase 的改造清单与难度评估」。

因此当前版本存在这些限制：

| 能力 | 现状 |
| --- | --- |
| 书签 / 分类 / 设置 | ✅ 完整可用，存本机 |
| 导入导出 / 备份恢复 | ✅ 完整可用 |
| 天气 / 农历 | ✅ 完整可用（走公开 API） |
| 登录注册 | ⚠️ 本地模拟，账号存在 localStorage，密码明文，**无任何安全性** |
| 跨设备同步 | ❌ 换浏览器/设备数据不共享 |
| 分享页 | ⚠️ 只能在同一个浏览器里预览，访客拿不到你的数据 |
| 网站提交审核 | ⚠️ 提交后进本地队列，只有你自己能看到 |

> 密码明文这件事是刻意的：这一版只用来跑通完整交互，**不要用真实密码注册**。

---

## 技术栈与目录

Vue 3 `<script setup>` + Vite 6 + vue-router 4，无 UI 框架、无 CSS 预处理器。

```
src/
├── components/          组件
│   ├── AppIcon.vue          图标（Lucide 风格描边，60+ 个）
│   ├── BookmarkCard.vue     书签卡片（3 种风格）
│   ├── BookmarkIcon.vue     站点图标（favicon + 渐变字母兜底）
│   ├── WeatherIcon.vue      天气动效图标
│   ├── TopBar.vue           顶部信息栏
│   ├── CategorySidebar.vue  分类侧栏
│   ├── MainSearchBar.vue    主搜索栏
│   ├── SearchOverlay.vue    全局搜索浮层（命令面板）
│   ├── SettingsPanel.vue    设置面板
│   ├── BookmarkDialog.vue   书签增改
│   ├── CategoryDialog.vue   分类增改
│   ├── ImportDialog.vue     导入浏览器书签
│   ├── NotesPopover.vue     便签
│   ├── Modal.vue            通用弹窗
│   └── ToastHost.vue        轻提示
├── composables/
│   ├── useStore.js      业务数据仓库（分类/书签/站点/收藏/便签/分享）
│   ├── useSettings.js   设置项 + 主题属性
│   ├── useAuth.js       用户系统（本地模拟）
│   ├── useClock.js      时钟 / 农历 / 天气
│   ├── useI18n.js       中英文案
│   └── useToast.js      轻提示队列
├── data/
│   ├── storage.js       数据适配层（localStorage 实现，可替换）
│   ├── seed.js          分类与书签种子数据
│   ├── seed-discover.js 发现页种子数据（377 条）
│   ├── themeColors.js   10 套主题色 / 12 套图标底色 / 6 套渐变
│   ├── options.js       设置项枚举与默认值
│   └── i18n.js          文案表
├── styles/
│   ├── root.css         主题变量（浅色/深色 × 10 主题色）
│   └── base.css         reset / 字体 / 滚动条 / 原子类
├── utils/
│   ├── helpers.js       通用工具（asset / 校验 / 文件 / 剪贴板）
│   └── lunar.js         农历 / 节气 / 节日
└── views/
    ├── HomeView.vue     导航主页
    ├── DiscoverView.vue 发现页
    ├── AdminView.vue    管理后台
    ├── LoginView.vue    登录 / 注册 / 资料
    └── ShareView.vue    分享页
```

### 视觉语言

移植自 Jerry's Blog：

- 毛玻璃卡片：`backdrop-filter: blur(var(--back_filter))` + 半透明底
- 悬停上浮 `translateY(-2px)` + 阴影；按下 `scale(0.94)`
- 字体 Ubuntu（正文）/ Pacifico（标题）
- 深色主题沿用 blog 的背景图 + `19px` 模糊

与 blog 的差异：blog 只有一套深色毛玻璃，这里补齐了**浅色**变量，
并加了 **10 套主题色**（青碧 / 靛蓝 / 玫红 / 琥珀 / 紫罗兰 / 翡翠 / 石墨 / 珊瑚 / 樱粉 / 天青），
深浅两套各自有独立的亮度值。

---

## 换掉演示数据

改这几个文件即可，不用动组件：

| 想改什么 | 改哪里 |
| --- | --- |
| 分类与书签 | 直接在界面里编辑（编辑模式），或改 `src/data/seed.js` 后清空 localStorage |
| 发现页站点 | `src/data/seed-discover.js` |
| 主题色 / 图标配色 | `src/data/themeColors.js` + `src/styles/root.css` |
| 文案 | `src/data/i18n.js` |
| 站名 / 图标 | `index.html` 的 `<title>` 与 meta、`src/data/i18n.js` 的 `app.name` |

> 清空数据重来：浏览器控制台执行 `Object.keys(localStorage).filter(k => k.startsWith('jt:')).forEach(k => localStorage.removeItem(k))`，然后刷新。

---

## 参考来源与声明

- **功能参考**：[dh.huhage.fun](https://dh.huhage.fun/)（呼哈导航）。本项目的功能范围、
  交互流程、设置项命名对齐该站。
- **视觉参考**：[Jerry's Blog](https://jiepijiang.github.io/jerry-blog/)。

发现页的 377 条站点数据来自参考站的公开收录内容，**已剔除无法访问的链接**
（详见下方）。若这些数据涉及你的权益，请告知，我会立即移除。

### 已剔除的链接

参考站默认书签里的 2 条、发现页里的 6 条，实测无法正常访问，已从种子数据中移除：

| 站点 | 原因 |
| --- | --- |
| ChatGPT | OpenAI 拦截代理/VPN 出口，实测 403 |
| Claude | App unavailable in region |
| tome.app | 404 |
| neptune.ai | 证书过期 |
| copilot.microsoft.com | 区域不可达 |
| play.ht | 连接被关闭 |
| www.aitoolhunt.com | 522 源站超时 |
| Atlassian Intelligence | 404 |

> 说明：一批站点返回 403（Stack Overflow、npm、Coolors、Midjourney、Perplexity 等），
> 那是 Cloudflare 的机器人拦截，**真实浏览器可以正常打开，所以予以保留**。

---

## 接 Supabase 的改造清单与难度评估

当前是纯前端 + localStorage 的 mock 实现。数据层的接口已经按「可替换」设计
（`src/data/storage.js` 全部返回 Promise），但真正换成 Supabase 时，
**只改适配器是不够的** —— 核心偏差在「整表读写」vs「行级 CRUD」。

### 改造清单

| # | 模块 | 要做什么 | 改动量 | 难度 |
| --- | --- | --- | --- | --- |
| 1 | 建表 | 13 张表 + 1 个视图，字段可对照参考站的 schema | 一次性 SQL | ★★☆ |
| 2 | RLS 策略 | 每张表都要写「谁能读、谁能写」，是**最容易踩坑的一环** | 一次性 SQL | ★★★ |
| 3 | 数据适配层 | 新增 `supabaseAdapter` 实现同一组接口 | 1 个新文件 | ★☆☆ |
| 4 | `useStore` 写操作 | 约 20 个函数，从「改数组 + 整体落盘」改成行级 CRUD | 全量重写 | ★★★ |
| 5 | 认证 | `useAuth.js` 换成 `supabase.auth`（现在是本地模拟、密码明文） | 1 个文件重写 | ★☆☆ |
| 6 | 多端同步 | 用 `supabase.channel()` 订阅表变更，替换现在的单例 reactive | 新增 | ★★☆ |
| 7 | 图标存储 | 上传的头像/图标改走 Storage（现在存 base64 在 localStorage） | 新增 | ★☆☆ |
| 8 | 浏览量计数 | 写一个 `increment_discover_site_views` SQL 函数（参考站就有） | 1 个函数 | ★☆☆ |
| 9 | 管理后台权限 | 从本地口令改成 `profiles.role = 'admin'` 判断 | 改判断逻辑 | ★★☆ |
| 10 | 分享页 | `/s/:slug` 从「读本机数据」改成按 slug 查公开快照 | 1 个视图 | ★☆☆ |

### 总体判断

**中等难度。** 工作量的大头在 2（RLS）和 4（写操作改行级），
其余都有现成方案或参考实现。参考站的表结构已经摸清，省掉了设计 schema 的时间。

三个要提前知道的坑：

1. **RLS 写错的代价很高**。策略太松 → 别人能改你的数据；太紧 → 前端「读得到、写不了」，
   而且报错信息很含糊（多半是 `new row violates row-level security policy`）。
   建议每加一张表就单独验证一次读写。
2. **国内直连 `*.supabase.co` 不稳定**。参考站本身在国内访问就很慢。
   如果目标用户在国内，要么自建 Postgres + PostgREST，要么换到国内可用的 BaaS。
   这一条会直接影响方案选型，建议**先验证连通性再动手**。
3. **免费版项目 7 天无活动会被暂停**，恢复要手动点。

### 建议的第一步

先不动前端：用 Supabase 控制台建 `bookmarks` + `categories` 两张表，
用 curl / SDK 把「列表 + 新增 + 删除」三条路径跑通，确认 RLS 和网络都 OK，
再决定要不要全量迁移。这样最坏情况只损失半天。

---

## 待办

- [ ] 接 Supabase：账号体系、跨设备同步、分享页、网站审核真正落库（见上方评估）
- [ ] 书签排序支持跨分类拖拽的视觉反馈（当前是落下才生效）
- [ ] 图标可选的「自动抓取」目前只回退到站点自己的 `/favicon.ico`，
      覆盖率约 57%。想要更高覆盖率需要自建一个抓取 `<link rel="icon">` 的代理服务
      （浏览器端受 CORS 限制做不了）
- [ ] 发现页接入真实浏览量与收藏数
