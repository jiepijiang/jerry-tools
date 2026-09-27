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
