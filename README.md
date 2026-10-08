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
npm run dev        # 开发预览 http://127.0.0.1:5174
npm run build      # 产出 dist/
npm run preview    # 预览构建产物
npm run check:i18n # 静态 i18n 守卫（键位 / 硬编码文案），CI 每次 push 也会跑
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

> **⚠️ 「布局」会覆盖「排列密度」这一条要心里有数。**
> `HomeView.vue` 里 `gridDensityClass = density-${layout === 'minimal' ? 'compact' : density}`
> —— **极简布局会把三种密度设置全部压成 `compact`**，连设成「图标」也一样。
> 所以极简布局下：看不到任何**简介**（`.bm-desc` 只在 `normal` 密度渲染）、
> 也看不到图标密排。这不是 bug，是极简布局的定位（高密度列表），
> 但它**静默覆盖了用户的设置** —— 排查「我的简介怎么不见了」时先看这里。
> `desc-matrix.mjs` 里专门有一条断言钉住它（`minimal` 的 9 个组合必须全是 `compact`），
> 以及反向的一条（`grid` / `drawer` 必须尊重设置，不许有意外覆盖）。

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
- 反馈：用户在**设置面板**提交（内容 + 可选联系方式），管理员在后台查看与回复
  （2026-10-02 接上，写入走 RPC —— 见「`submissions` / `feedback` 两张表」那节）

> ⚠️ `/admin` 和 `/icon-management` 有**路由守卫**：未登录跳登录页、
> 非管理员弹回首页。但**守卫是体验不是安全** —— 真正的权限判断在数据库 RLS 上，
> 绕过守卫也做不成任何事。本机模式（没配 Supabase）守卫放行，见「路由守卫」一节。

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
> 这条提示**已经写进卡片描述**了（2026-09-27）：`在线串口调试与固件升级 · 需 Chrome`。
> 之前写不进去，是因为 `.bm-desc` 是单行 `nowrap + ellipsis`，可用宽度只有
> **133.2px**，而「在线串口调试与固件升级」已占 126.5px —— 加任何后缀
> （「· 需 Chrome」约 163px、「（仅 Chrome/Edge）」约 221px）都会被**静默截断成「…」**。
> 那天把 `.bm-desc` 放开成两行（见「待办」），才腾出空间。
>
> ⚠️ **「卡片上」这条提示只在「看得到简介」的组合里可见**：需要 **grid / drawer 布局 +
> normal 密度**（`.bm-desc` 只在 `normal` 密度渲染，而 `minimal` 布局会把密度
> 强制压成 compact —— 见「功能清单 → 导航主页」末尾那条）。默认设置正好是
> grid + normal，所以默认就能看到。
> 其它组合下这句仍然**可达** —— 悬停提示框里给的是完整原文（2026-09-27 修好，
> 之前 compact / icon 密度下**卡片和提示框都看不到**，见「悬停提示框」一节）。
>
> ⚠️ **编辑模式下仍然看不全**：`.bm-actions`（编辑/删除两个按钮，50px）是在流里的，
> 加上它多带出来的一个 12px flex gap，一共吃掉 62px，`.bm-text` 只剩 **71.2px**，
> 这句要占 4 行 → 被 clamp 到 2 行。这不是 bug ——
> 悬停提示框（`max-width: 280px`）里是完整的。
> ⚠️ 但 **`mac` 卡片风格不受这个挤压**：`.bm-card.mac .bm-actions` 是
> `position: absolute`，编辑模式下 `.bm-text` 仍有 **191.2px**，这句 1 行就放得下。
> 也就是说「编辑模式看不全」只发生在 `default` / `neumorphic` 两种风格上。
> 顺带一提：拖拽手柄 `.bm-grip` 也是 `position: absolute`，**一点宽度都不占**，
> 算可用宽度时别把它减进去（这个数我一开始算错过）。
> `desc-verify.mjs` 的【H】组专门钉住了 71.2px 这个值，哪天编辑模式不再挤压会报红。

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
│   ├── transfer.js      本机数据 → 云端的键名归一化 / 清库 / 合并（`transfer-verify.mjs` 守）
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

### 悬停提示框

参考站的提示框只在「看得到简介」的密度下才有意义，这里做了两处修正（2026-09-27）。

**① 提示框不该按密度门控（真 bug）。** 原来 `BookmarkCard.vue` 的 `showTooltip` 写的是

```js
settings.showBookmarkTooltip && density.value === 'normal' && !!props.bookmark.description
```

而 `.bm-desc` 本身也只在 `normal` 密度渲染（模板里 `v-if="density === 'normal'"`）。
两处一叠加，**compact / icon 密度下简介彻底不可达** —— 卡片上没有，悬停也不出。
实测 18 个「布局 × 密度 × 卡片风格」组合里只有 **4 个**（grid / drawer + normal）
能出提示框，其余 **14 个**看不到简介的任何一个字。

那个 `density === 'normal'` 是「补上书签排列设置」那次重构（`c678832`）的**副作用**：
原本大概是 `!props.compact`（两值），改成 normal/compact/icon 三值枚举后被直译成
`=== 'normal'`，顺带把新加的 icon 密度也一起关掉了 —— 提交信息里只字未提，
是 `git log -S` 查出来的。

修法是去掉密度门控。提示框的职责恰恰是**揭示卡片放不下的东西**，
所以卡片显示得越少它越该出现：compact 只有名称、icon 连名称都没有。

**③ `icon` 密度 + 没填简介 = 完全认不出这条书签（第二轮补修）。**

上一轮修完 ① 之后，判据停在 `!!description`，于是在这个组合下：
卡片上只有一个 30px 的图标（模板里 `.bm-text` 有 `v-if="density !== 'icon'"`），
悬停又因为没简介而不出提示框 —— **整条书签一个字都看不到**，只能点开才知道是什么。

而简介在编辑器里是**可选**的（`<em class="opt">`，校验只管 `name` / `url`），
所以这不是理论边界，用户随手就能造出来。

> 这一条是**自己回头看出来的**：上一轮我在代码注释里写了
> 「这是已知遗留边界，探针里有一条断言钉住它」——
> 回头核对，**那条断言根本不存在**（探针的 18 个夹具全带简介）。
> **注释里声称的守卫，也要当成断言去验一遍。**

判据改成「**只要卡片说不清这是什么，就出提示框**」：

```js
const showTooltip = computed(
  () => settings.showBookmarkTooltip && (!!props.bookmark.description || !cardShowsName.value),
)
```

`cardShowsName` = `density !== 'icon'`，**必须和模板里 `.bm-text` 的 `v-if` 保持一致**。

反过来说：**卡片已经写着名字、又没有简介**时仍然不出提示框 ——
那时它只剩网址可揭示，为它弹一个浮层太吵。这是有意的取舍，有断言钉住。

顺带：提示框里的 `.tip-desc` 加了 `v-if="bookmark.description"` ——
没简介时留一个空 `<p>` 会白占一个 `margin-top: 3px` 的间距。

验收：`tip-nodesc.mjs`（67 条）。9 个组合 × 3 条书签（有简介 / 没填 / 只填空格），
判据是「卡片上或提示框里至少有一处能看到名字」。
修复前 **65 / 2**（两条失败精确落在 `grid/icon` 与 `drawer/icon` 的空简介书签），
修复后 **67 / 0**。
`BREAK=1`（只藏掉 icon 密度下**没有简介**的那些提示框）预期恰好 **2 条**报红，
实测 **59 / 2**，与预测一致。

> ⚠️ 写这个造红开关时踩了一次：第一版写成 `.density-icon .bm-tooltip { display:none }`，
> 把「有简介的」也一起藏了 → 报红 8 条，**分不清是上一轮修的密度门控
> 还是这一轮修的简介判据在报警**。用 `:not(:has(.tip-desc))` 收窄之后才是干净的 2 条。
> 上一轮的密度门控由 `tooltip-probe.mjs` 的 A 段守着（断言 18 个组合全都要出提示框），
> 两个修复各管一段，不重叠。
>
> ⚠️ 更关键的一个坑：第一版开关**压根没生效**，BREAK 模式照样 67/0 全绿。
> 原因是我探针里「提示框可见」的判据只写了 `opacity !== '0'` ——
> 而 **`display:none` 的元素 `opacity` 仍然计算成 `1`**，`textContent` 也照样读得到。
> 判据必须把 `display` / `visibility` / 实际盒尺寸一起判。
> **「造红开关没红」有两种可能：开关坏了，或者断言是假的 —— 先怀疑前者。**

**② 提示框会伸出视口（既有 bug，一并修掉）。** 提示框是 `left:50%` +
`translateX(-50%)` 居中在卡片上的，而它是 `width: max-content`（最宽 280px）——
卡片越窄、离视口边缘越近，两头就越容易伸到视口外被切掉。实测：

| 场景 | 首卡提示框 `left` |
| --- | --- |
| 1440 宽 + `drawer` + icon 密度 | **-39**（icon 卡片只有 ~66px 宽） |
| 375 宽 + `grid` + normal 密度 | **-43** |

第二行说明这**不是新引入的** —— 窄视口下 normal 密度早就溢出了，只是没人量过；
放开 icon 密度的提示框之后才变得显眼。

修法：新增 `clampTooltip()`，在 `@mouseenter` 时量一次、把偏移量写进 `--tip-shift`
（改 `transform`，**不改 `left`**）。两个细节：
- 必须先把当前偏移量减掉再量，否则每次悬停都在已有偏移上再叠一次、越推越远；
- 别改成用 `left` 做偏移 —— `left` 一变，用 `getBoundingClientRect()` 反推
  「没偏移时的位置」就没法算了。

在 `mouseenter` 里算而不是常驻监听：位置只跟布局有关，每次悬停重算一次就够，
也不用挂 resize / scroll 监听。

**验收：`tooltip-probe.mjs`（329 条断言）。** A 段 18 个组合都要有提示框；
B 段简介必须可达（卡片上或提示框里至少一处）；C 段几何（在视口内 / 不被遮挡 /
给的是完整简介）；D 段 4 个视口宽度 × 5 个组合的首卡 + 末卡水平夹取。
dev / dist 子路径 / 线上均 **329 / 0**。
`BREAK=1` 模式（把 `--tip-shift` 按死成 0）实测 **17 条报红**，
其中 `vw=375 grid/normal 首卡 left -43`、`vw=1440 drawer/icon 首卡 left -39`
正是上表那两个数字 —— 证明断言真能抓到溢出。

写这个探针时踩了三个坑，都记在脚本注释里：
1. **`.bm-tooltip` 有 `pointer-events: none`**（故意的，免得挡住点击），
   于是 `elementFromPoint` **永远返回它底下的元素**，「有没有被盖住」满屏假红。
   要在 `evaluate` 内部临时改内联样式、测完立刻还原。
   ⚠️ **别用 `addStyleTag` 全局注入 `pointer-events: auto`** —— 那是**永久生效**的，
   提示框反过来挡住卡片，下一次 `hover()` 会一直重试直到超时（第一版就这么挂的）。
2. **`card.textContent` 会把提示框自己的文字算进来**（提示框是卡片的子元素），
   于是「卡片上有没有简介」永远报「有」。要只取 `.bm-name` / `.bm-desc`。
3. **造红开关要覆盖到每一条相关断言。** 第一版 `BREAK=1` 只在公共的 `load()` 里
   注入样式，而 D 段是自己建 context 的（不走 `load`），于是 D 段在 BREAK 模式下
   照样全绿 —— 差点误判成「D 段的断言是真的」。凡是造红开关，
   一定要确认它作用到了**每一条**相关断言上。

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
| 7 | 图标存储 | 改走 Storage | ✅ **2026-10-01 补做** —— 见下方「上传的图改走 Storage」 |
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

- ~~**图标改走 Storage**~~ —— **2026-10-01 已做**，见下一节。
- **发现页的浏览 / 收藏数不做实时**：`discover_sites` 是全局表，`views` 每次点击都变，
  订阅它等于给所有在线设备广播每一次点击。需要时刷新即可。
  （**同一账号的另一台设备**不算 —— 那边走 `favorites` 的实时事件补计数，
  见下方「收藏数是怎么算的」。**别人**的收藏仍然要等下次全量读。）
- **发送确认邮件**：默认 SMTP 限流很严，索性关掉了邮箱确认
  （`mailer_autoconfirm: true`）。要发邮件得自备 SMTP。

---

## 上传的图改走 Storage（2026-10-01）

上面那张表里的第 7 项。三处上传（头像 / 书签图标 / 站点图标）原先一律
`readFileAsDataURL()` 转 base64 **写进业务表**，现在改成传 Supabase Storage、
业务表里只存一个几百字节的**公开 URL**。

### 形状

```
user-assets/{auth.uid()}/{kind}-{sha256前16位}.{ext}
                    ↑ kind = icon | avatar
```

- **上传前一律先缩到最长边 256px、转 WebP**（`src/data/iconStorage.js`）。
  不缩的话只是把「大 base64」换成「大文件」，问题没解决。
  图标最大渲染 52px、头像 96px，3× DPR 也就 288 —— 256 够用。
- 文件名带内容哈希 → 同一张图重复上传落到同一路径，天然去重。
- 策略只看**第一段目录是不是本人 uid**（`(storage.foldername(name))[1]`），
  所以**新增一种图片不用改策略**。反过来按业务分目录的话，每加一种图就要加一条策略，
  迟早漏一条 —— 而漏了的表现是「上传成功但谁也看不见」。
- 写策略 **insert / update / delete 三条都要**（`supabase/migrations/005-user-assets-storage.sql`）：
  少 update → upsert 失败，表现是「换头像没反应」；少 delete → 旧图删不掉，存储只涨不跌。

### 降级路径是设计，不是失败

| 情况 | 行为 |
| --- | --- |
| 未登录 / 没配后端 | 返回 **dataURL**（纯本机模式没有云端，这是唯一能存的形态） |
| 已登录但传不上去 | **抛错**，由调用方 toast |

这两种必须分开。已登录却传失败（网络 / 策略配错 / bucket 不存在）时回落到 base64，
就是**把要修的问题又做了一遍**，而且没人会发现 —— 表现是「图标设上了」。
对齐本项目那条「写失败却报『成功』是违约，不是设计取舍」。

### ⚠️ 「bucket 建了没有」不能用 `GET /storage/v1/bucket` 判断

我一开始把这条当验证探针给了出去，**它是假阴性**。实测（`_bucket-visibility.mjs`）：

| 身份 | `GET /storage/v1/bucket` | `GET /storage/v1/bucket/user-assets` |
| --- | --- | --- |
| anon key | `200 []` | `400 NoSuchBucket` |
| **已登录用户** | `200 []` | `400 NoSuchBucket` |
| 不带 `Authorization` 头 | `400 headers must have required property 'authorization'` | 同左 |

bucket 明明建成了、上传也成功，这两种身份**都看不到它** —— `storage.buckets` 有 RLS，
而它只对 service_role 开。`POST /object/list/<bucket>` 也区分不了（打不存在的 bucket
同样返回 `200 []`）。

**结论：anon / 登录用户都没有「bucket 存不存在」的廉价探针。**
唯一判据是**真上传一次**，或者读一个**已知存在**的对象的公开 URL：

```bash
curl -o /dev/null -w '%{http_code}\n' \
  "{SUPABASE_URL}/storage/v1/object/public/user-assets/<某个真实路径>"
```

### 怎么验的

| 层 | 脚本 | 结果 |
| --- | --- | --- |
| dev（源码，动态 import） | `/tmp/jerry-sb/icon-storage.mjs` | **24 / 0** |
| dev（另两个上传点） | `/tmp/jerry-sb/icon-upload-points.mjs` | **21 / 0** |
| dist（真 build + 真产物） | `/tmp/jerry-sb/dist-icon-storage.mjs` | **8 / 0** |
| 造红 | 上面那份 dev 探针 | **17 / 7**，7 条全部预期 |

- dev 探针覆盖 S1 未登录降级 / S0 登录 / S2 已登录走 Storage / S3 失败不回落 /
  S4 UI 级真点按钮 / **S5 越权写**。
- **`icon-upload-points.mjs` 是补出来的第二个探针**：第一版只在 UI 层覆盖了
  `LoginView` 的头像上传，而这次动了**三处**（`LoginView` / `BookmarkDialog` /
  `IconManagementView`）—— 典型的「改了三处、只验了一处」，剩下两处坏了不会有人知道。
  - `BookmarkDialog` 可以**端到端**验（书签写的是自己的表），实测保存后库里
    `bookmarks.icon` 就是 Storage 公开 URL。
  - `IconManagementView` 写的是全局的 `discover_sites`，要 admin，而测试账号是
    `role=user` → 库写入本来就该失败。所以改成**抓网络**：点上传后必须真的发出
    `POST /storage/v1/object/user-assets/{uid}/icon-*.webp` 且 200。
    这正好覆盖改的那一行（`uploadImage(file,'icon')` 有没有被调到）。
    **顺带挖出一个既有 bug** —— 见「待办」里那条「界面报『图标已更新』但库里一行都没变」。
- **S5 是这次补的**：前面只验了「自己能写自己那一层」这个 happy path。
  如果有人把写策略改成 `using (true)`，happy path 照样全绿，而任何人都能往
  别人的目录里塞文件 —— 「策略写错了」和「策略不存在」在正向测试里长得一模一样，
  必须**反向**试一次。判据带对照组（往自己目录写必须成功），
  否则拿到的 4xx 可能只是因为请求本身写错了。
  实测越权 → `403 new row violates row-level security policy`。
- **造红映射**（改 `src/data/iconStorage.js` 再跑 dev 探针）：

  | 造的因 | 变红的断言 |
  | --- | --- |
  | 关掉缩放（`scale = 1`） | 「降级路径也做了缩放」·「降级路径最长边 ≤256」·「上传的已经是转码后的小图」·「云端最长边 ≤256」 |
  | 上传失败回落 dataURL | 「上传失败时抛错」·「错误码是 upload-failed」·「**没有**回落成 dataURL」 |

- dist 层不看界面自述：**解码页面上的 `<img>`**（`naturalWidth > 0`）+
  直接查库。实测解码出 `256×154` —— 证明缩放在生产包里也生效。
  只比 URL 字符串挡不住「URL 对但取不到图」。

> **dist 层为什么必须单独跑一遍**：dev 走 `import('/src/data/iconStorage.js')`
> 动态加载源码，dist 是 rollup 打过包、压过名的另一份代码。
> 典型的「dev 绿 dist 红」：动态 import 路径、`import.meta.env` 注入、
> 或只在生产分支里走到的降级路径。

> ⚠️ **别用 `vite preview` 跑 dist 层** —— 它在这个沙箱里**静默挂起**
> （不打印、不监听，`lsof` 也看不到），而且它把所有路径都回退成 `index.html`，
> 连 `/assets/*.js` 也回退，于是「产物缺文件」这类问题永远测不出来。
> 用 **`/tmp/jerry-sb/serve-static.mjs`**（2026-09-29 就为这个写的，
> 只有「路径不是真实文件」时才回退）：
>
> ```bash
> node serve-static.mjs <dist目录> /jerry-tools/ 4174
> ```

### 已知限制

- **存量 base64 图不迁移**：老数据里的 `data:image/…` 继续能用
  （`isUsableIcon` 本来就允许），只是不享受新链路。换图之后才会走 Storage。
- **旧文件不回收**：文件名带内容哈希，换图 = 新路径 = 新对象，**旧对象留在 bucket 里**。
  存储只涨不跌。现在不做回收（要做的话得在更新时比对新旧 URL 并删旧对象）。
- **白名单里保留 `image/svg+xml`**：正常路径只会产出 WebP（前端强制转码），
  png / jpeg / svg 是**转码失败时的降级** —— `BookmarkDialog` 的文件框
  `accept` 里本来就有 svg，而 canvas 不一定能光栅化 SVG（没有内在尺寸的解不开）。
  不收它 = 把一个「本来能用」的格式变成「上传失败」，那是回归。
  风险可接受：图片挂在 `<ref>.supabase.co`，与本站**不同源**，
  本站一律 `<img src>` 渲染，不执行里面的脚本。
  真要再收紧，正确做法是「前端强制光栅化 + 失败就报错」，而不是在白名单里悄悄砍掉一个已支持的格式。

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

## 「未分类」书签（孤儿书签）

`categoryId` 为 `null`、或指向一个**已经不存在的分类**的书签，统称孤儿书签。
它们会落进渲染层补出来的一个**虚拟分组「未分类」**里。

### ⚠️ 这一版之前，这些书签会从界面上彻底消失

发现路径很绕：写设置审计（`settings-audit.mjs`，45 条）时，基准行里
夹具只塞了 6 条书签，页面却写着「**7 个网址**」。多出来那条是种子增量 `b22` ——
它的 `categoryId` 是 `dev`，而夹具里没有这个分类。顺着查下去，是两个问题叠在一起：

| # | 问题 | 性质 |
| --- | --- | --- |
| 1 | 顶部计数用 `state.bookmarks.length`（**原始总数**），渲染走 `groupedBookmarks`（只收能对上现存分组的）。**两套口径** | 隐患 |
| 2 | `groupedBookmarks` 里**根本没有「未分类」这个分组** —— `null` 不属于任何分组 | **真 bug** |

于是删掉一个分类之后，它的书签就**看不见、编辑不了、删不掉**，
而计数照样把它们算进去。而删除确认框的文案（i18n `settings.clearCategoriesConfirm`）
白纸黑字写着「书签将移至未分类」——**承诺的分组并不存在**。

实测（`orphan-bookmarks.mjs`，删掉一个装着 3 条书签的分类）：

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 基准 5 条书签 | 卡片 5 / 计数 5 | 不变 |
| 直接塞一条 `categoryId: null` | 卡片 **6** / 计数 **6**，但那条**搜不到** | 卡片 6 / 计数 6 / 「未分类」里能搜到 |
| 删掉装 3 条书签的分类 | 卡片 **2** / 计数仍 **5** / 侧栏「全部」仍 **5** | 卡片 **5** / 计数 5 / 侧栏 5 |
| 设置面板「清除分类」 | 卡片 **0** / 计数仍 **5** | 卡片 **5** / 计数 5 |

**三条产生孤儿的路径**（三条都得管）：

1. `useStore.deleteCategory()` —— 删单个分类时把书签置成 `categoryId: null`。
2. `SettingsPanel.clearCategories()` —— **它不走 `deleteCategory`，是内联自己实现的**，
   一次性把所有书签都置成 `null`。所以「清除分类」比「删一个分类」更狠：
   整页 0 张卡，而计数还写着 N，用户从此没有任何入口能再看到自己的书签。
3. `BookmarkDialog` 的分类下拉里「未分类」是个**可选项** —— 用户主动选它，立刻复现。

### 修法：补一个虚拟分组，而不是改计数

计数那一侧**一个字都不用动**。补上「未分类」分组之后，
**每一条书签都必然落在某个分组里**，`state.bookmarks.length` 这个口径自动就对了。

虚拟分组的 id 是 `UNCATEGORIZED_ID = '__uncategorized__'`，它：

- **只活在渲染层，绝不落库。** 书签的 `categoryId` 存的是 `null`。
- 前缀用 `__` 双下划线，因为真实分类 id 是 `createCategory` 生成的时间戳串，不会撞。
- 名字走 i18n（`common.uncategorized`）—— `category.name` 是空串，
  两个页面（`HomeView` / `ShareView`）的标题都得写
  `group.virtual ? t('common.uncategorized') : group.category.name`，
  不翻译就是一片空白。

### ⚠️ 「只在写库前那一处翻译」这句话是错的

写这一版时我在注释里写了「只在写库前这一处翻译」，**于是只改了 `onGroupDrop`**。
回头看才发现在 `onCardDrop` 里也是错的 —— **写库的路径不止一处**：

| 路径 | 触发方式 | 落库口径 |
| --- | --- | --- |
| `addBookmark()` | 点「未分类」分组标题上的 `+` | `''`（对话框把空串当「没指定」，自己回落到默认分类） |
| `onCardDragStart()` | 拖起一张孤儿书签 | `null` —— 它直接参与「源和目标是不是同一个分类」的比较 |
| `onCardDrop()` | 往「未分类」分组里的**另一张卡片**上拖 | `null` |
| `onGroupDrop()` | 往「未分类」分组的**空白处**拖 | `null` |

漏掉 `onCardDrop` 的后果：往「未分类」里的另一张卡片上拖，
`'__uncategorized__'` 就**写进数据**了。

而且它比想象中难发现：`onCardDragStart` 如果也没翻，源和目标带着**同一个**虚拟 id，
比较相等 → 掉进「同组换位」分支（只改 `sortOrder`，不碰 `categoryId`），**照样不落脏数据**。
只有「真实分类里的卡片拖到未分类的卡片上」这一条路径才会暴露。

所以现在四处的翻译都收进一个 `realCatId(id)`，**别在调用点各写各的**。
高亮 / 落点判断仍然用虚拟 id（`dropTarget.categoryId === group.category.id`）——
那是**渲染层**的事，不要一起翻译。

### 两个有意为之的取舍

1. **「未分类」分组排在最后**，不是排第一。它是个兜底分组，不该抢真实分类的位置。
2. **侧栏里没有「未分类」这一条**，所以点不进它 —— 侧栏是「分类导航」，
   而它不是分类。要在侧栏加一条，就得让侧栏也认识这个虚拟 id，
   那等于把一个渲染层的临时概念扩散到更多组件里。当前靠内容区的分组标题
   就够发现了（删完分类你就停在那个位置）。
   代价：分类很多时，孤儿书签在页面**最底部**，得滚下去。

### 顺带：主页和分享页的两份分组逻辑合并了

分享页原来自己写了一份 `groupShared()`，和 `groupedBookmarks` 是**两份逻辑** ——
两边各自踩过同一个 `.self` 的坑（注释都是抄的），而且**两边同样会丢孤儿**。
分享数据里若有一条书签的 `categoryId` 对不上任何分类（主人删过分类、或数据不同步），
它会从分享页静默消失，而头部「N 个网址」照样算它。

现在合并成 `useStore.groupBookmarks(categories, bookmarks)`，两个页面共用：

```js
export const groupedBookmarks = computed(() => groupBookmarks(state.categories, state.bookmarks))
// ShareView.vue
const all = supabaseConfigured
  ? groupBookmarks(shared.value?.categories || [], shared.value?.bookmarks || [])
  : groupedBookmarks.value
```

### 验收

`/tmp/jerry-sb/orphan-bookmarks.mjs`（18 条断言，6 个场景）。

**⚠️ 这个探针第一版有两条错，都是「断言本身坏了」而不是功能坏了：**

1. **假断言**：`bodyHas` 的书签名单是**硬编码**的 `['甲一','甲二','甲三','乙一','乙二']`，
   `'未分类那条'` 根本不在里面 → `bodyHas.includes('未分类那条')` **恒为 false**。
   它从来没红过，也从来没绿过。当时它恰好和真 bug 同时存在，所以看着像报真红。
2. **把 bug 现状写进了断言**：「删除后剩下 2 张卡」—— 修复前确实只剩 2 张。
   修好之后这条必然报红，**报红不代表修错了，代表断言该改了**。

**⚠️ 分享页在这个环境里只能走云端分支。** dev 里配了 `.env.local`，
`supabaseConfigured` 是模块级常量 → 分享页永远走 `get_shared_nav` 那条路，
本地那条 `groupedBookmarks` 分支**根本不可达**。所以场景 5 用 `page.route()`
拦下这个 RPC 直接返回构造的 payload —— 这样验的还正好是线上真正跑的那条路。

**场景 6 专门守「虚拟 id 不落库」**：真拖两次（同组换位 / 跨组落到未分类的卡片上），
然后**直读 `localStorage`** 断言没有任何书签的 `categoryId` 是 `'__uncategorized__'`。

**两套造红，因为一个开关覆盖不了全部断言：**

| 开关 | 做法 | 结果 |
| --- | --- | --- |
| `BREAK=1` | `MutationObserver` 摘掉 `.cat-group--virtual` | 预测 **12** 条报红，实测 **12** 条 |
| 临时把 `realCatId()` 改成恒等 `return id` | 让虚拟 id 原样落库 | 场景 6 报红：`甲一` 的 `categoryId` = `"__uncategorized__"`，**落库 1 条** |

- `BREAK=1` 为什么**不能**用 `addStyleTag` 注入 CSS：本探针的判据读的是
  `document.body.textContent` 和 `.bm-card` 的数量，**两者都不受 `display:none` 影响**
  （隐藏的元素照样算进 `textContent`、照样被 `querySelectorAll` 数到）。
  注入 CSS 藏不住它们，只会造出一个**永远全绿的假开关**。
- 为什么需要第二套开关：`BREAK=1` 把虚拟分组摘掉之后，**根本没有落点可拖**，
  场景 6 的断言自然全绿 —— 一个开关验不到它守的那个缺陷。
  **判据：如果某个缺陷不是「元素在不在」而是「写进去的值对不对」，
  就需要另一种造红手法。**
- 场景 3 / 4 会触发 Vue 重渲染，所以摘除要挂 `MutationObserver`，只摘一次会被插回来。

---

## 写失败审计（写不进去，却报「成功」）

### 这轮是怎么找到的

前一轮的审计角度是「**设置项是不是真的生效**」，挖出了孤儿书签那个真 bug。
这轮换一个同样系统的角度：**所有会写盘的操作，写失败时有没有被吞掉、然后照样报成功。**

判据是**违约**，不是设计取舍 —— `src/data/storage.js` 表头白纸黑字写着契约：

> `write(key, value) -> boolean`，**写失败返回 false，调用方据此回滚**。

### 手法：故障注入，而不是「真把 localStorage 塞满」

把 `Storage.prototype.setItem` 换成一个会抛 `QuotaExceededError` 的版本
（配额满 / 隐私模式 / 站点数据被禁，都是真会发生的），然后逐条走所有会写盘的路径。

⚠️ **不能靠「真的把配额塞满」**：清空类操作写的是 `[]`，**比原值小**，
配额满也照样写得进去 —— 这条路径根本测不出来。

### 实测结果

探针：`/tmp/jerry-sb/write-fail-audit.mjs`，9 个场景（新增 / 编辑 / 删除书签、
删除分类、拖拽移动、设置面板「清除分类」/「清除所有书签」、恢复备份、改设置项）。

**对照方式是「同一份探针，跑新旧两份产物」** —— 把上一版 `dist` 原样挂在
`5198` 上跑（旧主包 `index-BH5YRfgi.js`），所以「修复前」不是改数据凑的：

| 跑在哪 | 结果 |
| --- | --- |
| 修复前产物（`/tmp/jt-dist-prev`） | **20 / 9** |
| 修复后产物（当前 `dist`） | **29 / 0** |

9 条报红的断言全部落在场景 6 / 7 / 8 / 9 上；**前 5 个场景一条都没红**。

**有价值的负面结论**：`withRollback` 保护的那 5 条路径（新增 / 编辑 / 删除书签、
删除分类、拖拽移动）**修复前后都正确报失败并回滚**，一条都没坏。
所以问题不在「没人想过要处理写失败」，而在**个别路径漏了**。

对照报告（自包含 HTML，证据全部取自探针原始输出）：
`/tmp/jerry-sb/make-writefail-report.mjs` → `shots/writefail-before-after.html`。

### 修掉的 3 处真 bug

1. **设置面板「清除分类」/「清除所有书签」** —— 两条 `storage.write` 的返回值
   直接丢掉，无条件报「清除完成」。内存清空了、界面看着是清的、**存储里其实还在**，
   刷新一次数据全回来。
2. **改设置项** —— `setSetting` → `persist()` 的返回值被丢，**零提示**。
   用户切了深色主题、看着生效了，刷新又变回去，全程没有任何反馈。
   模板里还有一处 `@click="resetSettings(); toast(t('toast.saved'))"` ——
   不 await、也不看返回值，无条件报「已保存」。
3. **恢复备份（后果最重）** —— `localStorageAdapter.writeAll` 是
   `for (key) safeRemove(key)` 再 `for (key) safeSet(key)`，两个问题叠在一起：

   - `safeSet` 的返回值被丢掉 → 写失败也返回 `true` → 上层（**明明检查了返回值**）
     报「恢复完成」；
   - **`set` 失败时原值已经被 `remove` 掉了** → 用户的分类 / 书签 / 设置直接没了。
     刷新后 `seedIfEmpty()` 看到空存储，还会把种子灌回来。

   实测（`s8-timeline.mjs` 量了三个时刻，夹具 3 条书签 / 2 个分类）：

   | 时刻 | 修复前 | 修复后 |
   | --- | --- | --- |
   | ① 动作前 | 3 条 `[甲一,甲二,乙一]` / 分类 2 | 3 条 / 分类 2 |
   | ② 写失败后立刻 | **0 条 / 分类 0**（数据被清空） | 3 条 / 分类 2 |
   | ③ reload 之后 | **22 条种子** `[GitHub, VS Code, …]` / 分类 6 | 3 条 / 分类 2 |

   而 toast 说的是「恢复完成」。用户视角是
   「我恢复了个备份，结果回到默认数据了」。

### 修法

| 文件 | 改动 |
| --- | --- |
| `src/data/storage.js` | `writeAll` 去掉「先 remove」、逐个检查 `safeSet` 返回值、**第一个失败就中止** |
| `src/components/SettingsPanel.vue` | 两处清除加返回值检查 + 内存回滚 + 如实报失败；`pick()` / 新增 `toggle()` / `doResetSettings()` 失败时提示 |
| `src/composables/useSettings.js` | `setSetting` / `setSettings` 失败时**回滚内存**（含 `data-*` 属性）并返回 boolean |
| `src/composables/useAuth.js` | `transferLocalToCloud` 检查每一张表的写入结果，返回 `reason: 'write_failed'` |
| `src/data/i18n.js` | 新增 `toast.uploadLocalFail`（中英） |

两条设计说明：

- **`setItem` 对已存在的键本来就是原子覆盖，不需要先 `remove`。**
  去掉 remove 之后，「写失败」最多是「恢复了一半」，**绝不会把没写进去的键抹掉**。
  云端那份 `writeAll` 一直是这么写的（先写、逐个检查、不删），这里跟它对齐 ——
  两边不对称本身就是信号。
- **仍然做不到原子**：配额满时前面的键可能已经写进去了。所以第一个失败就中止并
  返回 false，让调用方**如实报失败**。做不到原子就老实说，别假装成功。

### ⚠️ 探针自己踩的三个坑（一个比一个阴）

1. **场景 8 是假绿。** `onRestoreFile` 成功后原代码会
   `setTimeout(() => location.reload(), 500)`。当时底层谎报成功 → 走了「成功」分支
   → toast 说「恢复完成」→ reload 把 toast 冲掉 → 探针读到**空数组** →
   「写失败时不出现『恢复完成』」**恒为真**。

   拦 reload 走不通：`Location.prototype.reload` 赋值**静默失败**
   （实例上是 unforgeable 属性），`defineProperty(window.location, 'reload', …)`
   直接抛 `Cannot redefine property`。
   改成**让日志活过 reload**：toast 记一份到 `window.name`（同一标签页里唯一
   跨导航存活、且**不碰 Storage** 的地方 —— 不碰 Storage 是硬要求，
   故障注入期间 `setItem` 是会抛的）。另外用「文档代号」判重载：
   init script 往 `sessionStorage` 里自增一个计数，**只有真 reload 才会让它变**。

   ⚠️ 别用 `page.on('framenavigated')` 判重载 —— vue-router 的 `pushState`
   也会触发它，分不清「换路由」和「重载」。

2. **观察器根本没装上，而且是静默的。** 原写法是
   `observe(document.documentElement, …)`，但 init script 在
   `readyState === 'loading'` 时执行，此时 `document.documentElement` **还是 `null`**
   → 抛 `parameter 1 is not of type 'Node'` → 整个 IIFE 挂掉。
   后果极阴：日志永远为空，而 `toasts()` 会**退化成正读实时 DOM** ——
   所有「不出现成功文案」的断言看起来照常绿，**只有在页面被 reload 之后才暴露成假绿**。

   → 改成 `observe(document, …)`，并在 `withFault()` 里加**硬自检**：
   观察器没装上就**直接抛错、整轮作废**，不允许静默降级。

3. **一条弱断言。** 场景 5 的「存储里的顺序没变」只比了名字顺序，
   但拖拽改的是 `categoryId`，书签在数组里**可能原地不动** ——
   造红时实测：BREAK 下拖拽真的成功了，这条断言照样绿。
   → 加了一条判 `categoryId` 归属的断言（`甲一: cat_a → cat_b` 立刻报红），
   弱的那条留着当第二层保险。

### 造红

`BREAK=1` → **不注入故障**。写盘全部成功，于是「写失败时不许报成功」这一类断言
集体变红。实测 **3 绿 / 26 红**（共 29 条）。

三条绿都有明确原因，不是漏网：

| 绿的那条 | 为什么该绿 |
| --- | --- |
| 拖拽移动：存储里的顺序没变 | **已知弱断言**，有效判据是旁边那条「归属没变」 |
| 恢复备份：探针确实读到了 toast | **探针自检**，本来就该一直绿 |
| 设置项：写失败时不出现任何「已保存」类成功文案 | **条件式断言**：没故障就没有写失败，前提不成立 |

### 遗留

- **`useAuth.transferLocalToCloud` 只做了静态修正，没有动态验证。**
  探针要求登录态（`pushLocalToCloud` 先判 `isCloudActive()`），当前夹具跑不到这条。
  改动与其余三处同构，但**别当成已验证**。
- **调用点已全量核对过**（`grep -rn "storage\.\(write\|writeAll\|remove\)" src/`），
  共 **9 处**调用点、分布在 4 个文件：`useStore` 的 `withRollback`（1）、
  `useAuth` 的三表写入（3）、`useSettings.persist`（1）、
  `SettingsPanel` 的 `writeAll` + 两处清除（4）。
  除 `useAuth` 那 3 处外都有动态覆盖。留言（notes）走的是 `withRollback`，
  与书签同一条路径，不需要单独场景。

### 第 4 处（2026-10-01）：被 RLS 挡掉的写，连 `error` 都没有

前面 3 处都是「返回值被丢掉」。这一处不一样 —— **返回值是对的，
是底层给的信号本身就没有**。

`src/data/adapters/cloud.js` 的 `writeSites()` 写全局表 `discover_sites`，
而那张表的 update / delete 策略只放行 admin。非 admin 的写：

| 请求 | 返回 |
| --- | --- |
| `PATCH` 被 RLS 的 `USING` 挡掉 | **HTTP 204**，body 空 |
| 同上 + `return=representation` | **HTTP 200** + `[]` |
| 同上 + `count=exact` | 响应头 `content-range` 的**总数是 0** |
| 对照：有权限的表 | 同一响应头的总数是 **1** |

所以 `const { error } = await ...; if (error) { ok = false }` **一个字都不会说**，
`ok` 保持 `true` → `snapshot.set()` 照常更新 → 界面 toast「图标已更新」，
而库里一行都没变。

**这段代码的注释里早就写着「非 admin 会被 RLS 静默挡掉」——
注释承认了静默，代码却把它当成成功返回。**

修法是两层，缺一层界面就照样说谎：

1. **根因**：update / delete 改成 `.select('id')` 把**受影响的行**要回来，
   0 行 = 没写进去 = `ok = false` → `withRollback` 回滚 + 界面报失败。
   ⚠️ `insert` **不用**这一套 —— 被 RLS 的 `with check` 拒掉时它真的会报错，
   只有 update / delete 的 `using` 挡才是静默的。
2. **表层**：`AdminView` 的 `approve` / `reject` / `removeSite` / `restoreIcon` /
   `setIcon` 这 **5 处**原来 `await updateSite(...)` 之后**无条件** toast 成功 ——
   连返回值都不看。改成 `ok ? 成功文案 : toast.saveFail`。
   （`IconManagementView` 那 3 处本来就是对的。）

**为什么 `insert` 报错、`update` 不报错**这件事本身值得记：
`with check` 是「不许你造出这样的行」，`using` 是「这行你根本看不见」——
看不见的行，数据库连「我拒绝了你」都不会说。

#### 探针 `write-sites-honest.mjs`（19 / 0）

| 场景 | 断言 |
| --- | --- |
| S-A 非 admin 改全局表 | 提示是**失败** · **没有**谎报成功 · **内存回滚了**（卡片上还是旧图标）· 库里没变 |
| S-B **对照组**：改自己的书签 | 提示成功 · 库里**真的**多了一行 |
| S-C 回归：views 自增（RPC） | 库里 +1 · 界面也跟着 +1 |
| S-D `AdminView` 那 5 处 | 提示失败 · 没有谎报成功 · 库里没变 |

- **S-B 是必需的**：没有它的话，「所有写都报失败」也能让 S-A 全绿。
  这一组证明 `withRollback` 没把正常路径也判成失败。
- **S-A 的「内存回滚」是最有判别力的一条** —— 它看的是**卡片上实际渲染的
  `<img src>`**。造红时它给出的是「卡片显示 `…/user-assets/…`、库里还是旧图标」，
  正好就是用户看到的现象。
- **造红两次，两层各自独立变红**：只退回根因 → S-A 的 ①②③ 红；
  只退回 `AdminView` → S-D 的 ①② 红。这证明两层都被钉住了，
  不会出现「修了一层、另一层没人管」。

#### 探针自己踩的两个坑（都是「判据没钉住对象」）

1. **按「views 最高的那条」回读** —— 自增后榜首可能换成另一个同分站点，
   回读到的根本不是同一个对象，断言成了 `260 → 260` 的**假红**。
   改成按标题（等于按 id）钉住那一条。
2. **用 `import('/src/composables/useStore.js')` 拿 `state`** ——
   Vite 在 HMR 之后会给模块 URL 挂 `?t=<时间戳>`，裸 URL 动态 import
   拿到的是**另一个模块实例**（没跑过 `loadAll`），`state.sites` 是空的。
   第一次跑碰巧命中同一个实例，之后就全是空数组。
   改成**走界面点击**，用的是 app 自己那份实例。

#### ⚠️ `submissions` / `feedback` 两张表：不是隐患，是**没接** → 其中一张已接上

写上面那节时我顺手记了「这两张表也有『能看见但写不了』的组合，将来接上会复现」。
**动态验了一遍（`feedback-path-audit.mjs`，7 / 0）之后发现说重了**，实际是这样：

| 表 | 真实状态 |
| --- | --- |
| `submissions` | **弃用表**。用户提交站点走的是 `DiscoverView.doSubmit()` → `createSite(..., 'pending')` → 写 **`discover_sites`**（策略放行 `submitted_by = auth.uid() and status = 'pending'`），跟这张表**没有任何关系** |
| `feedback` | 原本**整条链路没实现**；**2026-10-02 已接上**（见下） |

`feedback` 接上**之前**的证据（都实测过，不是读代码推的）：

- 云端 `feedback` / `submissions` 两张表当时可见 **0 行**（`content-range` 总数 0）。
- `/admin` 的「反馈」tab 点进去**永远是空列表**（`.fb-card` = 0，只有空态），
  而且这个 tab 里**一个按钮都没有**（没有「新建 / 提交」入口）。
- 用户侧四个页面（首页 / 发现 / 图标管理 / 设置面板）**都不出现「反馈」二字**。
- 于是 `AdminView.sendReply()` **根本触发不了** ——
  没有反馈条目就没有「回复」按钮。它是**死代码**，不是「能用但没落盘」。

⚠️ 这里有个最容易误导人的地方：**`/admin` 的「反馈」tab 是一个永远空的面板。**
管理员点进去看到「暂无反馈」，会读成「**没人反馈**」，而真相是「**这个功能没做**」。
两种含义在界面上长得一模一样 —— 和「写失败却报成功」是同一族问题的**镜像**：
**「没有数据」和「没有功能」在界面上长得一样。**

##### 2026-10-02 接上了：写入全走 RPC

`supabase/migrations/006-feedback-rpc.sql` 建两个函数，客户端把 `feedback`
当**只读表**（`SPECS[feedback].rpcOnly = true`，`writeCloud()` 硬拒绝整表写）。

| 函数 | 安全级别 | 为什么 |
| --- | --- | --- |
| `submit_feedback` | **SECURITY INVOKER** | 提反馈就是写自己的行，让 RLS 的 `with check` 再兜一道 |
| `reply_feedback` | **SECURITY DEFINER** | 要改**别人的**行；函数内自己判 `is_admin()`，`return found` 不靠 error |

**为什么不能用通用路径**（这是这次最重要的设计约束）：

1. 🔴 `rowToLocal()` 会把 `user_id` 丢掉、`localToRow()` 又给每一行盖上**当前用户**的 uid。
   管理员能读到**所有人**的反馈 → 「读回全部 → 改一条 → 整表写回」会把别人的行
   也盖成管理员的 uid，`on conflict (user_id, id)` 匹配不上 → **插出一条副本**，
   原行纹丝不动。**症状是「管理员回复成功、用户永远看不到」。**
   （`feedback` 还订阅了实时，别人新提交的会进管理员内存，隐患更大。）
2. 🔴 被 RLS 挡掉的 update 不报错、只影响 0 行（见「写失败却报成功」那节）。
   两个函数**显式 `return boolean`**，客户端拿到的是真信号。

配套改动：`SPECS[feedback]` 补上漏掉的 `replied_at`、加 `fromDb` 把 `user_id`
保留成 `userId`（管理员回复要按 `(user_id, id)` 定位，主键就是这两列）；
用户侧入口在**设置面板**新增的「反馈」分区（⚠️「我的反馈」列表要**按 `userId` 过滤**，
否则管理员会看到别人写的东西）；`AdminView` 的回复走 RPC + 如实报错，
列表渲染单条 `reply`，联系人字段从**库里不存在的** `f.userEmail` 改成真实存在的 `f.contact`。

**验证**（`feedback-flow.mjs`）：

| 层 | 结果 |
| --- | --- |
| dev | **29 / 0** |
| dist | **27 / 0 / 1 跳过**（跳过的是 dev 限定的 `rpcOnly` 整表写断言） |
| 迁移本身（PGlite） | **30 / 0**（造红 28/2） |

⚠️ **迁移递出去之前先用 PGlite 跑了一遍** —— 这份 SQL 只能由人在 SQL Editor 里手工跑，
**在点「执行」之前一次都没被执行过**。PGlite 里桩掉 `auth.uid()` / `is_admin()`
（读一张可切换的 `auth._ctx`）+ `anon`/`authenticated` 角色 + 照抄 schema 的 `feedback` 表，
切上下文就能把未登录 / 用户 / 管理员三种身份各走一遍。
造红：`return found` 改成 `return true` → 立刻红两条。

> ⚠️ 探针在库里留一行反馈（**用户删不掉自己的反馈** ——
> `feedback_delete using (is_admin())` 只放行 admin）。
> 清理：`delete from public.feedback where id like '__probe_fb%';`

##### 🔴 S6 顺手把「守卫是体验、RPC 才是安全」测出来了

路由守卫生效之后，非管理员**根本进不去 `/admin`**，原来那段「点回复」的用例直接超时。
改法不是绕过守卫，而是给探针装个夹具把 `profiles.role` 改成 `admin`：

- 客户端认为「我是管理员」→ **守卫放行**，页面进得去；
- 但 `reply_feedback` 里的 `is_admin()` 是**服务端**判的，读的是真实 profile
  （`role = user`）→ **返回 `false`**。

于是这一条断言同时钉住了「守卫放行」和「服务端仍然拒绝」两件事。

> ⚠️ 夹具只改一个字段，其余用真响应。第一版按**对象**改，**0 命中** ——
> 实测这个版本的 `maybeSingle()` 请求头 Accept 是通配，
> **拉数组再在客户端取第一个**。改成数组分支才生效。

`submissions` 那边**仍然是弃用表**，没有写路径，不需要动。

---

## 路由守卫（`/admin` / `/icon-management`，2026-10-02）

### 之前是什么样

`src/router/index.js` 里那两个路由的 `meta` **只有 `title`，没有任何守卫** ——
任何登录用户（甚至未登录）都能打开，看到一屏他一个字都写不进去的按钮。

它和上一节那个 bug 是一对：`discover_sites` 的写策略只放行 admin，
非 admin 点下去的表现正是「**界面报成功、库里没变**」。
根因（`writeSites()`）已经修了，这节补的是另一半 —— **干脆别让人进去**。

### ⚠️ 守卫是「体验」，不是「安全」

真正的权限判断在**数据库的 RLS** 上。绕过守卫（改 JS、直接打 REST）也做不成任何事，
因为策略会挡。守卫的目标只是「**别让人看到一个他什么也做不了的页面**」。

### 规则

| 情况 | 行为 |
| --- | --- |
| 没配 Supabase（本机模式） | **放行** —— 见下 |
| 配了、未登录 | 跳 `/login?redirect=<原路径>` |
| 配了、已登录但不是 admin | 弹回首页 + 提示「没有权限访问这个页面」 |
| 是 admin | 放行 |

### 🔴 本机模式为什么必须放行

本地模式的注册函数 `localRegister()` **永远写 `isAdmin: false`** ——
也就是说本机模式下**没有任何人能是 admin**。真按 `isAdmin` 拦，
**站长自己在没配后端的环境里也进不去自己的后台**。
本机模式真正的闸是 `AdminView` 里的口令（`ADMIN_PASSWORD`）。

### 🔴 不要加「已登录就别停在 /login」这条规则

`/login` 在已登录时是**个人资料页** —— 头像上传就在那儿。
把它跳走会直接废掉换头像。`route-guard.mjs` 的 S7 专门盯着这条，别删。

### `?redirect=` 与开放重定向

登录页认 `?redirect=`，登录后跳回**来处**（不认的话用户还得自己再点一次）。
参数过 `safeRedirect()`（在 `utils/helpers.js`）：

- 只收以**单个** `/` 开头的路径；
- `//evil.com` 挡掉 —— 浏览器把它当**协议相对 URL**，跳过去就是开放重定向；
- `/\evil.com` 也挡掉 —— 有些浏览器把 `\` 归一成 `/`。

⚠️ 放在 `helpers` 而不是 `router` 里：`LoginView` 也要用，
从 `@/router` 反向 import 会绕成一个环。

### 怎么验的

探针 `/tmp/jerry-sb/route-guard.mjs`：

| 层 | 命令 | 结果 |
| --- | --- | --- |
| dev | `node route-guard.mjs http://127.0.0.1:5174/ <本机模式 base>` | **36 / 0 / 0** |
| dist | `node route-guard.mjs http://127.0.0.1:4177/jerry-tools/ <本机模式 base>` | **29 / 0 / 1 跳过** |

覆盖 S1/S2 未登录跳登录并带 `redirect` · S3 公开页不被跳 · S4 管理员放行 ·
S5/S6 非管理员弹回 + 提示 · S7 `/login` 资料页没被跳走 · S8 开放重定向冒烟 ·
**S8b `safeRedirect` 单元断言** · S9 登录后跳回来处 · **S10 本机模式放行**。

- **S4 用的是夹具**：项目里没有可用的管理员账号
  （`LoginView.fillAdmin()` 填的 `admin@jerry.tools` 在云端**不存在**，
  本地模式的 `localRegister` 又永远写 `isAdmin: false`）。
  夹具只改一个字段（`role → admin`），其余都是真响应 ——
  它验的是「`isAdmin` 为真时守卫放行」这一条分支，不是整套管理员权限。
  ⚠️ 夹具第一版按**对象**改响应，**0 命中** —— 实测这个版本的 `maybeSingle()`
  请求头 Accept 是通配，也就是**拉数组再在客户端取第一个**。
  改成数组分支后才生效。
- **S10 需要一个不注入 `VITE_SUPABASE_*` 的构建**：
  ```bash
  VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run build -- --outDir dist-nosb --emptyOutDir
  node serve-static.mjs <dist-nosb> /jerry-tools/ 4176
  ```
  （验完记得删掉 `dist-nosb` —— `.gitignore` 里只有 `dist`，没有它。）

### 造红两次

| 造的因 | 结果 |
| --- | --- |
| `beforeEach` 直接 `return true` | **15 / 10**，10 条红正好是守卫相关的（S1/S2/S5/S6/S9）；S4/S7/S8 保持绿 |
| `safeRedirect` 改成原样返回 | **29 / 3**，红的是 S8b 的三条 |

#### 🔴 顺带抓到一条**假绿**：S8 的端到端断言判不出 `safeRedirect` 坏没坏

第一次造红（把 `safeRedirect` 改成原样返回）**全绿**。原因：
`router.push('//evil.com')` 在 vue-router 里被当成**路径**，匹配不上任何路由 →
落到 catch-all `/:pathMatch(.*)*` → 又跳回 `/`。
「落点还是首页」这件事，**坏掉的版本也能满足**。

所以真正能判别的断言必须打在**纯函数**上（S8b）。
S8 那两条保留为**冒烟**，并在注释里写明了它判不出什么。

> 这条值得单独记：**「端到端看起来对」不等于「这条断言有判别力」。**
> 只有造红能分辨。顺带一提，S8b 用动态 import 是安全的 ——
> `safeRedirect` 是纯函数，不会踩「HMR 后拿到另一个模块实例」那个坑。

---

## 读不出来 ≠ 没有数据（`seedIfEmpty` 的判据）

上一轮审的是**写**路径（写失败却报成功），这一轮审它的镜像：**读**路径。

### 根因：一个判据把三种情况混成了一种

```js
const bms = await storage.read(storageKeys.bookmarks)
if (!bms || !bms.length) {            // ← 这一行
  state.bookmarks = clone(seedBookmarks)
  await persist(storageKeys.bookmarks, state.bookmarks)
}
```

`!bms || !bms.length` 分不清三件事：

| 情况 | `read()` 返回 | 该不该灌种子 |
| --- | --- | --- |
| ① 键**不存在**（首次启动） | `null` | **该灌** |
| ② 键存在、值是**空数组**（用户清空了） | `[]` | **不该灌** |
| ③ 键存在但**读不出来**（坏值 / 形状不对） | `null` | **不该灌，更不能覆盖** |

②③ 都被当成①，而①分支里带着 `persist()` —— **写盘**。这就是全部问题的来源。

### 后果 ①：用户清空的数据，刷新就复活（最容易撞上）

实测（`/tmp/jerry-sb/empty-vs-first.mjs`，修复前）：

| 用户操作 | 刷新之后 |
| --- | --- |
| 删掉**最后一条**书签 | **22 条种子回来** |
| 设置面板「清除所有书签」 | **22 条种子回来** |
| 设置面板「清除分类」 | **6 个种子分类回来** |

「清除所有书签」是用户明确表达「我要清空」的动作，刷新就把它撤销了。
删掉最后一条书签也一样 —— 用户看到的是「我删不掉这些书签」。

### 后果 ②：读不出来的值被种子覆盖（**不可恢复**）

`read()` 的返回类型是 `any | null` —— 「键不存在」和「键存在但解析不了」
**在类型上不可区分**，因为 `safeGet` 的 `catch` 把隐私模式和数据损坏
一律 `return null`（注释原话：「都当作没有」）。

实测（`/tmp/jerry-sb/read-fail-audit.mjs`，修复前 **3 / 9**）：

| 存储里的值 | 打开页面之后 |
| --- | --- |
| `jt:bookmarks` = `'{'`（截断） | 被 **22 条种子**顶掉，界面显示的正是那些种子 |
| `jt:bookmarks` = `'undefined'` | 同上 |
| `jt:bookmarks` = `'{"a":1}'`（合法 JSON 但不是数组） | 同上 |
| `jt:categories` = `'[{"id":"cat_a",'` | 分类被 6 条种子顶掉 |

最后一行还带**连带伤害**：分类被换成种子之后，用户那条好端端的书签
指向的 `cat_a` 不复存在 —— 变成了上一轮刚修过的「孤儿书签」。

**触发路径都不是「用户手贱」这么简单**：

1. 那个键被外部写坏（浏览器扩展 / DevTools 手改 / 旧版本残留）；
2. **恢复了一个形状不对的备份** —— `normalizeSnapshot()` **只校验键名、
   不校验值的形状**，所以 `{"bookmarks": {"a":1}}` 会被原样写进存储，
   下次启动判空 → 灌种子；
3. （云端）RLS 把行过滤掉时 PostgREST 返回的是**空数组而不是错误**。

真正的问题不在「数据会坏」，而在**应用对坏数据的响应把「可恢复」变成了「不可恢复」**：
原字节被种子覆盖之后，连手工抢救的机会都没有了。

### 后果 ③：导出的备份缺表，却告诉你「备份已下载」

`readAll()` 会静默跳过读不出来的键，于是备份里少一张表，
而 `doBackup()` 无条件报「备份已下载」。实测：`jt:notes` 就是这么消失的 ——
备份里只有 `["jt:categories","jt:bookmarks","jt:sites","jt:users","jt:seedVersion"]`，
**少的那张恰好就是读不出来的那张**，而 toast 说的是「备份已下载」。
用户以为手里有一份完整备份，等真要用的时候才发现缺的正是最重要的那张。

### 修法

| 文件 | 改动 |
| --- | --- |
| `src/data/storage.js` | 新增 **`readState(key)`**，把三态显式化：`'ok'` / `'absent'` / `'unreadable'`；云端适配器同步实现；`exportSnapshot()` 额外返回 `missing`（键存在但读不出来） |
| `src/composables/useStore.js` | `seedIfEmpty()` 改用 `readState` + **`seedVersion` 闸门**；`syncSeedAdditions()` 在有读问题时**整段跳过**；其余读取走新的 `readOr()` 并记录 `state.readProblems` |
| `src/App.vue` | 顶部**常驻**数据完整性告警条（可关闭，带「去数据备份」入口） |
| `src/components/SettingsPanel.vue` | `doBackup()` 有 `missing` 时改报「备份已下载，但有 N 项数据读不出来」 |
| `src/data/i18n.js` | 新增 `data.readProblem` / `data.readProblemAction` / `toast.backupIncomplete`（中英） |

三个关键判断：

- **判据用「`getItem` 返回什么」而不是「`JSON.parse` 成不成功」。**
  只有 `getItem` 返回 `null` 才代表键不存在。隐私模式（连 `getItem` 都抛）
  也归到 `unreadable`，**不能归到 `absent`** —— 算成 absent 会在
  「读不了」的时候往存储里灌种子，方向正好反了。
- **「从没灌过种子」用 `seedVersion` 判断。** 它在云端模式是 `LOCAL_ONLY`
  （回落到 localStorage），标记的是「**这台设备**有没有灌过」——
  正是要的语义：首次启动要灌，之后任何一次「空」都不再灌。
- **形状不对也算 `unreadable`。** 只校验「是不是数组」，
  但这一层就挡住了「恢复了一份错格式的备份 → 下次启动被种子顶掉」这条路。

⚠️ **一个有意为之的行为变化**：云端模式下，一个「书签表为空」的账号
不再被灌种子（`'rows'` 类型读到空表返回 `[]`，是 `'ok' + 空数组`，不是 `'absent'`）。
这正是「用户把云端书签删光了，别的设备登录不该把它复活」。
首次注册那条路不受影响 —— `enterCloudMode` 会先把本机数据迁移上去。

### 反向验证：别矫枉过正

改了判据，最容易的错是**连首次启动都不灌了**。所以同一个探针里带了两个反向场景：

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 全新用户（localStorage 全空） | 种子**必须**灌进去 | 22 条书签 / 6 个分类 ✓ |
| 老用户升级（有数据 + `seedVersion` 缺失） | 新增的 `b22` 要补上、原有那条不能动 | `["k1","b22"]` ✓ |

「修复前」的数字**不是靠改数据凑的**，而是把上一版 `dist`（写失败那轮上线的
`index-D0tInvqm.js`，不含本轮修复）原样挂在 5198 端口，用**同一份探针**跑出来的：

| 探针 | 断言数 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| `read-fail-audit.mjs` | 12 | 通过 3 / 失败 9 | **12 / 0** |
| `empty-vs-first.mjs` | 11 | 通过 8 / 失败 3 | **11 / 0** |

⚠️ `empty-vs-first` 修复前的 8 条绿里，有 5 条来自反向场景 0 / 0b ——
它们本来就该灌种子，新旧语义一致。真正的正向场景（1 / 2 / 3）是
「前提成立」通过、「没被灌回来」全部报红。**看失败数（3）比看通过数更有意义。**

### 造红

这两个探针的造红开关**不是环境变量，是改源码** ——
因为这个缺陷不是「元素在不在」，而是 `seedIfEmpty()` 里那个**判据本身**。

把 `useStore.js` 的

```js
const decide = (st) => {
  if (st.state === 'unreadable') return 'keep'
  if (st.state === 'ok') return 'use'
  return seeded ? 'keep' : 'seed'
}
```

临时换回旧语义：

```js
const decide = (st) => (st.state === 'ok' && st.value?.length ? 'use' : 'seed')
```

`read-fail-audit` 与 `empty-vs-first` 应当**大面积报红**，
而反向场景 0 / 0b **照常绿**（新旧语义在那里一致）——
这正好一次证明两件事：新判据确实在起作用，而且没有矫枉过正。

实测（改完在 dev 上跑，改回后 `diff` 与备份**逐字节一致**、复跑恢复全绿）：

| 探针 | 造红 | 说明 |
| --- | --- | --- |
| `read-fail-audit.mjs` | **4 / 8** | 唯一多出来的那条绿是场景 6（导出备份）—— 它走的是 `exportSnapshot().missing`，**根本不经过 `decide()`**，所以这个开关管不到它 |
| `empty-vs-first.mjs` | **8 / 3** | 与「修复前真产物」的 8 / 3 **完全一致** —— 说明这个开关确实等价于旧语义，不是另一种缺陷 |

⚠️ 这是**手工步骤**，改完记得改回来（探针头注释里写了同样的操作）。

### 验证层次

| 层 | 结果 |
| --- | --- |
| dev（5174） | 14 个探针全绿：orphan 18 / write-fail-audit 29 / **read-fail-audit 12** / **empty-vs-first 11** / settings 45 / tooltip 329 / tip-nodesc 67 / desc-verify 43 / desc-matrix 260 / drag 25 / i18n-render 14 / icon-ui 15 / i18n-parity 21 / icon-policy 34 |
| 另跑（不在 runner 里） | `unit-cloud` 48 / 0、`transfer-verify` 32 / 0、`transfer-ui` 31 / 0 —— 改了 `seedIfEmpty()` 和云端适配器，这三个必须单独验 |
| dist 子路径（5199） | 同上 14 个探针全绿 |
| 线上 | 同上 14 个探针全绿 |
| 产物一致性 | 主包 `index-BbdPx8jD.js`，本地与线上 SHA-256 均为 `d6f8564fcdca32e4c8c1bcdffffca50cfbf2cd56891817950ba6f625ab50ca08` |

⚠️ **跑线上时浏览器探针会被连接层抖动打崩**，实测两种形态：
`page.goto: Timeout 30000ms exceeded` 和 `net::ERR_CONNECTION_CLOSED`（重试也失败）。
崩点**全在 `seed()` 的 `goto` 上** —— 应用逻辑还没跑起来的时候。

判定「是不是代码回归」靠三条：① 崩在哪一行（`goto` ⇒ 不可能是代码问题）；
② 本地两层对齐（dev / dist 子路径，同代码同探针）；③ 纯逻辑探针（`i18n-parity`、
`icon-policy`，不碰网络）在同一轮里照常全绿。三条都指向网络，不是代码。

根因是**探针设计放大抖动**：每次 `load()` 要**两次完整导航**，光 A 段 12 个组合
就是 24 次，整个探针几十次真实网络往返 —— **连续几十次全页加载本身就会诱发它**。
一次抖动就抛异常、**连一条汇总行都不打**（批量跑时最容易混在绿灯里被放过）。

两处加固：
1. **探针层**：`seed()` 的 `goto` 加一次重试（60s 超时 + 打印第一次的失败原因）。
2. **runner 层**：探针崩掉时，若日志里有连接错就**等 25s 整条重试一次**。
   ⚠️ 判据是「有没有『通过 X / 失败 Y』汇总行」+「日志里有没有连接错」，
   **不是「exit 非零」** —— 断言失败会打印汇总行，那种不重试（重试也还是红）。
   两次输出都贴出来，**不掩盖第一次的失败**。

重试只影响「页面有没有加载出来」，**不碰任何断言** ——
真失败发生在页面加载**之后**，洗不绿。

⚠️ 批量 runner 还有个坑一并修了：**所有探针原来共用 `_r.log`**，
下一个探针会把上一个的输出覆盖掉。探针崩掉时（抛异常、没有「通过 X / 失败 Y」
汇总行）才想起要排查，而完整堆栈**已经没了**，只能整个重跑。
→ 改成**每个探针单独一个 `_run-<名字>.log`**，并且失败时额外补打 40 行。
**「失败时看不到失败原因」的测试基建，等于没有测试。**

---

## 两个标签页同时开着：后写的会把先写的抹掉

前几轮审的都是**错误处理**（设置项是否真的生效 → 写失败有没有被吞 →
读失败会不会被当成「没有数据」）。这一轮换一个**维度**，不是换一个说法：**并发 / 时序**。

### 根因：整表按内存写 + 完全没有跨标签同步

两条静态事实合起来就足以推出结论：

```js
// useStore.js
async function persist(key, value) {
  return storage.write(key, value)   // ← 整表按内存写：既不重读、也不合并
}
```

```js
// src/ 里搜不到任何一处 ——
window.addEventListener('storage', …)   // ✗ 没有
new BroadcastChannel(…)                 // ✗ 没有
```

于是**两个标签页各拿一份快照，谁后写谁把对方抹掉**。

⚠️ 而 `localStorage` 本来就有 `storage` 事件可以做跨标签同步 ——
**云端模式有 `supabase.channel()` 实时同步，本地模式却连「同一个浏览器里
另一个标签页」都不同步。本地实现与云端实现不对称，本身就是信号**
（上一轮 `writeAll` 就是靠这条线索找到的）。

### 实测（`/tmp/jerry-sb/multi-tab.mjs`，同一个 `browser.newContext()` 下的两个 `page`）

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| A 加一条 → B 再加一条 | 存储里**只剩 B 的**，A 那条**永久消失**（刷新也不在） | 两条都在 ✓ |
| 反向顺序（B 先 A 后） | 同样只剩后写的（**不是「谁先谁赢」的偶然**） | 两条都在 ✓ |
| A 删一条 → B 再加一条 | **被删的那条复活了** | 没复活 ✓ |
| A 改了数据 → B 的界面 | **毫无反应**；而 B 的 localStorage 已经变了 | 跟上了 ✓ |
| A 改主题 → B 的主题 | B 不跟（后写的一方会把主题改回去） | 跟上了 ✓ |

第 4 条**正是前三条的成因**：B 的界面没反应，说明 B 的**内存态已经落后于存储**，
之后 B 任何一次写盘都会把 A 的改动整表覆盖掉。所以这不是「没同步」这么轻，
而是**会丢数据**。

### 修法

| 文件 | 改动 |
| --- | --- |
| `src/composables/useStore.js` | 新增 **`initCrossTab()`**：监听 `storage` 事件，把其他标签页写的业务键解析后写回 `state`；键→字段的映射放在 `CROSS_TAB_FIELDS` 里，**带形状校验** |
| `src/composables/useSettings.js` | 同样监听 `storage`，但**复用已有的 `applyRemoteSettings()`** —— 它本来就是为「外部推来的设置」写的，只改内存不落盘 |

四个容易做反的判断：

- **`storage` 事件只发给「其他」标签页**（写的那一页收不到自己发的事件）——
  所以这段逻辑**不会自伤**：本页写盘不会把本页刚做的改动回滚掉。
  这也是它比「写前重读」更安全的地方。
- **`session` 必须允许 `null`。** 退出登录写的是 `JSON.stringify(null)`
  （字符串 `"null"`）。按「必须是对象」判会把它当坏值挡掉，于是
  **另一个标签页退了登录，这一页还显示登录着**。
- **坏 JSON / 形状不对 → 保持现有状态，别跟着变空。** 这是上一轮
  「读不出来 ≠ 没有数据」的同一条原则：读不出来时最坏的选择是当成「没有」。
- **`key === null`（另一个标签页调了 `localStorage.clear()`）时对齐成空值，
  但绝不写盘** —— 写盘会再触发一轮事件，两个标签页来回打。
  应用自己从不调 `clear()`（只有 DevTools / 探针会）。

⚠️ **云端模式直接返回**：那边有 `useRealtime` 的 `supabase.channel()`，
而且这些业务键在云端模式下本来就不写 `localStorage`。

⚠️ **一个如实记着的残留竞态**：如果两个标签页在**同一个事件循环 tick 内**
先后写盘，先写的那页可能还没来得及处理 `storage` 事件就被覆盖。
正常人手操作（几百毫秒级）撞不上。真要根治得把 `persist()` 改成「读-改-写」，
而整表语义下「合并」会把删除操作又复活回来 —— **那正是本条要修的 bug**，
所以这里选择不修，只记着。

### 反向验证：别矫枉过正

加了「收到事件就重设状态」的逻辑，最容易的错是**把本页自己的操作也打断**。
所以探针里带了反向场景：

| 场景 | 期望 | 实测 |
| --- | --- | --- |
| 单标签页连加两条 | 两条都在 | ✓ |
| 本页新增 + 本页删除 | 新增的还在、删掉的真的没了（**没被自己的监听复活**） | ✓ |
| A 改主题 | A 自己立即生效且已落盘 | ✓ |

### 造红

开关**不是环境变量，是改源码** —— 因为这个缺陷就是「这段监听存不存在」。
在 `useStore.js` 的 `initCrossTab()` 里、`addEventListener` 之前插一行
`if (true) return`；`useSettings.js` 同理（在 `if (!crossTabWired)` 之前）。
改完记得删掉（**这是手工步骤**）。

实测 **通过 12 / 失败 7**，7 条报红**全部落在修复目标上**，反向场景一条没红。

⚠️ 交叉验证：把**上一版产物**（`index-BbdPx8jD.js`，读失败那轮上线的，
不含本轮修复）挂在 5199 上跑**同一份 19 条探针**，得到的也是 **12 / 7**，
**失败项一字不差**。两条独立路径（造红 / 真·修复前产物）互相印证。

### 验证层次

| 层 | 结果 |
| --- | --- |
| dev（5174） | 15 个探针全绿：orphan 18 / write-fail-audit 29 / read-fail-audit 12 / empty-vs-first 11 / **multi-tab 19** / settings 45 / tooltip 329 / tip-nodesc 67 / desc-verify 43 / desc-matrix 260 / drag 25 / i18n-render 14 / icon-ui 15 / i18n-parity 15 / icon-policy 28 |
| dist 子路径（5199） | 同上 15 个探针全绿 |
| 线上 | 同上 15 个探针全绿 |
| 产物一致性 | 主包 SHA-256 本地与线上一致 |

> ⚠️ **`i18n-parity` / `icon-policy` 的条数在 2026-09-29 变了（21 → 15、34 → 28）**，
> 不是断言被删了：这两个探针文件当时被 `/tmp` 清掉了（见下节「顺手重建的验收基建」），
> 按**原意重建**，覆盖内容与原来不完全相同 —— 重建版补了两条更强的检查
> （代码引用的 key 是否存在、源码文本里的重复键），同时没有照抄原来那些冗余断言。
> **上表已经是重建后的数字**，别拿旧的 21 / 34 去比对。
>
> 2026-09-29 起，dist / 线上这一层还多跑一个 `reset-default`，合计 **16 个探针**。
>
> 2026-09-30 起再多一个 `transfer-cloud`，合计 **17 个探针**（见下节
> 「本机 → 云端的搬运：把「只做过静态修正」这句划掉」）。
> ⚠️ 它是**唯一一个会写真实 Supabase 项目**的探针（只动一个专用测试账号），
> 而且跑得慢（约 3 分钟）—— 因为里面真的在登录、真的在落库。

⚠️ **`multi-tab` 是本轮唯一一个需要「两个页面」的探针** —— 用
`browser.newContext()` 开**一个** context、再开两个 `page`：
同一 context 下的页面**共享 localStorage**（`sessionStorage` 才是每标签页独立的），
这就是一个真实的「双开」。

---

## 「恢复默认」到底该恢复什么（默认配置与清空后的归路）

### 起因

Jerry 的原话：

> 帮我把这个链接加入主站：`https://ai-study-exam.onrender.com/?date=2026-09-29&week=1#overview`
> 并且 Jerry 导航的恢复默认将原本的数据都清除了，帮我在默认书签和分类中有一个默认配置，
> 并添加这个书签：`https://tools.pdf24.org/zh/`

这句话里有**两个可以分开验证的命题**，所以还是先量再改。

### 一、先量：「恢复默认」真的清掉了数据吗？—— 没有

`/tmp/jerry-sb/reset-default.mjs` 场景 1：夹具 2 分类 / 3 书签，点那个按钮。

| | 点之前 | 点之后 |
| --- | --- | --- |
| 分类 | 2 | 2 |
| 书签 | 3 | 3 |
| 书签名 | 甲一 / 甲二 / 乙一 | 甲一 / 甲二 / 乙一 |

**一条都没动。** 它走的是 `useSettings.resetSettings()` →
`setSettings({ ...defaultSettings })`，落盘的只有 `jt:settings` 一个键，
**代码上碰不到 `jt:bookmarks` / `jt:categories`**。

场景 2 验证了它的真实职责（确实是设置回默认）：
`themeMode` Dark→system、`perRow` 3→5、`searchEngine` google→baidu、
`editMode` true→false。

**那用户的问题出在哪？** 出在**摆放**：这个按钮紧挨在「确认清除」分组
（清除分类 / 清除所有书签）**下面**，而且**自己不带分组标题**，
读起来就是第三个「清除」动作。

### 二、真正的缺口：清空之后，没有任何路能回到默认数据

场景 3：清空书签 + 分类 → 刷新 → **仍然是 0 / 0**。

这不是 bug，是 2026-09-27 那轮**有意**改的（见「读不出来 ≠ 没有数据」一节）：
`seedIfEmpty()` 的判据是「**键不存在** + 从没灌过种子」，`seedVersion` 一落盘
就再也不会灌 —— 因为「用户主动清空、刷新就复活」说不过去。

代价当时没意识到：**判据收紧之后，「回到默认」这条路也一起没了**。
两条合起来就是 —— 按了「恢复默认」，数据不但没回来，还什么都没发生。

### 三、修法：拆成两个按钮

```
[恢复默认]
  [恢复默认设置]  [恢复默认数据]
  「恢复默认数据」会用内置的默认分类与默认书签覆盖你现有的分类和书签。
```

「恢复默认设置」保持原语义（只动设置项），新增的「恢复默认数据」走
`useStore.resetToDefaults()`：把 `seedCategories` / `seedBookmarks`
**clone 后整套写回**，并带二次确认。两个按钮都放进**带标题**的分组里，
不再挂在「确认清除」下面。

四个判断：

| 判断 | 为什么 |
| --- | --- |
| **必须二次确认** | 它会覆盖用户自己加的所有分类与书签。确认文案写明「会覆盖、不可撤销」。 |
| **写盘失败要回滚 + 如实报错** | 同 `clearBookmarks()` 的纪律（见「写失败审计」一节）。 |
| **`clone()` 不能省** | 种子是模块级常量。直接塞进 `state` 会被后续编辑改坏，下一次恢复就脏了。 |
| **`seedVersion` 也推到 3，但它失败不算整体失败** | 业务数据已经落盘了，为一个进度标记把刚恢复好的数据回滚掉更糟。 |

⚠️ **如实记着的残留：两个键不是原子的。** `categories` 写成功、`bookmarks`
写失败时，内存会整体回滚，但存储里的 `categories` 已经是新的 ——
刷新后会看到「新分类 + 旧书签」。localStorage 没有事务，要根治得把两份数据
合成一个键（会牵动所有读写路径）。这里选择与 `clearCategories()` 保持同一种
做法并记下来，而不是假装原子。

### 四、默认配置本身一直是完整的：6 分类 / 22 条 → 24 条

场景 0 实测：全新用户拿到 **6 个分类 / 22 条书签**、界面渲染 22 张卡 ——
种子**一直是完整的**，`seed.js` 在 git 历史里也**从未被清空过**（4 次提交都在）。
缺的只是 Jerry 点名要的那两条。

新增：

| id | 名称 | 分类 | 地址 | 图标 |
| --- | --- | --- | --- | --- |
| b23 | Agent Lab | 学习成长 | `https://ai-study-exam.onrender.com/` | 写死 `/assets/favicon.svg` |
| b24 | PDF24 Tools | 效率工具 | `https://tools.pdf24.org/zh/` | 留空（回落 `/favicon.ico`） |

三条判断：

1. **只存站点根地址，不存他复制过来的深链。** 他给的是
   `…?date=2026-09-29&week=1#overview`，而这是**给所有人看的默认值** ——
   里面写死一个日期，过一周就指向旧周次了。想要深链，编辑那条书签即可。
2. **b23 的图标必须写死。** 它的 `/favicon.ico` 是 **404**
   （返回 `application/json`，那台机器是纯 API 服务），真正在用的是 HTML 里
   声明的 `/assets/favicon.svg`（实测 200 / svg）。留空的话 `faviconOf()`
   会回落到那个 404 地址，卡片上只剩首字母。
3. **b24 的图标留空是有意的，但它并不省流量。** `faviconOf()` 会回落到
   `https://tools.pdf24.org/favicon.ico`（200，但那是 **143 KB** 的 ico）——
   写死同一个地址效果完全一样，所以不写，少一个要维护的常量。

书签名取自站点自己的 `<title>`：**「Agent Lab · 学习工作台」**，
所以叫 `Agent Lab`（`ai-study-exam` 只是域名）。

### 五、老用户怎么才能看到这两条：`SEED_VERSION` 2 → 3

`seedIfEmpty()` 只在**存储为空**时灌种子，所以 Jerry 自己（localStorage 里
已经有数据）**永远看不到新条目** —— 表现是「代码改了、部署也成功了，
但自己打开还是老样子」。所以 `SEED_VERSION` +1，并在 `SEED_ADDITIONS` 里
登记 `3: { bookmarks: ['b23', 'b24'] }`。

⚠️ 登记的是**具体 id**，不是「补所有缺失的 id」—— 后者会把他删掉的条目复活。
实测场景 0b：老用户升级后是 `["k1","k2","k3","b22","b23","b24"]`，
原有 3 条书签、2 个分类**一条没丢**。

### 六、探针自己抓到的真 bug：漏了一个 i18n 键

写二次确认时漏了 `settings.resetDataConfirm`。`translate()` 取不到键时
**退回 key 本身**，所以弹窗正文会明晃晃显示 `settings.resetDataConfirm`
这串英文 —— **编译不报错、其余探针全绿**。

重建 `i18n-parity.mjs` 时补了一条「代码里 `t('字面量')` 引用的键必须存在」，
它**当场就红**：

```
❌ 代码引用的字面量键都存在于字典里  → ["settings.resetDataConfirm"]
```

补上中英两条后转绿。顺带这条守卫还抓到**我自己制造**的另一个问题：
删 `common.reset` 时把上一行改成了 `common.cancel`，于是 zh 字典里出现了
两个 `common.cancel` —— 对象字面量重复键是「后者胜、不报错」，
**import 之后根本查不出来**，所以 `i18n-parity` 现在会额外读**源码文本**
再查一遍重复键。

### 七、造红

开关是**改源码**：在 `useStore.resetToDefaults()` 第一行插
`if (true) return false`（改完必须逐字节还原，本轮用 `shasum -c` 验过）。

实测 **通过 34 / 失败 11** —— 11 条**全部**落在「恢复动作真的发生了」这一类
（场景 4 的 9 条 + 场景 6 的 2 条），而**反向场景照常全绿**：
场景 5（点取消不误伤）、场景 7（写盘失败如实报错 + 内存回滚）、
场景 0/0b/1/2/3 一条没红。这证明「取消」「写失败」那两组不是空转。

⚠️ 种子那两条链接的断言**不必再造红** —— 它们在**修复前产物**上本来就是红的
（见下表 5199 那一行），一红一绿已经证明了有效性。

### 验证层次

| 层 | 结果 |
| --- | --- |
| 修复前产物（`index-Bx97FfON.js`，即线上那一版） | `reset-default` **通过 25 / 失败 20** |
| 修复后 dist 子路径 | `reset-default` **45 / 0** |
| 造红 | **34 / 11**（11 条全落在修复目标上，反向场景全绿） |
| dev（5174） | `reset-default` 45/0、`i18n-render` 14/0 |
| dist 全量 16 探针 | 全绿 |
| **线上**（Actions `36535488726`） | **16 个探针全绿**；主包 SHA-256 与本地逐字节一致 |
| 纯逻辑 | `i18n-parity` 15/0、`icon-policy` 28/0 |

线上主包 `index-CH9v3k6X.js` =
`6a1dfe566b53ecbd4a44fcd837aa57d918b0c3f06a285e1c6b45325f8bbf353e`，
与本地 `dist/` 用 `cmp` 比对**逐字节一致**。

⚠️ **线上那轮 `desc-verify` 抖动过一次**：第一次 `exit=1`、日志里是连接层错、
**没有汇总行** → runner 判定「崩掉 + 有连接错」→ 等 25s 整条重试 → **43 / 0**。
**这次重试不是多余的** —— 没有它，这一轮线上回归就会多一个假红，
而它崩在 `page.goto`（应用逻辑还没跑起来），**看起来会像代码回归**。

> 顺带一条判据：判断「这次重试了哪些探针」要看 **`_run-*-retry.log` 的文件时间戳**，
> 别只看文件存不存在 —— `_run-orphan-bookmarkslive-retry.log` /
> `_run-settings-auditlive-retry.log` 是 09-27 那轮留下的旧文件。

对照报告：`make-resetdefault-report.mjs` → `shots/reset-default-before-after.html`
（**证据全部读 `_rd-before` / `_rd-after` / `_rd-break` 三份原始日志，一个字不手写**）。
这轮尤其必要 —— 因为本轮最值得记的结论恰恰是「**直觉里的结论是错的**」
（用户报的 bug 不成立），手写报告就会把「我以为的」写进去。

### 八、顺手重建的验收基建（`/tmp` 被系统清掉了）

2026-09-29 发现 `/tmp/jerry-sb` 里 **`loader.mjs` / `i18n-parity.mjs` /
`i18n-render.mjs` / `icon-policy.mjs` 四个文件不见了**（同目录其余文件都还在，
macOS 清 `/tmp` 不是全有全无）。都按原意重建，并按上面说的补了更强的检查。

⚠️ **沙箱坑（本轮新踩，很重要）**：`.env.local` 被文件代理当成敏感内容拦下，
**后台任务里审批会超时**：

```
Error: Sensitive content approval timed out. The operation was not authorized and was blocked.
    at Object.wrappedReadFileSync (node-brokered-fs-shim.cjs)
    at loadEnv (vite/…/dep-Dm0c1Wj2.js:16945)
```

`vite dev` 和 `vite build` 走的是**同一个** `resolveConfig` → `loadEnv`，
所以两者都会撞上。而且表现不一样：

- `vite build` **直接报错退出**（错误信息完整，一眼能看懂）；
- `vite dev` **静默挂起** —— npm 的 spinner 一直转、端口永远不监听、
  `--debug` 也只打到「loading env files」就没了。**只有把 vite 单独拉起来
  看 stderr 才看得到真相。**

**结论：vite 的 dev / build 必须在前台跑**（前台会弹审批并放行）。
`npm run dev` 在前台跑会撞上前台超时，然后**自动转后台且不丢状态**，正好可以利用。

另外 `vite.config.js` 里 `base` 是 dev=`/`、build=`/jerry-tools/`，
所以模拟线上子路径**不能**用 `vite preview`（它对所有路径都回退 index.html，
连 `/assets/*.js` 也回退，「产物缺文件」这类问题永远测不出来）——
要用自己的静态服务（本轮重写了 `serve-static.mjs`，原来的 `pages-server.mjs`
也一起被清掉了）。

---

## 本机 → 云端的搬运：把「只做过静态修正」这句划掉（2026-09-30）

### 起因

`useAuth.transferLocalToCloud()` 里有三行「检查每张表的 `storage.write` 返回值」，
是**写失败审计**那轮补的。但当时的源码注释自己写着：

> ⚠️ 探针 `write-fail-audit.mjs` **没覆盖这条** —— 它要求登录态。这里只做了静态修正，
> 改动本身与其余三处同构，但**没有动态验证**，别当成已验证。

一条**记着「没验过」的改动**，就是一笔挂着不还的债 —— 而且它长得跟已验证的一模一样。
这一轮就是来还它的。

### 为什么不能只靠已有的证据

| 已有证据 | 它到底证明了什么 |
| --- | --- |
| `_std-transfer-verify.log`（32 / 0） | **模块级、打桩**：storage 换成假实现，直接调纯函数。证明的是「合并逻辑对」，**碰不到**「写失败时 `storage.write` 到底返回什么」 |
| `write-fail-audit.mjs`（29 条） | 故障注入做得很好，但它跑在**未登录**状态 —— 而这个函数第一行就 `if (!isCloudActive()) return`，压根进不去 |
| 读代码 | 这三行「看起来对」。**「看起来对」正是上一轮把它留下的原因。** |

### 做法：真浏览器 + 真 Supabase + **查库**当判据

`/tmp/jerry-sb/transfer-cloud.mjs`（35 条断言，7 个场景）。

三个设计要点，缺一条这个探针就会变成「自己证明自己」：

1. **断言直接查库，不看界面自述。** 用 REST（带测试账号的 access token）读
   `categories` / `bookmarks` 的**实际行**。这个 bug 的形态恰恰是
   「界面说成功、库里没有」—— 只看 toast 的探针永远抓不住它。
2. **写失败用 `addInitScript` 拦 `fetch`**，而不是打桩 storage：
   - `'http'` → 对非 GET 的 `/rest/v1/*` 回 403（等价 RLS 拒绝）→ `writeCloud` 走 `if (error) return false`；
   - `'reject'` → `fetch` 直接抛（等价断网）→ 走 `supabaseAdapter.write` 的 `catch`。
   两条**不同的**代码路径，结果都必须是 `write_failed`。
3. **测试账号是专用的**（`jt-transfer-probe@jerry.tools`），每轮开头清空、结尾再清空，
   不碰任何真实用户的行。

### 结果

| 层 | 结果 |
| --- | --- |
| dev（5174） | **35 / 0** |
| dist 子路径（5199） | **35 / 0** |
| 线上 | **35 / 0** |

**结论：这三行返回值检查是对的，一处不用改。** 源码里那句「没有动态验证」已改成
「✅ 2026-09-30 补上了动态验证」，并附上造红数字。

### 造红：证明这 35 条真的能红

全绿本身不是证据。两处**独立**的造红，红的症状各不相同：

| 造红 | 改哪里 | 结果 | 红的症状 |
| --- | --- | --- | --- |
| A | `useAuth.js`：去掉那三行返回值检查，退回「无条件 `changed: true`」 | **31 / 4** | 谎报「已上传：新增 1 条书签、0 个分类」——**而云端一条都没多** |
| B | `SettingsPanel.vue`：去掉 `write_failed` 分支，让它落进「其余一切」 | **33 / 2** | 把写失败说成「本机没有可上传的新数据」——用户在被告知「数据早就在云上了」 |

两个数字互不重叠、红的断言也互不重叠 → 两道守卫**各自独立可验**。
（造红 A 只红「有没有谎报成功」那 4 条；造红 B 只红「提示文案对不对」那 2 条。）

### 这轮踩的坑（都记在探针注释里）

1. 🔴 **夹具假设错了，而且是「清空被应用自己撤销」。**
   第一版：登录 → DELETE 三张表 → 断言云端为空 → 刷新。
   DELETE 明明成功（实测 `countsAfter` 全 0），**刷新一次就回到 6 分类 / 24 书签**。
   原因：页面启动时先在**本地模式**把种子写进 `localStorage`，恢复会话后
   `transferLocalToCloud('fill')` 判定「云端为空、本机有数据」→ **把本地种子迁回云端**。
   这是应用的正确行为（首次登录就该搬），错的是夹具。
   正解：清完云端**立刻连本地业务键一起清掉**并钉住 `jt:seedVersion`，
   而且「云端为空」这个断言必须在**不刷新**的前提下做。
2. 🔴 **`toasts()` 去重导致漏检重复文案。** 原来用「动作前读一次、动作后 diff」，
   而 S5 和 S6 的期望文案**一模一样**，`Set` 去重后 diff 为空 → 报「没有提示」的假红。
   正解：动作前把日志清空，动作后读到的就全是这次的。
3. 🔴 **注入标志会被重载冲掉。** `window.__failCloudWrites` 是 `addInitScript` 里的，
   **一重载就归零**。原来在外面设、里面点，中间夹着一次未落定的重载 → 标志失效 →
   S6 那次上传**真的成功了**（云端从 4 变 5）。正解：把设标志挪进点击函数内部。
4. 🔴 **「固定 sleep 之后读一次」必然慢一步。** `pushLocalToCloud()` 的往返时间不定，
   成功路径还要再等 900ms 才 `location.reload()`。实测 S3 读到 `[]`、
   S4 却读到了 S3 那条。正解：**轮询到 toast 出现为止**。
5. ⚠️ **造红时探针崩掉 ≠ 探针坏了。** 造红 A 里 S5 谎报成功触发了 `location.reload()`，
   把设置面板关掉，S6 于是找不到按钮、崩在 click 超时。
   那是探针**正在正确地报告一个 bug**。修法是让 `clickUpload` 自己确保面板开着、
   并等按钮出现；最后一步再包一层 try/catch —— 抛错记一条红，别让整轮报告消失。
6. ⚠️ **「读数早于渲染」的假红。** 重载后立刻数 `.bm-card` 会读到 **0 张**，
   看起来像「界面被清空了」。正解：先等卡片出现再数。

### 一处不是 bug 的发现

测试账号在**清空云端 + 刷新**之后能自己把 24 条种子迁回来 —— 这**不是**缺陷，
是 `transferLocalToCloud('fill')` 在正常工作。但顺带说明了一件事：
**只要本机有种子、云端为空，任何一次页面加载都会把种子推上去。**
想让云端真的空着，必须连本地一起清。

---

## 三道 i18n 守卫（2026-10-02 补第三道）

### 为什么需要三道

前两道**各有一个结构性盲区**，合起来看着像「i18n 已经守住了」，其实有个大洞：

| 守卫 | 扫什么 | 盲区 |
| --- | --- | --- |
| `i18n-parity.mjs` | 源码里 `t('…')` 的**字面量** | **压根没调 `t()` 的字符串它看不见** |
| `i18n-render.mjs` | **正常渲染**出来的页面文字 | **只在错误分支 / 冷门分支出现的文案扫不到** |
| **`i18n-text-guard.mjs`**（新） | **引号里的中文**（静态） | —— |

典型漏网就是「登录失败时的错误文案」——
只有输错密码才显示，正常扫页面永远碰不到。

### 第三道扫出来什么

`scan-hardcoded-text` 逐行剥注释后找引号里的中文，44 个文件命中 **94 处**，
其中**用户可见的约 25 条**：

| 文件 | 内容 | 英文界面下原本会看到 |
| --- | --- | --- |
| `views/LoginView.vue` | 5 条登录/注册错误 + 「操作失败」 | 中文报错 |
| `composables/useClock.js` | **日期格式** + **28 条 WMO 天气描述** | 「10月2日 周五」「大部晴朗」 |
| `views/AdminView.vue` | 「备注」「编辑备注」「输入备注信息...」 | 后台备注弹窗 |
| `components/TopBar.vue` | 「（新窗口打开）」 | 无障碍提示 |
| `components/BookmarkCard.vue` | 「拖拽排序」 | title 提示 |
| `data/themeColors.js` | 10 个主题色名 + 6 个渐变名 | 色块 tooltip |

全部搬进了 `i18n.js`（中英各 64 条），并顺手清掉 `router` 里
**6 个没人读的 `meta.title`**（死数据，见下）。

### 两个「不能硬拼」的地方

- **日期**：中英语序不同，所以走**格式串**（`date.format`）：
  zh `'{m}月{d}日 {w}'` → 「10月2日 周五」；en `'{w} {m}/{d}'` → 「Fri 10/2」。
  硬拼的话英文界面会变成「Fri 10月2日」。
- **天气**：`weather.text` 原来是**在 `apply()` 里写死的中文字符串** ——
  那样切语言不会更新。改成 `weatherText` **computed**（跟着 `settings.language` 重算）。
  ⚠️ 顺手补了一个会漏的分支：`failWeather()` 原来往 `weather.text` 塞「无法获取天气」，
  把字段删掉之后如果 `weatherText` 不接住 `weather.failed`，
  失败状态会**一直显示「获取天气中」**——看着像还在加载，其实是失败了。

### ⚠️ 顺带修了 `i18n-parity` 自己的一个 bug

改完跑它，报「引用了不存在的键 `…`」。查下来是**守卫不剥注释**：
我在 `i18n.js` 的注释里写了一句「parity 只扫 `t('…')` 的字面量」，
它就把注释里的 `t('…')` 当成了真实引用。

**修的是守卫，不是注释** —— 改注释只是把这次绕过去，
下一个人写同样的注释还会踩。修完造红验过：真引一个不存在的键仍然会被抓到。

### 怎么验的

| 层 | 命令 | 结果 |
| --- | --- | --- |
| 静态 | `npm run check:i18n` → `scripts/check-i18n-text.mjs` | **6 / 0**（造红 2 次：注入硬编码 → 红；删一个 WMO key → 红） |
| 静态 | `npm run check:i18n` → `scripts/check-i18n-parity.mjs` | **15 / 0**（修完注释 bug 后；造红：引用不存在的键 → 红） |
| dist 渲染 | `/tmp/jerry-sb/i18n-render.mjs` | **14 / 0** |
| dev + dist | `/tmp/jerry-sb/i18n-en-check.mjs`（新） | **15 / 0 / 0**（造红：英文日期改回中文格式 → 红 2 条） |

`i18n-en-check.mjs` 是**切到英文、读真实渲染出来的文字**：
顶栏日期 / 天气描述 / 主题色与渐变的 tooltip / 拖拽手柄 title /
登录失败的错误 / 后台备注弹窗，逐个断言「不含中文」。
这是唯一能证明「英文界面下真的显示英文」的判据 ——
前两道守卫只能证明「键存在」和「没漏出键名」。

⚠️ 写它时踩了个坑：**语言是按浏览器上下文存的**（localStorage `jt:settings`），
新开的 context 默认是 `zh` —— 不种这一下，测的还是中文，
会**误判成「代码没改好」**。（登录还会切到云端那份设置，登录完要再点一次开关。）

### 🔴 搬进仓库 + 挂进 CI（2026-10-05）

**之前三道守卫都住在 `/tmp/jerry-sb/`** —— 跑不跑全凭记得，而且**脚本本身会被系统按文件清理**
（已经丢过 `loader.mjs`、`i18n-parity.mjs`、`unit-cloud.mjs`、`empty-vs-first.mjs`…）。
那不算守卫，那算「碰巧还在」。

现在两道**纯静态**的搬进了仓库（它们零依赖，不需要浏览器、不需要 Supabase、不需要 dev server）：

| 仓库里 | 原 `/tmp` 名 | 查什么 |
| --- | --- | --- |
| `scripts/check-i18n-parity.mjs` | `i18n-parity.mjs` | 键位双向一致 / 占位符一致 / 引用的键存在 |
| `scripts/check-i18n-text.mjs` | `i18n-text-guard.mjs` | 源码里有没有「该翻译但硬编码」的中文 |

```bash
npm run check:i18n     # 两道都跑，任一失败 → 退出码 1
```

搬的时候改掉了两处**只在原机成立**的假设：

- **绝对路径**（`/Users/jiepijiang/workbuddy-ai/jerry-tools`）→ 由脚本自身位置推出仓库根：
  `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')`。
  CI 里的检出路径不叫这个，写死就必挂。
- **`@/` 别名**（parity 原来 `import { messages } from '@/data/i18n'`）→ 改成
  `'../src/data/i18n.js'`。用别名得挂 ESM loader，CI 里平白多一层依赖。
  （`src/data/i18n.js` 自己不 import 任何东西，能直接读 —— 这也是它当初被选中当字典的原因。）

**接进 CI，位置在 `npm ci` 之前**（`.github/workflows/deploy.yml`）：

```yaml
- name: 检查 i18n（静态）
  run: npm run check:i18n
```

放这个位置是因为它们**零依赖** —— 文案漏了就别浪费一次安装和构建。

`npm run check:i18n` 用的是 `p=$?; ... ; exit $((p + t > 0))` 而**不是 `&&`**：
`&&` 短路的话，parity 挂了就看不到 text 的结果，得修两次、推两次。
现在两道都跑完再报，一次看全。

**验证（造红两次，两个方向都验了）**：

| 造的因 | `npm run check:i18n` | 表现 |
| --- | --- | --- |
| 无 | **exit 0** | 全绿 |
| 注入一条硬编码中文 | **exit 1** | text 那条红，**parity 的断言照样跑完** |
| 删掉 `weather.wmo.65`（只让 parity 挂） | **exit 1** | parity 红 ×2，**text 的合计照样出来** |

⚠️ 另外验过：脚本**从任意 cwd 跑都能过**（`cd /tmp && node …/scripts/check-i18n-parity.mjs` → 15/0）。
CI 的工作目录、本地的工作目录、你手动 cd 到别处 —— 都得成立。

**「步骤跑了」和「守卫能拦住」是两件事，两件都验了**：

1. **跑了**：`gh run view <run-id> --json jobs` 里能看到第 4 步 `检查 i18n（静态）`；
   日志里两道守卫的输出都在（parity `通过 15 / 失败 0`，436 键；text `0 处命中 + 3 处按名单放行`）。
2. **能拦住**：CI 的 shell 是 `bash -e`（不是默认的 `sh`），得确认这个外壳
   不会吞掉 npm 的退出码、也不会让第一道失败就跳过第二道。本地按**同样的外壳**复现：

   ```bash
   bash -e -c 'npm run check:i18n'
   # 绿 → exit 0
   # 红 → exit 1，且 parity 的「通过 15」与 text 的红同时出现在输出里
   ```

   （没有往 main 推一个故意坏的提交去验 —— 那样会留下一条红记录，
   而且万一守卫真没拦住，`deploy` 就会把坏产物发到线上。复现外壳是等价且零风险的。）

剩下三道（`i18n-render` / `i18n-en-check` / `boot-timing`）**进不了 CI**：
它们要真浏览器 + 真 Supabase（而登录还得穿过代理），属于端到端层，只能手工跑。

### 有意**没**改的两处

- **`iconSchemes` 的 12 个名字本来就是英文**（Slate Mist / Porcelain…），
  不是硬编码中文，第三道守卫也不会报它。要中文化得先有中文名，等有需求再说。
- **农历**（`utils/lunar.js` 的干支 / 节气 / 节日 / 月日名）——
  农历本来就是中文的，硬翻反而别扭。已在守卫的 `DATA_FILES` 名单里写明理由。

---

## 首屏加载：白屏 3.5s → 有内容 30ms（2026-10-02）

### 先量：白屏到底花在哪

`/tmp/jerry-sb/boot-timing.mjs`（`addInitScript` 装 MutationObserver + 监听 supabase 请求，
**不改应用代码**）。已登录时整页加载，实测：

```
#app 首次有内容：3388 ms
supabase 请求 15 发，几乎全是串行，每发 ~250ms（到 supabase 的 RTT）
  最后一发结束于 +3363 ms
```

根因两条：

1. **`loadAll()` 里 7 个串行 `await`**（favorites / submissions / feedback /
   notes / users / visits / share）—— 7 × 250ms ≈ **1.5s**
2. **`seedIfEmpty()` 里 3 个串行读**（categories / bookmarks / sites）—— 又 ~500ms
3. `enterCloudMode()` 里 `reloadStore()` 与 `initSettings()` 也是串行 —— 再 ~250ms

**而且这些全在 `mount()` 之前** → 用户看到的是**纯白屏**。

### 改了三处

| 位置 | 改动 |
| --- | --- |
| `useStore.loadAll()` | 7 个独立读 → `Promise.all`（写的是不同的键，`readProblems` 的 push 顺序无所谓） |
| `useStore.seedIfEmpty()` | categories / bookmarks / sites 三个读 → `Promise.all` |
| `useAuth.enterCloudMode()` | `reloadStore()` 与 `initSettings()` → `Promise.all`（两者互不依赖；`initSettings` 仍需在 `startRealtime` 之前，这条仍然满足） |
| `index.html` | 加一段**首屏占位**（转圈），`mount()` 会整个替换掉它 |

### 结果

| | 之前 | 之后 |
| --- | --- | --- |
| 白屏（`#app` 有内容） | 3388–3637 ms | **24–40 ms** |
| 真应用挂载 | ~3.4–3.6 s | **1.26–1.57 s** |
| 请求批次 | 15 发串行 | **4 轮并行** |
| 最后一发请求结束 | +3363 ms | +1122 ms |

剩下的 4 轮是**语义上必须串行**的：`profiles`（initAuth）→ 迁移读云端 →
`seedIfEmpty` → `loadAll`。迁移必须先于 `seedIfEmpty`（它可能写数据），
`loadAll` 也必须在迁移之后（要读到写后的状态）—— 所以**不能再合**。

> ⚠️ `categories` / `bookmarks` 在时间线里出现两次（迁移读一次、`loadAll` 读一次）。
> 这是**必需的**，不是重复：迁移可能改了云端，`loadAll` 必须读到改后的状态。

### 首屏占位为什么写在 `index.html` 而不是组件里

`bootstrap()` 是「settings → auth → store → **才 mount**」，
那几秒**组件还没挂载** —— 组件里做骨架屏救不了这一段。
只有写在 `index.html` 里，才能从「HTML 到位」就开始显示。

配套细节：
- 样式必须是**行内 / `<head>` 里的小段 CSS**：打包的 CSS 这会儿可能还没下载完；
- 默认 `themeMode` 是 `system`，所以用 `prefers-color-scheme` 跟着系统走；
- 尊重 `prefers-reduced-motion`（转慢一点，但**不停** —— 静止的环看着像卡住了）。

### 怎么验的

`boot-timing.mjs` 已经从「量时间的脚本」升级成**带断言的探针**
（不然以后有人改回串行也没人发现）：

| 断言 | 阈值 | 说明 |
| --- | --- | --- |
| 占位出现 | ≤ 400 ms | 不再白屏 |
| 真应用挂载 | ≤ 2500 ms | |
| **请求轮数** | ≤ 5 | **主判据**：结构性的，不受网络抖动影响 |
| 最后一发请求 | ≤ 1800 ms | |
| 挂载后占位消失 | — | `#app` 里没有 `.boot-splash` |

跑 3 轮：dev **15 / 0**、dist **15 / 0**。
**造红**（把 `loadAll` 的 7 个读改回串行）：轮数 4 → **10**、
最后一发 1218 → **2626 ms**、挂载 1264 → **2675 ms**，三条断言如期报红。

**回归**（改的是数据加载主路径，必须跑）：
`transfer-cloud` **35/0** · `reset-default` **45/0** · `multi-tab` **19/0** ·
`route-guard` **32/0/1** · `feedback-flow` **29/0** ·
`i18n-parity` **15/0** · `i18n-text-guard` **6/0** · `i18n-render` **14/0**。

### ⚠️ 踩到的坑：探针改了**共享测试账号**的状态没还原

跑回归时 `transfer-cloud.mjs` 的 S3 报「上传按钮不可见」，我一度以为是自己改坏了
`loadAll`（因为我把 `state.session = profile` 挪到了 `Promise.all` 之后）。
**stash 掉全部改动再跑一遍 —— 同样的红**，才确认不是回归。

真因：`i18n-en-check.mjs` 在**登录状态下点了语言开关**，而语言在登录后存的是
**云端** `user_settings` —— 把共享测试账号的语言永久改成英文了。
于是那个探针找「数据备份」按钮当然找不到。

修法：给 `i18n-en-check.mjs` 加了**收尾还原**（跑完把语言切回中文）。
教训是「**探针动了共享状态就要还原**」，而且这类污染的**症状指向别的探针**，
根因却在更早的那次运行里 —— 排查时**先 stash 改动做对照**比读代码快得多。

---

## 待办

- [x] **硬编码文案 + 补第三道 i18n 守卫**（2026-10-02）
      两道老守卫各有一个盲区（`i18n-parity` 看不见没调 `t()` 的字符串、
      `i18n-render` 扫不到错误分支），漏掉约 25 条用户可见的中文。
      全部搬进 `i18n.js`（中英各 64 条），并新增 `i18n-text-guard.mjs` 静态扫。
      详见「三道 i18n 守卫」一节。
- [x] **把两道静态 i18n 守卫搬进仓库并挂进 CI**（2026-10-05）
      `scripts/check-i18n-parity.mjs` + `scripts/check-i18n-text.mjs`，
      `npm run check:i18n`，CI 里放在 `npm ci` **之前**。
      搬的时候去掉了绝对路径与 `@/` 别名（否则 CI 里必挂）。
      详见「三道 i18n 守卫 → 搬进仓库 + 挂进 CI」。
      剩下三道（`i18n-render` / `i18n-en-check` / `boot-timing`）要真浏览器 + 真 Supabase，
      **进不了 CI**，仍是手工层。
- [x] **接上「反馈」链路**（2026-10-02）
      原来整条链路**没实现** —— 用户侧没有入口、`/admin` 的「反馈」tab 永远是空列表、
      `sendReply()` 往库里不存在的 `f.replies[]` push 且完全不落盘。
      现在：设置面板加「反馈」分区，写入全走 RPC（`006-feedback-rpc.sql`），
      `feedback` 在客户端是**只读表**（`rpcOnly` 硬拒绝整表写）。
      探针 dev **29/0**、dist **27/0/1 跳过**、迁移本身用 PGlite **30/0**。
      详见「`submissions` / `feedback` 两张表」一节。
- [ ] **用户删不掉自己的反馈** —— `feedback_delete using (is_admin())` 只放行 admin。
      探针跑一次就在库里留一行，只能由管理员清。
      要不要开一条「撤回自己的反馈」？（需要一条 RPC，别直接开 delete 策略。）
- [ ] **`submissions` 是弃用表** —— 用户提交站点实际走 `discover_sites`，
      这张表没有任何写路径。留着不占空间，但会让人以为它有用。
- [x] **`/admin` 和 `/icon-management` 的路由守卫**（2026-10-02）
      原来这两个路由**没有任何守卫**，任何登录用户都能进，看到一屏他写不进去的按钮。
      现在：未登录跳 `/login?redirect=`、非管理员弹回首页并提示、**本机模式放行**
      （本地模式没有任何人会是 admin，拦了会把站长自己锁在外面）。
      探针 dev **36/0/0**、dist **29/0/1 跳过**；造红两次（守卫放行 → 10 红、
      `safeRedirect` 返原值 → 3 红）。详见「路由守卫」一节。
- [x] **已登录时整页加载白屏 3.5 秒**（2026-10-02 发现 + 当天修掉）
      `loadAll` 7 个串行读 + `seedIfEmpty` 3 个 + `enterCloudMode` 2 个，
      全在 `mount()` 之前 → 纯白屏。改成并行 + `index.html` 加首屏占位：
      **白屏 3.5s → 30ms，真应用挂载 3.5s → 1.3s**。
      详见「首屏加载：白屏 3.5s → 有内容 30ms」一节。
- [x] 接 Supabase：账号体系、跨设备同步、分享页、网站审核真正落库
- [x] 实时多端同步（`supabase.channel()` 订阅表变更）
- [x] 发现页的 `collects` 收藏数接真实数据（`favorites` 触发器维护，见「收藏数是怎么算的」）
- [x] **跨标签页同步**（2026-09-27）
      起因是换了个审计角度：前几轮审「错误处理」，这轮审**并发** ——
      发现 `persist()` 整表按内存写、且 `src/` 里没有任何 `storage` 监听，
      于是两个标签页**后写的会把先写的整表抹掉**（加的书签消失、删的书签复活）。
      详见「两个标签页同时开着」一节。探针 `multi-tab.mjs` 修复前 12 / 7 → **19 / 0**。
- [x] **「恢复默认」拆成两个按钮 + 默认配置补齐**（2026-09-29）
      起因是 Jerry 反馈「恢复默认把原本的数据都清除了」，并要求把
      `ai-study-exam.onrender.com` 与 `tools.pdf24.org` 加进默认配置。
      **实测它并没有清数据**（只重置设置项，书签分类一条不动）；
      真正的缺口是「清空之后**没有任何路**能回到默认数据」。
      新增「恢复默认数据」（带二次确认、写失败回滚），种子里补上
      b23 Agent Lab / b24 PDF24 Tools，`SEED_VERSION` 2→3 让老用户也能拿到。
      详见「「恢复默认」到底该恢复什么」一节。探针 `reset-default.mjs`
      修复前 **25 / 20** → 修复后 **45 / 0**，造红 34 / 11。
- [x] **`transferLocalToCloud` 的动态验证**（2026-09-30）
      起因是源码注释里自己写着「只做了静态修正，没有动态验证，别当成已验证」——
      一条**记着「没验过」的改动**，长得却跟已验证的一模一样。
      补了 `transfer-cloud.mjs`（真浏览器 + 真 Supabase 测试账号 + **查库**当判据，
      用 `addInitScript` 拦 `fetch` 制造写失败），dev / dist 子路径 / 线上均 **35 / 0**；
      造红两处（去掉返回值检查 **31 / 4**、去掉 `write_failed` 分支 **33 / 2**）。
      **结论：这三行是对的，一处不用改。** 详见「本机 → 云端的搬运」一节。
- [x] **界面报「图标已更新」，但库里一行都没变**（2026-10-01 发现 + 当天修掉）
      `src/data/adapters/cloud.js` 的 `writeSites()` 只在 `if (error)` 时判失败，
      而 **PostgREST 对「被 RLS 的 `USING` 挡掉的 UPDATE」返回的是成功状态码**，
      只是影响 0 行。于是 `ok` 保持 `true` → `snapshot.set()` 照常更新 →
      界面 toast「图标已更新」，而库里一行没变。
      **那段代码的注释里早就写着「非 admin 会被 RLS 静默挡掉」——
      注释承认了静默，代码却把它当成成功返回。**

      修复分两层（缺一层界面就照样说谎）：
      1. **根因** `writeSites()`：update / delete 改成 `.select('id')` 把受影响的行
         要回来，**0 行 = 没写进去 = `ok = false`**，让 `withRollback` 回滚。
         （`insert` 不用 —— 被 `with check` 拒掉时它**真的会报错**。）
      2. **表层** `AdminView`：`approve` / `reject` / `removeSite` / `restoreIcon` /
         `setIcon` 这 **5 处**原来 `await updateSite(...)` 之后**无条件** toast 成功，
         连返回值都不看 —— 改成 `ok ? 成功文案 : toast.saveFail`。

      探针 `write-sites-honest.mjs`（**19 / 0**），覆盖 S-A 非 admin 改全局表 /
      S-B 对照组「有权限的写必须成功」/ S-C 回归「views 自增 RPC 没被带坏」/
      S-D AdminView 那 5 处。造红两次，**两层各自独立变红**：
      只退回根因 → S-A 的 ①②③ 红；只退回 `AdminView` → S-D 的 ①② 红。
      详见「写失败却报『成功』」一节。
- [x] **图标改走 Supabase Storage**（2026-10-01）
      头像 / 书签图标 / 站点图标三处上传，从「base64 写进业务表」改成
      「传 Storage + 只存公开 URL」。新增 `src/data/iconStorage.js` 与
      `supabase/migrations/005-user-assets-storage.sql`。
      探针 dev **24 / 0**、另两个上传点 **22 / 0**、dist **8 / 0**、线上 **8 / 0**、
      造红 **17 / 7**（7 条全预期）。
      顺带纠正了一条**我给出过的假阴性探针** —— `GET /storage/v1/bucket`
      对 anon 和登录用户都返回 `[]`，用它判断「迁移跑了没」会永远以为没跑。
      详见「上传的图改走 Storage」一节。
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
- [x] **`.bm-desc` 改成允许两行**（2026-09-27）。做了两件事：
      1. `.bm-desc` 从单行 `nowrap + ellipsis` 改成 `-webkit-line-clamp: 2`
         （与 `.bm-name` 同一套写法）。可用宽度从 133.2px 翻倍到 ~266px。
      2. 编辑器描述框下加一行说明（`bookmark.descHint`）—— 用户在编辑框里
         **完全看不出**卡片只显示两行，写了一句 40 字的简介、保存后只剩前半句，
         多半不会去悬停，只会觉得「我写的东西丢了」。
      顺带修掉 `.bm-name` 的一个**既有 bug**：没有 `overflow-wrap: break-word`
      时，一整串没有断行机会的字符（长英文单词、粘进来的长 URL）会被
      `overflow:hidden` **横向硬切，且连省略号都没有** ——
      line-clamp 的省略号只在「行数超出 clamp」时画，横向溢出不算。
      改之前有 `text-overflow: ellipsis` 所以**是**有省略号的，这条改法原本
      对那个场景是**退步**，加上 `break-word` 才补回来。
      用 `break-word` 而不是 `anywhere`：后者会改变 min-content 固有尺寸，
      连带影响 `.bm-text` 这个 flex 项的伸缩基准。

      **代价（实测，`/tmp/jerry-sb/desc-cost.mjs`、`seed-b22-impact.mjs`）**：
      一张卡有 2 行描述就从 65.3px 变 81.4px，而 `.grid` 是
      `align-items: stretch`，**同一行有一张变高整行都被撑高**。
      但这不是新引入的 —— `.bm-name` 允许两行时**本来就**是这个行为
      （实测长名字让整行 65 → 83px）。这条是放开描述两行的**前提**，
      当初就是靠它才敢动。

      ⚠️ 量布局影响**别用「整页高度」**：`body` 有 `min-height: 100vh`，
      书签少的时候 `html.scrollHeight` 纹丝不动（钝指标）。
      要用 `.content` 高度或最后一张卡的底边。
      ⚠️ 量可用宽度**不能直接读 `clientWidth`**：`.bm-text` 是
      `flex: 0 1 auto`，短内容会收缩到内容宽。要先用超长文本撑满再量。
      ⚠️ 给 scoped 组件注入测试样式**必须加 `!important`**：`<style scoped>`
      编译成 `.bm-desc[data-v-xxx]`（特异性 0,2,0），裸 `.bm-desc`（0,1,0）
      压不过它 —— 我第一次就因此测出假的「+0px」。
      ⚠️ 别断言 `getComputedStyle(d).display === '-webkit-box'`：
      现代 Chromium 归一化成 **`flow-root`**，而 `-webkit-line-clamp`
      作为独立属性照常生效。要断言就断言 line-clamp 的值。
      ⚠️ 编辑器里那句说明用的是 `--muted_text_color`（不是 `--danger`），
      排版和 `.err` 一致，保证有错误提示时两行不会跳。

      验收：`desc-verify.mjs` **43 / 0**（含一条**故意断言「编辑模式下确实
      被截断」**的已知限制，哪天编辑模式不再挤压它会红，提示去划掉这条）。

      **跨组合的矩阵验证：`desc-matrix.mjs`（260 条断言）。**
      `desc-verify.mjs` 只在 `grid / normal / default` 一个组合下跑过，而组件里
      针对卡片风格的覆盖规则（`.bm-card.mac .bm-text{width:100%}`、
      `.bm-card.mac .bm-name{font-size:12px}`、`.bm-card.mac .bm-actions` 是
      `absolute`）都可能在别的组合里把旧规则带回来 ——
      所以补了一个 3 布局 × 3 密度 × 3 风格 = **27 个组合**的矩阵，每个组合都验
      line-clamp / 不是 nowrap / 不是 ellipsis / `overflow-wrap:break-word` /
      长串不横向溢出 / 超行有省略号。dev / dist 子路径 / 线上均 **260 / 0**。

      写这个矩阵时**又踩了两次自己的坑**，都记在脚本注释里：
      1. **假设了 `density` 设置会被尊重** —— 结果 `minimal` 布局强制 compact，
         于是「找不到 `.bm-desc`」满屏假红。正解是**从 DOM 读实际生效的密度**
         （卡片上的 `density-*` 类），并把「desc 只在 normal 存在」本身当成断言。
      2. **用 `scrollWidth` 判「文字有没有横向溢出」** —— `drawer/normal/mac` 下
         `.bm-name` 报 `scrollW 237 / clientW 234`，但用 `Range` 量出**每一行**
         都 ≤ 227.9px，文字根本没溢出，那 3px 是 Chromium 在
         「`-webkit-line-clamp` + `text-align:center`」下的读数怪癖。
         正解是断言**文字实际占据的宽度**（`Range.getClientRects()` 的最大宽度）。
      3. 顺带一条：四张测试卡的**名字必须唯一**，否则 `find` 会撞车 ——
         上一版用「串口助手」当锚点，两张同名卡直接找错。

      **矩阵脚本带一个 `BREAK=1` 模式**：注入
      `.bm-name, .bm-desc { overflow-wrap: normal !important }`（= 长串被硬切那个
      既有 bug 的状态），整套应当成片报红。实测 **63 条报红**，其中
      `maxLineRect 2428.6 / clientW 133`、`长描述行数超出 clamp ⟹ 画省略号 16 / 16`
      —— 证明这两条断言真的能抓到那个退步。
- [x] **顺手把 b22（串口助手）那条提示写进了卡片描述**（2026-09-27）。
      它依赖 Web Serial API，**只有 Chromium 系能开串口**。原来加不了后缀，
      因为 `.bm-desc` 单行时「在线串口调试与固件升级」已占 126.5px / 可用
      133.2px，加「· 需 Chrome」（约 163px）必被截断。两行放开后放得下了。
      **代价**：这张卡 65.3 → 81.4px，`.content` 989.2 → 1005.3（+16.1px）。
      b22 恰好**独占一行**（dev 分类第 6 条、每行 5 个），所以 `stretch`
      只影响它自己，全站只有它一张是 81px。
      考虑过「在线串口调试 · 需 Chrome」（能压回一行、卡片仍 65px），
      否掉的两个理由：① 那个一行是**擦边过的**（约 131.6px / 可用 133.2px），
      换个字体栈就掉成两行；② 会丢掉「与固件升级」这个能力。
      ⚠️ **改描述不用动 `SEED_VERSION`** —— 那个机制是给「增删条目」用的
      （`useStore.js` 的 `SEED_ADDITIONS` 只补缺失的 id，不覆盖已有条目的字段），
      所以老用户看到的还是旧文案，**这是设计如此、不是没生效**；
      想验证请用隐私窗口或先清 localStorage。
      （线上是云端模式，登录后书签以 Supabase 为准，seed 只影响未登录访客。）
- [x] **修掉悬停提示框的两处缺陷**（2026-09-27，详见「与参考站的已知差异 → 悬停提示框」）。
      ① **真 bug**：`showTooltip` 被 `density === 'normal'` 门控，而 `.bm-desc` 也只在
      normal 渲染 → compact / icon 密度下**简介彻底不可达**（18 组合只有 4 个能出框）。
      这个门控是「补上书签排列设置」那次重构（`c678832`）的副作用，`git log -S` 定位。
      ② **既有 bug**：提示框 `width:max-content` + 居中，窄卡片 / 窄视口下伸出视口
      （375px 下首卡 `left -43`、1440 + drawer/icon 下 `left -39`）。
      新增 `clampTooltip()` + `--tip-shift` 水平夹取，一次解决两处。

      这件事的**方法论**值得记一笔：它**不是**从「用户反馈」来的，而是从
      `desc-matrix.mjs` 的矩阵结论（「compact / icon 密度下卡片不显示简介」）
      顺着追问「那这两个密度下简介去哪儿看？」推出来的。
      一个维度量清楚了，往往就能照出隔壁维度的洞。

      验收：`tooltip-probe.mjs`（329 条），dev / dist 子路径 / 线上均 **329 / 0**；
      `BREAK=1` 故意造红 **17 条**（含 `-43` / `-39` 两个实测数字）。
- [x] **补上「icon 密度 + 没填简介」的书签认不出来**（2026-09-27 第二轮，
      详见「与参考站的已知差异 → 悬停提示框 ③」）。
      上一轮修完密度门控后判据停在 `!!description`，而这个组合下
      卡片上只有一个图标、悬停又不出框 —— **整条书签一个字都看不到**。
      简介在编辑器里是**可选**的，所以用户随手就能造出来。
      判据改成「只要卡片说不清这是什么就出框」（`!!description || !cardShowsName`），
      并给 `.tip-desc` 补 `v-if`（免得留一个白占 margin 的空段落）。

      ⚠️ 这一条是**自己回头看出来的**：上一轮我在注释里写了「这是已知遗留边界，
      探针里有断言钉住它」，回头核对**那条断言根本不存在**。
      **注释里声称的守卫，也要当成断言去验一遍** ——
      否则它会以「已经有人管了」的样子，把这个洞一直留着。

      验收：`tip-nodesc.mjs`（67 条），修复前 **65 / 2**、修复后 **67 / 0**；
      `BREAK=1` 预期恰好 2 条报红，实测 **59 / 2** 与预测一致。
- [x] **修掉「孤儿书签」从界面彻底消失的真 bug**（2026-09-27 第三轮，
      详见「未分类书签」一节）。
      删掉一个分类后，它的书签被置成 `categoryId: null`，
      而渲染层**没有「未分类」这个分组** → 看不见、编辑不了、删不掉，
      计数却照样算它们（实测删掉装 3 条的分类后：卡片 5 → **2**，计数仍 **5**；
      设置面板「清除分类」更狠，卡片 **0**、计数仍 **5**）。
      而删除确认框的文案恰恰承诺「书签将移至未分类」——**那个分组不存在**。

      修法是补出虚拟分组 `UNCATEGORIZED_ID`（只活在渲染层、绝不落库），
      **计数口径一个字没动** —— 每条书签都落进某个分组后，口径自动就对了。
      顺带把主页和分享页各自写的一份分组逻辑合并成 `useStore.groupBookmarks()`
      —— 分享页那份 `groupShared()` **同样会丢孤儿**，且两处都踩过同一个
      `.self` 的坑。

      这件事的来源值得记一笔：**它也不是用户报的**，是写设置审计
      （`settings-audit.mjs`，45 条全过）时基准行的一个数字对不上
      ——「夹具 6 条书签，页面写 7 个网址」—— 顺着追下去的。
      **一个全过的负面结论，本身就是线索。**

      验收：`orphan-bookmarks.mjs`（18 条 / 6 场景），修复前 **3 / 6**、
      修复后 **18 / 0**；两套造红都验过（`BREAK=1` 预测 12 条报红、实测 12 条；
      把 `realCatId()` 临时改成恒等 → 场景 6 报红，实测落库 1 条脏数据）。
      ⚠️ 探针第一版有**两条坏断言**：`bodyHas` 名单硬编码导致
      「未分类那条」那条**恒为 false**（从来没红过也没绿过），
      以及「删除后剩下 2 张卡」是**把 bug 现状写进了断言** ——
      修好之后必然报红，**报红不代表修错了，代表断言该改了**。

      ⚠️ **修完自己回头复查，又挖出第四个落库路径**：我在注释里写了
      「只在写库前这一处翻译」，于是只改了 `onGroupDrop` ——
      漏掉的 `onCardDrop`（往「未分类」分组里的**另一张卡片**上拖）
      会把 `'__uncategorized__'` 直接写进数据。现在四处翻译收进一个
      `realCatId()`。详见「未分类书签 → ⚠️「只在写库前那一处翻译」这句话是错的」。

      ⚠️ **顺带发现 21 个夹具探针都没钉 `jt:seedVersion`**，是个埋着的雷：
      `syncSeedAdditions()` 会把种子增量 b22 掺进夹具，而 b22 的
      `categoryId` 是 `dev`（夹具里没有这个分类）—— 修复前它是孤儿、**不渲染**，
      所以谁都没发现；等「未分类」分组补出来它立刻开始渲染，
      `desc-verify`（41/2）和 `desc-matrix`（233/27）集体报红，
      看着像**这次的改动把描述排版弄坏了**。已用 `pin-seed-version.py` 统一补上
      （`e2e.mjs` 读真实 localStorage、`seed-b22-*.mjs` 专门量 b22，这两类排除）。
      **判据：把报红断言里的数字和夹具实际塞的条数对一下，对不上就是污染，不是回归。**
- [x] **写失败审计：写不进去却报「成功」**（2026-09-27）。
      换了个系统性角度审计 ——「所有写盘操作的失败有没有被吞掉、然后照样报成功」，
      用故障注入（`Storage.prototype.setItem` 抛 `QuotaExceededError`）跑出 **19 / 7**。
      挖到 3 处真 bug，最重的是**恢复备份会毁数据**：`writeAll` 先 `remove` 再 `set`
      且吞掉返回值 → 写失败时**原值已被删掉**、toast 还说「恢复完成」，
      实测 3 条书签 → 22 条种子。详见「写失败审计」一节。

      **有价值的负面结论**：`withRollback` 保护的 5 条路径全部正确回滚 ——
      问题不在「没人想过要处理写失败」，而在**个别路径漏了**。

      ⚠️ 探针自己踩了三个坑，一个比一个阴：
      1. **场景 8 假绿** —— `location.reload()` 把 toast 冲掉，读到空数组，
         「不出现『恢复完成』」恒为真。拦 reload 不可行（实例上是 unforgeable
         属性），改成把日志写进 `window.name` 让它活过 reload + 用文档代号判重载。
      2. **观察器静默没装上** —— init script 执行时 `document.documentElement`
         还是 `null`，`observe(document.documentElement, …)` 直接抛，
         于是所有断言**退化成实时 DOM 读**，只有页面被 reload 之后才暴露成假绿。
         改成 `observe(document, …)` + **硬自检**（装不上就抛错，不允许静默降级）。
      3. **一条弱断言** —— 「存储里的顺序没变」在拖拽成功时也成立（拖拽改的是
         `categoryId`，数组顺序可能原地不动），造红时才看出来。

      造红：`BREAK=1`（不注入故障）实测 **3 绿 / 26 红**，三条绿分别是
      已知弱断言、探针自检、条件式断言 —— 逐条对过，不是漏网。
- [x] **读失败审计：`seedIfEmpty` 的判据把三种「空」混成了一种**（2026-09-27）。
      上一轮审**写**路径，这轮审它的镜像：**读**路径。
      根因是一行 `!bms || !bms.length` —— 它分不清「键不存在（首次启动）」、
      「用户清空了」和「键存在但读不出来」，而前者的分支里带着 `persist()`。

      两个后果，一个比一个难看：
      1. **用户清空的数据刷新就复活**：删掉最后一条书签 / 点「清除所有书签」
         → 刷新 → **22 条种子全回来**；「清除分类」→ 6 个种子分类回来。
         这是用户明确表达「我要清空」，刷新就撤销。
      2. **读不出来的值被种子覆盖，且不可恢复**：`jt:bookmarks` 存成 `'{'`
         之后打开页面，它被 22 条种子顶掉、界面显示的正是那些种子。
         `read()` 的 `any | null` 让「不存在」和「读不出来」在类型上不可区分。

      修法：新增 `readState()` 把三态显式化（`ok` / `absent` / `unreadable`），
      `seedIfEmpty()` 改成「键不存在 **且** 从没灌过种子」才灌。
      顺带修掉「导出的备份缺表却报『已下载』」，并加了顶部数据完整性告警条。
      详见「读不出来 ≠ 没有数据」一节。

      验收：`read-fail-audit.mjs` 12 条（修复前 3/9 → **12/0**）、
      `empty-vs-first.mjs` 11 条（修复前 3/11 → **11/0**，含两个**反向场景**
      专门守「别矫枉过正」：全新用户必须灌、老用户必须补 `b22`）。
      造红是**改源码**（把 `decide()` 换回旧语义）—— 因为缺陷不在「元素在不在」，
      而在判据本身。
