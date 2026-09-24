# Jerry 导航（jerry-tools）

个人网址导航 / 书签管理工具。**功能**参考 [dh.huhage.fun](https://dh.huhage.fun/) 实现，
**UI、动效、交互**沿用 [Jerry Site](https://jiepijiang.github.io/jerry-site/) 的设计语言。

> **当前进度：已接入 Supabase 后端（可选）**
>
> 数据层有**两个可切换的适配器**：`localStorage`（默认）与 Supabase。
> 没配环境变量时应用照常跑在纯本地模式；配了之后登录即切到云端，
> 账号、跨设备同步、分享页、网站审核全部真正落库。
>
> 后端相关的所有东西（建表 / 迁移 / 种子 / 验证）都在 `supabase/`，
> 操作手册见 [`supabase/README.md`](./supabase/README.md)。

---

## 快速开始

```bash
npm install
npm run dev      # 开发预览 http://127.0.0.1:5174
npm run build    # 产出 dist/
npm run preview  # 预览构建产物
```

**不配后端也能跑** —— 开箱即用，数据存浏览器 `localStorage`。

想启用账号体系 / 跨设备同步 / 分享页，再补一步：

```bash
cp .env.example .env.local   # 填 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY
```

建表、灌种子、验证的完整步骤见 [`supabase/README.md`](./supabase/README.md)。

> `VITE_*` 是**构建期静态替换**，不是运行时读取 —— 改完 `.env.local`
> 必须重启 dev server 或重新 build 才生效。
>
> CI 里这两个值用 **Repository Variables**（不是 Secrets）注入。
> `anon` key 本来就要打包进前端发给浏览器，不是秘密；
> 真正的秘密是 `service_role` key，那个**绝不能**进前端或工作流。

---

## 在线预览

- 线上：`https://jiepijiang.github.io/jerry-tools/`
- 个人门户入口：`https://jiepijiang.github.io/jerry-site/`

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
- **三种卡片风格**：原始（毛玻璃）/ 柔和阴影（浮雕质感）/ 圆角方块（图标居中竖排）
- **三种书签排列**：正常（名称 + 简介）/ 紧凑（只显示名称）/ 图标（只显示图标，自动密排）
- **每行数量**：3 ~ 8 列可调
- **展示范围**：标准宽度 / 铺满屏幕
- **常用书签**：按访问次数排序，展示在搜索框下方（可关）
- **书签提示框**：悬停显示详情（可关）
- **编辑模式**：一键开关所有增删改入口

### 顶部信息栏

- 实时时钟 + 日期
- **农历**：完整历法换算（1900–2100），含闰月、24 节气、公历/农历节日
- **天气**：Open-Meteo 实况 + 温度区间，6 种天气动效（晴 / 多云 / 阴 / 雨 / 雪 / 雷暴），
  30 分钟缓存
- **定位**：首次进入请求浏览器定位授权，按所在城市显示天气；被拒 / 超时自动回落到手填城市。
  设置面板可切换「自动定位 / 手动指定」，也可单独换城市
- **便签**：随手记，支持增删改
- 语言切换（中 / 英）、10 套主题色、浅色/深色/跟随系统、设置面板、登录入口

### 发现页

- 377 个精选站点，12 个一级分类 + 二级分类
- 分类筛选、关键词搜索
- 四种排序：最近收录 / 浏览量 / 收藏数 / 我提交的
- 收藏、详情弹窗、直接访问
- 提交网站（走待审核流程）
- **浏览量与收藏数都是真实数据**：浏览量走 `increment_discover_site_views` RPC，
  收藏数由 `favorites` 上的触发器维护（见下方「收藏数是怎么算的」）。
  两者都是「**种子基数 + 真实累加**」—— 种子那 377 条来自参考站的热度数据，
  清零会让「按收藏排序」退化成一堆 0

### 用户系统

- 注册 / 登录 / 退出、头像与昵称编辑
- **双模**：没配 Supabase 时是本地模拟（演示账号 `admin@jerry.tools` / `admin123`）；
  配了之后走真正的 Supabase Auth，密码不再明文存储
- 首次登录时会把本机的书签/分类**迁移到云端**，但**云端已有数据时绝不覆盖**
  （多设备场景下那是灾难）
- **实时多端同步**：登录后订阅自己的表，另一台设备的改动**不用刷新**就出现。
  顶栏头像右下角有个状态点（绿=已连接 / 黄=连接中 / 红=断开），
  点开有文字说明。**本项目已经跑过 `supabase/migrations/003-realtime.sql`**；
  换新库或老库升级时要单独跑一次，见下方专节

### 管理后台

- 口令闸（默认口令 `jerry`，见 `src/composables/useAuth.js` 的 `ADMIN_PASSWORD`）
- 数据统计：站点数 / 用户数 / 书签数 / 分类数 / 浏览量 / 收藏数 / 待审核数
- 网站审核：通过 / 拒绝 / 删除、重复网址一键去重
- 用户管理：新建 / 编辑 / 删除、设为管理员、禁用、备注
- 图标管理：独立路由 `/icon-management`（对齐参考站），搜索、上传本地图片、
  粘贴图标地址、恢复自动图标；后台里也有入口按钮
- 反馈：查看与回复

### 数据

- 导出书签（JSON）、导入浏览器书签（Chrome / Edge / Firefox 导出的 `.html`）
- 全量备份 / 恢复
- 清除分类 / 清除所有书签
- 上传本机数据到云端（仅登录后可见）—— 见「[本机数据怎么进云端](#本机数据怎么进云端)」

---

## 数据层与已知限制

数据访问统一走 `src/data/storage.js`。它现在是个**路由层**：
对外暴露同一组方法（`read / write / remove / readAll / writeAll`，全部返回 Promise），
内部指向 `localStorage` 或 Supabase 两个适配器之一。

```js
import { storage, useCloudStorage, useLocalStorage } from '@/data/storage'
```

启动顺序**不能换**（`src/main.js`）：

1. `initSettings()` —— 主题属性要尽早写到 `<html>`，避免闪白
2. `initAuth()` —— 恢复已有会话；已登录的话会把适配器切到云端
3. `initStore()` —— 上一步已经加载过就跳过

因为第 2 步可能换掉适配器，第 3 步必须在其之后。反过来的话，
云端用户第一次登录时，种子数据会先写进本机，然后才轮到迁移。

### 从「整表覆盖写」到行级 diff

原来的接口是「整表读写」语义，而 Supabase 是行级操作。上一版 README 预计
`useStore` 里约 20 个写函数要全量重写 —— 实际**一行没改**。

做法是在 `src/data/adapters/cloud.js` 里加了一层翻译：适配器拿本次的新值和
**上次从云端读到的快照**做 diff，只 upsert 变了的行、只 delete 消失的行。
上层仍然写「整表」，语义不变。

> ⚠️ diff **依赖读过的快照**。没读过就先补一次 read，否则会把整表当成「全是新增」。

### 能力对照

| 能力 | 本地模式 | 云端模式（配了 Supabase） |
| --- | --- | --- |
| 书签 / 分类 / 设置 | ✅ 存本机 | ✅ 落库，跨设备同步 |
| 导入导出 / 备份恢复 | ✅ | ✅ |
| 天气 / 农历 | ✅ 走公开 API | ✅ 同左 |
| 登录注册 | ⚠️ 本地模拟，账号存 localStorage，密码明文，**无任何安全性** | ✅ 真 Supabase Auth |
| 跨设备同步 | ❌ | ✅ |
| 分享页 | ⚠️ 只能在同一个浏览器里预览 | ✅ 匿名访客可访问 `/s/:slug` |
| 网站提交审核 | ⚠️ 只进本地队列 | ✅ 落库，管理员可审 |

> 本地模式的密码明文是刻意的：它只用来跑通完整交互，**不要用真实密码注册**。

云端模式下有三个前端**做不到**的事，都有明确降级：

- **管理员不能创建用户** —— 需要 `service_role` key，那个 key 绝不能进浏览器。
- **管理员删除用户降级成「禁用」** —— 删 auth 账号同样需要 `service_role`。
- **发现页站点普通用户改不了** —— 它是全局表，只有 admin 能写；
  浏览量走 `increment_discover_site_views` 这个 RPC，人人可用。

详见 [`supabase/README.md`](./supabase/README.md) 的「已知限制」。

> **有一条书签依赖浏览器能力**：「开发工具 → 串口助手」指向
> [AetherPort](https://serial.xywml.com/)（原站站长本人的作品），
> 它基于 **Web Serial API**，**只有 Chromium 系（Chrome / Edge）能打开串口**，
> Safari 和 Firefox 不支持；并且必须走 HTTPS 或 localhost。
>
> 这条提示**刻意没有写进卡片描述**：`.bm-desc` 是固定宽度 + `white-space:nowrap`
> + `text-overflow:ellipsis`，**可用宽度只有 127px**，而现有文案
> 「在线串口调试与固件升级」已经占 126.5px —— 加任何后缀
> （「· 需 Chrome」163px、「（仅 Chrome/Edge）」221px）都会被**静默截断成「…」**。
> 哪天把 `.bm-desc` 改成允许两行，再考虑挪进卡片。

---

## 技术栈与目录

Vue 3 `<script setup>` + Vite 6 + vue-router 4，无 UI 框架、无 CSS 预处理器。

```
src/
├── App.vue              根组件（主题属性 / 全局壳）
├── main.js              入口（初始化顺序 settings → auth → store，不能换）
├── router/
│   └── index.js         路由表（含 /s/:slug 分享页）
├── components/          组件
│   ├── AppIcon.vue          图标（Lucide 风格描边，83 个）
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
│   ├── useAuth.js       用户系统（本地模拟 / Supabase Auth 双模）
│   ├── useRealtime.js   实时多端同步（postgres_changes 订阅 + 幂等应用 + 重连重读）
│   ├── useClock.js      时钟 / 农历 / 天气
│   ├── useI18n.js       中英文案
│   └── useToast.js      轻提示队列
├── data/
│   ├── storage.js       数据适配层：路由 + localStorage 实现 + 转发对象
│   ├── supabase.js      Supabase 客户端单例（未配置时导出 null）
│   ├── adapters/
│   │   └── cloud.js         Supabase 适配器（整表写 → 行级 diff 的翻译层）
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
│   ├── geo.js           地名归一（繁→简、从反查结果里挑城市名）
│   └── lunar.js         农历 / 节气 / 节日
└── views/
    ├── HomeView.vue     导航主页
    ├── DiscoverView.vue 发现页
    ├── AdminView.vue    管理后台
    ├── IconManagementView.vue  图标管理（独立路由）
    ├── LoginView.vue    登录 / 注册 / 资料
    └── ShareView.vue    分享页

supabase/                后端（建表 / 迁移 / 种子 / 验证），操作手册见其中的 README
├── README.md            后端操作手册（建表 / 迁移 / 灌种子 / 验证 / 已知限制）
├── schema.sql           全量建表脚本（11 表 / 5 函数 / 4 触发器 / 23 策略 + realtime 发布）
├── migrations/          增量迁移（001 复合主键 / 002 分享后缀唯一 / 003 realtime 发布）
├── seed-discover.mjs    灌 377 条发现页种子（幂等）
└── verify-rls.mjs       RLS 隔离性验证（45 条成对断言）
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

## 与参考站的已知差异

功能与交互对齐 [dh.huhage.fun](https://dh.huhage.fun/)，以下几处是**有意偏离**，
都是实测参考站行为有缺陷、或需要额外开关的地方：

### 天气定位

| # | 参考站行为 | 这里的行为 | 原因 |
| --- | --- | --- | --- |
| 1 | 城市名取 `locality`（区级），且**不做繁简归一**，会显示「黃浦區」 | 取 `city`（市级）并做繁→简归一，显示「上海市」 | 参考站自己有个 `HE()` 转换表，但只收了 机/龙/区/县/镇/乡/驿 几个字，`黃浦區` 过完还是 `黃浦区`。见 `src/utils/geo.js` |
| 2 | 定位失败**静默**回落北京，用户不知道发生了什么 | 回落手填城市，**顶栏天气卡片直接标出「未定位」**、首次进入弹一次说明、点卡片直接跳到设置的「天气与定位」分区；设置面板里显示具体原因（权限被拒 / 无法获取位置 / 超时 / 不支持） | 静默失败时用户会把默认城市（北京）的天气当成本地天气 |
| 3 | 没有关闭自动定位的入口 | 设置面板可切「自动定位 / 手动指定」（`settings.useGeolocation`） | 不想被要权限的用户需要出口 |
| 4 | 手填城市与「是否用定位」是两个互不影响的开关 | 保存手填城市会**同时**切到手动指定 | 否则会出现「滑块显示自动定位、实际却在用手填城市」的错位 |
| 5 | 每次进入都无脑请求定位 | 先用 `navigator.permissions.query({name:'geolocation'})` 预判：已明确被拒就不再发请求，直接走回落 | 那次调用注定立刻失败，只会往 console 刷报错 |

天气来源用 `weather.source` 显式记录（`location` / `manual` / `default`），
`default` 表示「谁都没给，落到了内置默认城市」，UI 必须把它和真实位置区分开。

其余定位逻辑与参考站一致：10s 超时、`enableHighAccuracy: false`、
5 分钟 `maximumAge`、手选过城市就不再定位、有坐标缓存先渲染再刷新。

> 浏览器定位要求**安全上下文**：必须是 HTTPS 或 `localhost` / `127.0.0.1`。
> GitHub Pages 是 HTTPS，满足条件；用 `file://` 直接打开 dist 则不会弹窗。

### 其它

- **悬停提示框不用 `.glass`**：提示框是浮在分类标题上方的，`.glass` 的 62% 半透明底
  会让底下的「开发工具」透上来和网址叠在一起，网址直接读不清。改用独立变量
  `--tip_bg_color`（浅色 0.97 / 深色 0.97 的炭灰），见 `src/styles/root.css`。
- **图标管理**做成独立路由 `/icon-management`（与参考站一致），但管理后台里额外留了一个入口按钮。
- 补上了 `spaFallbackPlugin` 从 `configResolved` 取 `build.outDir`（参考站没有这个问题，
  但本项目早期版本把 `dist` 写死，用 `vite build --outDir` 时 `404.html` 会落错目录）。

---

## 换掉演示数据

改这几个文件即可，不用动组件：

| 想改什么 | 改哪里 |
| --- | --- |
| 分类与书签 | 直接在界面里编辑（编辑模式），或改 `src/data/seed.js` |
| 发现页站点 | `src/data/seed-discover.js` |
| 主题色 / 图标配色 | `src/data/themeColors.js` + `src/styles/root.css` |
| 文案 | `src/data/i18n.js` |
| 站名 / 图标 | `index.html` 的 `<title>` 与 meta、`src/data/i18n.js` 的 `app.name` |

### 改种子数据时**必须同步升版本号**

种子只在 **localStorage 为空**时灌进去。所以光改 `src/data/seed.js`，
老用户（包括你自己 —— 浏览器里早就有数据了）**永远看不到新条目**，
表现是「代码改了、部署也成功了，但打开还是老样子」，特别容易误判成没部署成功。

正确做法是两步：

1. 改 `src/data/seed.js` 加条目（用一个新的、没被占用的 id）
2. 在 `src/composables/useStore.js` 里 `SEED_VERSION` **+1**，
   并把新 id 登记到 `SEED_ADDITIONS`

```js
const SEED_VERSION = 3

const SEED_ADDITIONS = {
  2: { bookmarks: ['b22'] },
  3: { bookmarks: ['b23', 'b24'] },   // ← 新的一版
}
```

启动时 `syncSeedAdditions()` 会把登记过的 id 补进已有数据，**只增不删**。

> ⚠️ 迁移**只补 `SEED_ADDITIONS` 里列出的 id**，不要写成「补所有缺失的 id」——
> 那样会把用户自己删掉的条目复活（他删了 GitHub，下次打开又回来了）。
> 验收脚本里专门有一条测这个，见 `/tmp` 的 `verify-serial.mjs` 场景 D。

> 清空数据重来：浏览器控制台执行 `Object.keys(localStorage).filter(k => k.startsWith('jt:')).forEach(k => localStorage.removeItem(k))`，然后刷新。

---

## 参考来源与声明

- **功能参考**：[dh.huhage.fun](https://dh.huhage.fun/)（呼哈导航）。本项目的功能范围、
  交互流程、设置项命名对齐该站。
- **视觉参考**：[Jerry Site](https://jiepijiang.github.io/jerry-site/)
  （原名 jerry-blog，2026-09 改名）。

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

## Supabase 接入记录（已完成）

后端已经接完，操作手册在 [`supabase/README.md`](./supabase/README.md)。
这里只记「当初的评估 vs 实际做下来」的差异，给以后类似改造留个参照。

### 原评估清单 vs 实际

| # | 模块 | 原评估 | 实际 |
| --- | --- | --- | --- |
| 1 | 建表 | 13 表 + 1 视图 | **11 表**，没有视图（分享页改用函数，见下） |
| 2 | RLS 策略 | ★★★ 最容易踩坑 | ★★★ **判断对了**，见下方三个坑 |
| 3 | 数据适配层 | 1 个新文件 | ✅ 一个 `cloud.js` |
| 4 | `useStore` 写操作 | **全量重写（约 20 个函数）** | ❌ **评估错了** —— 一行没改 |
| 5 | 认证 | 1 个文件重写 | ✅ `useAuth.js` |
| 6 | 多端同步 | `supabase.channel()` 订阅 | ✅ 做了 —— `useRealtime.js` + `migrations/003` |
| 7 | 图标存储 | 改走 Storage | ⏸ **没做**（当前仍存 base64 / URL） |
| 8 | 浏览量计数 | 1 个 SQL 函数 | ✅ `increment_discover_site_views` |
| 9 | 管理后台权限 | 改判断逻辑 | ✅ 走 `profiles.role` |
| 10 | 分享页 | 1 个视图 | ⚠️ **改成函数**（理由见下） |

**第 4 项为什么评估错了**：原评估假设「接口是整表语义 → 上层必须改成行级」。
实际上在适配器里加一层 diff 就够了 —— 上层继续写整表，适配器负责算增量。
省下的不是小工作量，是整个 `useStore`（评估时 562 行，现已 622 行）的改动风险。

**第 10 项为什么不能用视图**：用视图就得给 `categories` / `bookmarks`
开一条「anon 可读」的策略 —— 那是把**所有用户**的书签都暴露出去。
`SECURITY DEFINER` 函数可以精确地只放行「显式开启了分享的那个 slug」。

### 实际踩到的三个坑

1. **RLS 报错会误导方向。** 现象是「第一个用户一切正常，第二个用户永远写不进去」，
   报 `403 new row violates row-level security policy (USING expression)`。
   看起来是策略写错了，**实际是主键设计错了** —— 私有表用 `id` 单列做主键时，
   两个用户跑同一份种子（id 都是 `dev`）会撞上别人的行，RLS 的 `USING` 判假。
   改成 `(user_id, id)` 才对。
   判断技巧：`403` 意味着带了有效 JWT、只是行不可见；纯匿名是 `401`。

2. **原评估漏了「默认值撞唯一约束」这一整类。**
   除了上面的主键，`share_settings.slug` 也踩了同一个坑：
   前端默认 `slug: ''`，而库里的唯一约束是全量的 ——
   第二个用户在设置面板点一下「开启分享」就报 23505。
   修法是部分唯一索引 `where slug <> ''`。

3. **验证脚本的测试数据不真实，测试就是假的。**
   原来的 RLS 脚本用随机 id（`bm_test_a_<时间戳>`），两个用户天然不撞，
   所以上面两个坑**一个都没抓到**。现在的验证脚本专门用
   两个用户共用的固定值（`dev` / `b1` / 空 slug）来覆盖。

### 关于连通性（原评估的坑 #2）

原评估说「国内直连 `*.supabase.co` 不稳定，建议先验证连通性再动手」。
实测**直连和走代理都通**（直连 401 / 1.03s，走 Clash 7897 401 / 0.93s），
所以没有走「自建 Postgres + PostgREST」那条备选路线。
不过这条建议本身是对的 —— 它把「最坏情况损失半天」压到了几分钟。

### 没做的

- **图标改走 Storage**：上传的图标仍以 base64 存在库里。
  图标一般只有几 KB，暂时不值得为它引入 Storage 的权限模型。
- **发现页的浏览 / 收藏数不做实时**：`discover_sites` 是全局表，`views` 每次点击都变，
  订阅它等于给所有在线设备广播每一次点击。需要时刷新即可。
  （**同一账号的另一台设备**不算 —— 那边走 `favorites` 的实时事件补计数，
  见下方「收藏数是怎么算的」。**别人**的收藏仍然要等下次全量读。）
- **发送确认邮件**：默认 SMTP 限流很严，索性关掉了邮箱确认
  （`mailer_autoconfirm: true`）。要发邮件得自备 SMTP。

---

## 本机数据怎么进云端

书签存在哪儿，取决于**导入那一刻有没有登录**：

| 什么时候导入 | 落在哪 |
| --- | --- |
| 未登录 | 只在本机 `localStorage`（`jt:categories` / `jt:bookmarks` / `jt:notes`） |
| 已登录 | 直接写进云端，没有额外步骤 |

所以「之前导入的书签怎么同步上去」分两种情况：

### 一、登录时自动搬（云端还是空的）

登录 / 注册 / 恢复会话都会走 `enterCloudMode()`，它在切换适配器之后、
`reloadStore()` 之前调一次 `transferLocalToCloud('fill')`：

- 先**直接查云端**判断是不是空的（不能看 `state` —— 那一刻它还是空的，
  或者装的是本机那份，拿它当「云端非空」是循环论证）；
- 云端为空 → 把本机的分类 / 书签 / 便签搬上去；
- **云端已有数据 → 整体跳过**，一条都不动（多设备下自动覆盖是灾难）。

顺序很关键：必须在第一次 `reloadStore()` 之前。反过来的话
`reloadStore` 里的 `seedIfEmpty` 会先往空云端灌一套种子，
迁移就判定「云端非空」跳过了 —— 用户自己的书签永远上不去，看到的全是默认种子。

### 二、手动「上传本机数据」（云端已有数据时）

自动迁移只在云端为空时触发，所以下面这条路径**它管不着**：

> 先登录过（云端有了数据）→ 退出登录 → 在未登录状态下导入了一份书签
> → 再登录 → 自动迁移跳过 → 那份导入永远留在本机。

为此设置面板「数据备份」里有一个 **上传本机数据** 按钮（**仅登录后可见**），
点它走 `pushLocalToCloud()` → `transferLocalToCloud('merge')`：

- **并集合并，只补不删**。云端已有的保留，本机独有的补上；
- 书签按 **URL** 去重（与导入去重同一个 `helpers.bookmarkKey` 口径）——
  按 id 去重会让同一个网址在云端凭空多一份，因为本机导入的条目
  id 是各自 `uid()` 生成的，两边对不上；
- 分类按 id 去重，冲突时**保留云端**那份（本机的可能是旧的）；
- 幂等：再点一次会提示「本机没有可上传的新数据」。

想「用本机的覆盖云端」的话：先点「清除所有书签」清空云端，
再点上传。本机那份不受影响（云端模式下写的是云端）。

### 导出 / 恢复的键名（踩过的坑）

「导出书签」产出的是 `{ categories: [...], bookmarks: [...] }` —— **没有 `jt:` 前缀**，
因为这份文件是给人看、也给别的工具吃的。而两个适配器的 `writeAll` 按
`storageKeys`（`jt:categories`）匹配，于是原来「导出 → 恢复」这条链是**坏的**：

- 本地模式下 `writeAll` 会**先清空所有业务键再写**，一个键都匹配不上 →
  **清空 + 什么都不写**。点一次「恢复」就丢光数据。
- 云端模式下不删数据，但**静默什么都不做** —— 提示「恢复完成」，数据没变。

现在 `writeAll` 会先过一遍 `normalizeSnapshot()`（`src/data/transfer.js`）：
键名归一化（两种写法都认）、**只动快照里出现的键**、一个键都认不出就
**返回 `false` 且一个字节都不动**，由调用方提示失败。

---

## 图标从哪来

书签 / 站点图标有**三层**，按顺序落：

| 层 | 来源 | 什么时候用 |
| --- | --- | --- |
| 1 | 数据里的 `icon` 字段 | 用户自己粘的地址、上传的图片（转 dataURL） |
| 2 | `https://<origin>/favicon.ico` | 第 1 层没有、或**第 1 层不合格被挡下** |
| 3 | 渐变底 + 首字母 | 第 2 层也加载失败（`BookmarkIcon` 的 `@error`） |

**入口只有一个**：`utils/helpers.js` 的 `faviconOf(url, custom)`。

### 为什么要有「不合格」这一说

`icon` 是用户可填的字段，填进来的东西不能直接丢给 `<img>`：

- **第三方 favicon 服务**（`icons.duckduckgo.com`、`icon.horse`、`t0-t3.gstatic.com`、
  `google.com/s2/favicons` …）—— 国内不可达，批量请求会被限流，一挂挂一整页。
  这个项目从一开始就定的策略是**一个都不用**，走站点自己的 `/favicon.ico`。
- **明文 `http://`** —— HTTPS 页面上是 Mixed Content，控制台留警告，图片还可能被浏览器直接拦掉。

`isUsableIcon()` 判这两类，`isThirdPartyIcon()` 只判第一类（管理页要分开报）。

⚠️ **`www.gstatic.com` 不在黑名单里** —— 那是 Google 自家站点的静态资源
（AI Studio / Firebase / TensorFlow 的图标都从那儿发），是「站点自己的 CDN」。
同理 `cdn.prod.website-files.com`（Webflow 托管）、`images.squarespace-cdn.com`、
`img.alicdn.com` 也都是站点自己在用的，不能整域名拉黑。
真正的 favicon 服务是 `t0-t3.gstatic.com/faviconV2`，以及 `google.com/s2/favicons`
这种 **host 太宽、得按路径判**的（`isThirdPartyIcon` 里为此单列了一张
`THIRD_PARTY_ICON_PATHS` 表）。

### 三个容易踩的地方

1. **调用点必须写 `faviconOf(url, icon)`，不能写 `icon || faviconOf(url)`。**
   后者在 `icon` 非空时直接把整个函数绕过去了 —— 兜底逻辑一行都不执行，
   上面那套过滤等于白写。这个项目里 12 个渲染点全部统一成前者。
2. **数据问题要报出来，不能藏。** 图标管理页单列一个「已忽略 N」的 chip，
   而不是从「自定义 N」里扣掉 —— 扣掉的话管理员看到「自定义 0」，
   根本不知道库里躺着几十条用不了的地址。颜色走 `--warning` / `--warning_text`，
   深色主题自动切。
3. **协议相对地址 `//host/x` 不算站内路径。** `isUsableIcon` 里判站内用的是
   `s.startsWith('/') && !s.startsWith('//')` —— 少了后半句，外链会被当成相对路径放行。

种子数据里那 37 条不合格的 `icon` 也一并清掉了（见「待办」里那条），
但**渲染层这层过滤才是保险**：线上库那份改不动（要 `service_role`），
用户自己粘的地址更没人管。

回归脚本（都在 `/tmp`，不入仓库，跟 `transfer-*.mjs` 一套）：

| 脚本 | 覆盖 | 断言数 |
| --- | --- | --- |
| `icon-policy.mjs` | 纯函数：`isThirdPartyIcon` / `isUsableIcon` / 种子数据不变量 | 34 |
| `icon-ui.mjs` | 浏览器端：12 个渲染点实际给 `<img>` 选了哪个 src | 15 |
| `i18n-parity.mjs` | 中英键位双向一致 + 占位符一致 + 没有空文案 | 19 |

⚠️ `icon-ui.mjs` 有个**必须知道的写法**：不能在事后 `querySelectorAll('img')` 查。
`faviconOf` 给出的 `/favicon.ico` 一旦加载失败，`BookmarkIcon` 的 `@error` 会把
`<img>` 摘掉换成首字母 —— 事后查 DOM 只能看到「兜底后的世界」，
第 2 层的证据已经被抹掉了（当时表现为 4 条断言全 `null`，看着像 bug）。
正解是 `addInitScript` 里装 `MutationObserver`，把**每一个**进过 DOM 的
`<img src>` 记下来。副作用还挺好：整条链路不用碰网络，也不用 `page.route` 打桩。

---

## 收藏数是怎么算的

`discover_sites.collects` 是**服务端维护**的列，客户端只读不写。

- **谁在维护**：`favorites` 上的触发器 `favorites_sync_collects`
  （`supabase/migrations/004-discover-collects.sql`），
  插入一行 +1、删除一行 −1。
- **为什么不让客户端写**：`discover_sites` 的 update 策略只放行 admin，
  普通用户点收藏根本写不动；就算包成 SECURITY DEFINER 的 RPC，
  客户端也得先知道服务端的最新值，多设备下必然算错。
  触发器跟着 favorites 的写入在**同一个事务**里跑，天然正确。
- **语义**：种子基数 + 真实收藏数。和 `views` 一致（见「发现页」那节的说明）。
  想要纯真实计数，跑 `004` 文件末尾「可选：清零基数」那一行。
- **前端只做即时反馈**：`toggleFavorite` 会在内存里 ±1，但**不落盘** ——
  `cloud.js` 的 `SERVER_MANAGED_COLUMNS` 会把 `collects` 从 diff 里摘掉。
  摘掉是必须的：不摘的话非 admin 会刷一屏 RLS warning，
  而 admin 会把本地估算的**绝对值**写回去，直接盖掉别的设备刚产生的收藏
  （这个 bug 只在管理员账号上出现，更难发现）。
- **什么时候纠正**：刷新 / 登录 / 实时重连都会走 `loadAll()`，从库里读回真值，
  所以本地的估算不怕算错。

---

## 实时多端同步

登录后订阅自己那些表的变更，另一台设备改的东西**不用刷新**就会出现。
实现在 `src/composables/useRealtime.js`，订阅清单在
`src/data/adapters/cloud.js` 的 `REALTIME_TABLES`。

> ⚠️ **依赖一次迁移：`supabase/migrations/003-realtime.sql`。**
> 新建的表不会自动进 `supabase_realtime` 发布，不跑的话功能**静默失效**：
> `subscribe()` 照样报 `SUBSCRIBED`，但一条事件都收不到。
> 从零建库时 `schema.sql` 的 D 节已经包含这段，不用额外跑；
> **本项目（2026-09-24）与任何老库**都要单独跑一次。详见 `supabase/README.md` 的「六、实时同步」。
>
> ⚠️ 另有一次迁移：`004-discover-collects.sql`（收藏数接真实数据）。
> 与实时同步无关，但同样**老库要单独跑一次**。

四个设计要点：

1. **幂等应用 = 免费的回声抑制。** 自己写下去的改动会被服务端原样回推一份。
   这里的做法是「拿到变更先和 state 现值比，一样就什么都不做」，
   而不是「记住自己写过哪些 id 再过滤掉」—— 后者要考虑时间窗、并发写、失败重试，
   很容易漏。
2. **只维护快照，不碰 state。** `applyRemoteChange` 负责把 DB 行翻译成
   「往 state 上打什么补丁」，`useRealtime` 负责落地。分开的用意就是让
   上面那条比较有一个明确的判据。
3. **重连后必须全量重读。** `postgres_changes` 没有回放，
   断线期间的事件永远补不回来。
4. **切到云端 / 退出登录都要重读一次设置。** `initSettings()` 只在应用启动时跑过一次，
   而那一刻还是本地模式 —— 不重读的话，别的设备改的主题 / 编辑模式登录后不生效，
   而且 `user_settings` 那张快照根本没建，别人一改设置本机就全量重读。
   退出时同理，要把本机那一份换回来。
   ⚠️ 它还必须是**「先清回默认再盖」**：只做「有则覆盖」的话，本机没存过
   `jt:settings` 时一个键都不碰，退出登录后会**留着上一个账号的云端设置**。

---

## 书签拖拽排序

编辑模式下卡片可以拖拽：**同一分类内换位**，或**拖到别的分类**。

落点语义统一成一句话 —— **插到目标卡片前面**。因为视觉提示就是目标卡片
左边那条竖线，两者必须一致，否则用户看到的和实际发生的对不上。
想放到某个分类的**末尾**，就往那个分组的空白处放。

### ⚠️ 这一版之前，拖拽其实是坏的

README 原来只写「当前是落下才生效」，实测比这严重得多（`drag-probe.mjs` 一开始 **2 / 5**）：

| 症状 | 原因 |
| --- | --- |
| 卡片根本拖不动 | 根元素上没有 `:draggable`，`draggable` prop 只用来显示手柄 |
| 拖到哪儿都落不下 | 卡片上没有 `@dragover` / `@drop`，`dragover` 的 `defaultPrevented` 恒为 `false` |
| 拖了没反应 | `dragstart` 被列进 `defineEmits`，父组件的 `@dragstart` 变成**组件事件**，原生事件不会冒泡上去，`onCardDragStart` 永不触发 |
| 只有「拖进空分类」一条路能走 | `onCardDrop` 只有一个调用点（空分类的 `.empty-drop`） |
| 拖拽全程零反馈 | 没有任何 `.dragging` / `.dropping` 样式 |

### 四个必须做对的地方

1. **`dragstart` / `dragend` / `dragover` / `drop` 一定要列进 `defineEmits`，
   并且必须在根元素上显式 `emit`。**
   列进去之后父级的 `@dragstart` 是**组件事件**，原生事件不会自己冒泡上去 ——
   所以子组件里得手动 `emit`。
   反过来不列也不行：那样父级监听器会变成挂在根元素上的**原生监听器**，
   而根元素在 `draggable=false` 时也会收到冒泡上来的 `dragstart`，
   于是「拖了 A 却记成 B」。

2. **`dataTransfer.setData()` 不是可选的。**
   **Firefox 里不调它，拖拽根本不会启动**（表现为「按住拖不动」），
   Chrome 下却完全正常 —— 很容易被当成浏览器怪癖。
   值本身用不上（状态走 `emit` 传），但必须写一个。

3. **`preventDefault()` 必须放在所有 early return 之前。**
   `dragover` 在悬停期间是**持续触发**的。第一次进来把落点设成这个分组，
   之后每次都命中「已经是它了，不用改」的 early return ——
   如果 `preventDefault` 写在 return 后面，就只有**第一次**被 preventDefault，
   浏览器据此认为这里不接受放置，`drop` 永远不派发。
   表现是**「高亮得好好的，一松手什么也没发生」**，极难查。

4. **卡片上的 `dragover` 要 `stopPropagation`。**
   卡片在分组容器内部，不拦的话事件继续冒泡到分组的 `dragover`，
   落点会从「某张卡片」被改成「整个分组」，竖线一闪就没了。

### 视觉反馈

- **源卡片**：`.dragging` → 半透明 + 虚线边。不用 `display:none`，
  那样网格会立刻重排，拖到一半布局跳一下很难受。
- **落点卡片**：`.dropping::before` → 左边一条 3px 竖线。
  用 `::before` 而不是 `border`，因为加 border 会让卡片尺寸变 1px，**整行跟着抖**。
- **分组**：拖拽中所有分组亮出 `.droppable` 虚线框（不这样用户不知道哪儿能放），
  当前悬停的那个换成 `.drag-over` 实色强调。
- **高亮靠 `dragover` 持续刷新，不靠 `dragleave`。**
  `dragleave` 在子元素之间穿梭时会疯狂触发，用它清高亮会闪。
- **拖拽中把空分类也放出来**（`groups` computed 里判断 `dragState.id`）。
  平时空分类是藏起来的，但拖拽时它必须可见 ——
  否则「把书签挪进一个空分类」这个操作根本没有下手的地方。

### 回归脚本

`/tmp/jerry-sb/drag-probe.mjs`（25 条断言）。可以用环境变量扫全部布局：

```bash
LAYOUT=grid DENSITY=icon STYLE=mac node drag-probe.mjs http://127.0.0.1:5199/jerry-tools/
```

已覆盖 `grid` / `minimal` / `drawer` × `normal` / `compact` / `icon` ×
`default` / `neumorphic` / `mac`，**7 个组合全 25 / 0**。

**⚠️ 写这类探针有三个坑，都会伪装成「功能坏了」**（第一版就全踩了）：

1. **`dragTo()` 是原子的** —— 拖到一半的 DOM 状态（高亮、空分类出现）
   全被吞掉。而「拖到一半」恰恰是唯一能看到视觉反馈的时刻。
   要改用 `mouse.move` / `mouse.down` / `mouse.move` 手动分步，**中途停下来查 DOM**。
2. **拖到目标后要再补 1px 微动。** Chromium 在拖拽期间会合并鼠标移动事件，
   最后一个位置的 `dragover` **要等下一个输入事件才送达**。
   不补这一下，读到的落点是上一张卡片，看起来像「高亮标错了卡片」，
   但真松手时 `drop` 又是对的。真实鼠标每几像素一个事件，看不出这个延迟。
3. **读样式要读 `.bm-card.dragging`，不能读 `document.querySelector('.bm-card')`。**
   后者是 DOM 里的第一张卡片，通常**不是**正在拖的那张。
4. 另外：分组根元素的类名是 **`.cat-group`**，不是 `.group`；
   图标密度下 `.bm-text` 根本不渲染（`v-if="density !== 'icon'"`），
   所以别用卡片文字来认卡片，**拖之前给元素打编号**才跨密度通用。

---

## 待办

- [x] 接 Supabase：账号体系、跨设备同步、分享页、网站审核真正落库
- [x] 实时多端同步（`supabase.channel()` 订阅表变更）
- [x] 发现页的 `collects` 收藏数接真实数据（`favorites` 触发器维护，见「收藏数是怎么算的」）
- [ ] 图标改走 Supabase Storage（当前仍存 base64）
- [x] **书签跨分类拖拽 + 视觉反馈**（2026-09-24）
      顺带修掉了一个**比待办里写的严重得多**的真 bug ——
      原来卡片**根本没接上拖拽**（拖不动、落不下、拖了没反应，只有
      「拖进空分类」一条路能走）。详见「书签拖拽排序」一节。
      现在 `drag-probe.mjs` 在 7 个布局/密度/卡片样式组合下全 **25 / 0**。
- [x] **i18n 漏 key 的两道守卫**（2026-09-24）
      起因是这轮自己写出 `t('toast.moveFailed')` —— 真实 key 是 `toast.moveFail`。
      `translate()` 取不到 key 时**静默返回 key 本身**，所以界面上会明晃晃
      显示 `toast.moveFailed`，不报错不崩；更坑的是
      `t('x') || t('y')` 这种「兜底写法」**救不了** —— 返回值是 truthy 字符串，
      `||` 右边永远不执行。加了守卫后立刻又扫出两个同类错键：
      `import.importFail`（ImportDialog，2 处）、`toast.fail`（SettingsPanel）。
      两道守卫分工：
      1. `i18n-parity.mjs`（静态，21 条）：扫源码里 `t('…')` 的字面量跟语言包对，
         外加「禁止 `t('a') || t('b')` 死兜底」一条。
      2. `i18n-render.mjs`（动态，14 条）：真开浏览器，**中英各扫一遍**页面上
         实际渲染出的文字，看有没有漏出 key 字面量。
         ⚠️ 判据是「第一段 ∈ 语言包命名空间」而不是「长得像 a.b」——
         后者会把发现页/图标管理页上的**域名**全报出来
         （`rytr.me`、`www.jasper.ai`、`app.diagrams.net`……）。
      ⚠️ 写这道守卫时**自己踩了两次「假绿」**，都记在脚本注释里：
      `page.evaluate` 序列化函数时引用不到模块级常量 → ReferenceError 被
      `.catch(() => [])` 吞掉；以及 `page.evaluate(fn, arg)` **只传一个参数**，
      传数组给两个形参会静默错位。**写完必须故意制造一次失败验证它真能红。**
- [ ] 图标可选的「自动抓取」目前只回退到站点自己的 `/favicon.ico`，
      覆盖率约 57%。想要更高覆盖率需要自建一个抓取 `<link rel="icon">` 的代理服务
      （浏览器端受 CORS 限制做不了）。
      **⚠️ 别试「多试几个常见路径」这条路 —— 已实测，净增 0。**
      2026-09-24 对 377 个站点逐个试过 5 条路径
      （`/favicon.ico`、`/apple-touch-icon.png`、`/favicon.png`、
      `/apple-touch-icon-precomposed.png`、`/icon.png`），结论：

      | 范围 | `/favicon.ico` | 试完 5 条候选 |
      | --- | --- | --- |
      | 需要兜底的 69 个站点 | 39（56.5%） | **39（56.5%）** |
      | 全部 377 个站点 | 252（66.8%） | 258（68.4%） |

      四条补充路径**一条都没救回来**（边际贡献全是 0）。
      抽查了那 30 个全拿不到的：`modal.com` 是根目录真没有，
      `openai.com` 是 Cloudflare 403，其余是网络不可达 —— 都不是「换个路径就有」。
      所以唯一有效的办法还是**代理服务去读 HTML 里的 `<link rel="icon">`**，
      纯客户端试路径是死路。（顺带确认：README 说的「约 57%」是准的，
      实测 56.5%。）
- [x] **种子数据里那 37 条 icon 已清掉**（377 条里）。当初实测分布：
      | 条数 | 写的是什么 | 问题 |
      | --- | --- | --- |
      | 31 | `https://icons.duckduckgo.com/ip3/<域名>.ico` | 第三方服务，国内不可达 |
      | 5 | `https://www.google.com/s2/favicons?domain=…` | **正是 `helpers.js` 注释里说「特意不用」的那个服务** |
      | 1 | `http://regex101.com/static/assets/icon-192.png` | **明文 http** → HTTPS 页面上报 Mixed Content 警告 |
      做法是**两管齐下**（见「图标从哪来」）：
      1. **数据侧**：`seed-discover.js` 里这 37 条的 `icon` 置空。只动 `icon` 字段 ——
         `views` 合计 37701 / `collects` 合计 7764 / 条目数 377 都有断言兜着。
      2. **渲染侧**：`faviconOf()` 里加 `isUsableIcon()` 过滤，**不合格的自定义图标
         在渲染时直接回落到站点自己的 `/favicon.ico`**。这一层才是真正的保险 ——
         线上库那份改不动（要 `service_role`），而且用户自己粘的地址也没人管。
      ⚠️ 清完**重跑 `supabase/seed-discover.mjs`** 才会同步到库里
      （**现在重跑不会覆盖 views/collects**，安全）；老库也可以手工
      `update discover_sites set icon = '' where …`（SQL 见 `supabase/README.md`）。
      **当前线上库还没清** —— 直查实测（2026-09-24）仍是 37 条
      （31 duckduckgo + 5 google s2 + 1 明文 http），因为改它要 `service_role`，
      那个 key 暂时拿不到。**渲染层那层过滤已经兜住了**（`cloud-icons-ui.mjs`
      登录后实测：发现页 377 张图坏地址 0 张、图标管理页如实报「已忽略 37」），
      所以不急 —— 但哪天有 `service_role` 了，顺手清一下更干净。
      ⚠️ 本地模式的老用户看不到 —— `seedIfEmpty` 只在存储为空时灌种子，
      要么升 `SEED_VERSION` 走 `SEED_ADDITIONS`，要么让他们重登一次从云端拉。
      （另有 3 条 `mail.google.com` / `drive.google.com` / `ai.google.dev` 的
      icon 是站点自己的资源，正常，**别一起删了** —— `icon-policy.mjs` 里专门
      有 10 条「不该误伤」的反例断言守着，`www.gstatic.com` 也在其中。）
- [ ] `.bm-desc` 改成允许两行（或把描述上限写进编辑器的字数校验）。
      现在只剩 0.5px 余量，任何补充说明都塞不进去，见上方「数据层与已知限制」末尾
