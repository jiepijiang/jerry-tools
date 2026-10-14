#!/usr/bin/env node
/**
 * 构建期核对 index.html 的分享卡片标签（og / twitter）。
 * ---------------------------------------------------------------------------
 * ## 为什么需要它
 *
 * 本站早就有 og / twitter 的**一部分**（title / description / type / locale /
 * site_name / twitter:card / twitter:title / twitter:description），
 * 唯独**没有 og:url、og:image、twitter:image**。
 *
 * 这种「有标题、没图」的半套最容易漏掉 —— 因为随手 grep 一下
 * `og:` 是有命中的，看起来像是「og 已经做过了」，只有真去分享一次
 * 才发现卡片是光秃秃的。2026-10-14 在线复核五个站时才抓出来。
 *
 * 补完之后，这里有两个**不会自己报错**的坑，正是本脚本要钉住的：
 *
 *   ① **og:image 必须是完整的绝对 URL**（含域名 + `/jerry-tools/` 子路径）。
 *      分享卡片的抓取方**不解析相对路径** —— 写 `/static/img/…` 的话，
 *      页面本身一切正常，只有卡片静默地没有图。
 *
 *   ② **那个 URL 里的域名和子路径，和 `vite.config.js` 的 `REPO_NAME`
 *      是两处独立的地方。** 换域名 / 换仓库名时，改了一处不会提醒另一处。
 *      症状同样是「站点好好的，分享卡片指着一张 404 的图」。
 *
 * 所以判据不写成「字符串等于某个常量」（那样改一处就要改两处断言），
 * 而是**从构建产物本身反推实际 base**（读 `<link rel=stylesheet>` 的路径），
 * 再要求 og 的 URL 与它自洽。这样换仓库名时，只有一处需要改，
 * 本脚本仍然是对的。
 *
 * ## 判据（都在 dist/index.html 上，不在源码上）
 *
 *   1. 必需的 meta 标签齐全
 *   2. og:url / og:image / twitter:image 是 https:// 开头的绝对 URL
 *   3. og:image 的路径前缀 == 产物实际 base（跨文件同步）
 *   4. og:image 指向的文件在 dist 里**真实存在**
 *   5. icon 带 base 前缀；apple-touch-icon **有就查、没有不算错**
 *   6. 404.html 也在，且同样带卡片标签（深链分享落到它）
 *
 * ## 用法
 *
 *   npm run build && npm run check:meta
 *   node scripts/check-meta.mjs
 *
 * 退出码：0 = 可以发布；1 = 有问题（CI 里直接红）。
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.join(root, 'dist')
const indexPath = path.join(distDir, 'index.html')

const inCI = process.env.GITHUB_ACTIONS === 'true'

const errors = []
const okLine = (msg) => console.log(`✅ ${msg}`)
const error = (title, msg) => {
  errors.push(`${title}：${msg}`)
  console.log(inCI ? `::error title=${title}::${msg}` : `❌ ${title}\n   ${msg}`)
}

/* ------------------------------------------------------------------ */
/* 前置：产物得先存在                                                  */
/* ------------------------------------------------------------------ */

if (!existsSync(indexPath)) {
  error('找不到 dist/index.html', '先跑 `npm run build`。本脚本核对的是**产物**，不是源码。')
  console.log(`\n❌ 有 ${errors.length} 处问题。`)
  process.exit(1)
}

const html = readFileSync(indexPath, 'utf8')
const head = html.split('</head>')[0]

/** 跨行提取所有 <meta>，返回 { 键: 内容 } */
function metaMap(source) {
  const out = {}
  for (const m of source.matchAll(/<meta\b[\s\S]*?>/g)) {
    const tag = m[0].replace(/\s+/g, ' ')
    const k = tag.match(/(?:name|property)="([^"]+)"/)
    const c = tag.match(/content="([^"]*)"/)
    if (k && c) out[k[1]] = c[1]
  }
  return out
}

const metas = metaMap(head)

/** 取所有 <link>，返回 { rel, href } */
function links(source) {
  return [...source.matchAll(/<link\b[^>]*>/g)]
    .map((m) => m[0].replace(/\s+/g, ' '))
    .map((tag) => {
      const rel = tag.match(/rel="([^"]+)"/)
      const href = tag.match(/href="([^"]+)"/)
      return rel && href ? { rel: rel[1], href: href[1] } : null
    })
    .filter(Boolean)
}

const headLinks = links(head)

/* ------------------------------------------------------------------ */
/* 1. 必需标签                                                         */
/* ------------------------------------------------------------------ */

const REQUIRED = [
  'description',
  'og:title',
  'og:description',
  'og:url',
  'og:image',
  'twitter:card',
  'twitter:title',
  'twitter:description',
  'twitter:image',
]

const missing = REQUIRED.filter((k) => !metas[k])
if (missing.length) {
  error(
    '分享卡片标签缺失',
    `dist/index.html 里没有：${missing.join('、')}。` +
      `（这些标签在源码 index.html 里，改完要重新 build 才会进产物。）`,
  )
} else {
  okLine(`必需标签齐全（${REQUIRED.length} 项）`)
}

/* ------------------------------------------------------------------ */
/* 2. 绝对 URL                                                         */
/* ------------------------------------------------------------------ */

const ABSOLUTE = ['og:url', 'og:image', 'twitter:image']
for (const k of ABSOLUTE) {
  const v = metas[k]
  if (!v) continue
  if (!/^https:\/\//.test(v)) {
    error(
      `${k} 不是绝对 URL`,
      `实际是 ${JSON.stringify(v)}。` +
        `分享卡片的抓取方**不解析相对路径** —— 必须是 https:// 开头的完整地址。`,
    )
  }
}
if (ABSOLUTE.every((k) => metas[k] && /^https:\/\//.test(metas[k]))) {
  okLine('og:url / og:image / twitter:image 都是绝对 URL')
}

/* ------------------------------------------------------------------ */
/* 3. 跨文件同步：og 的路径前缀 == 产物实际 base                        */
/* ------------------------------------------------------------------ */

/*
 * 从产物的 stylesheet 路径反推 base（形如 `/jerry-tools/assets/index-xxx.css`）。
 * 这样判据跟着**实际构建结果**走，而不是跟着某个写死的常量走。
 */
const cssLink = headLinks.find((l) => l.rel === 'stylesheet' && l.href.startsWith('/'))
const base = cssLink ? cssLink.href.slice(0, cssLink.href.indexOf('/assets/') + 1) : null

if (!base) {
  error(
    '推断不出产物 base',
    'dist/index.html 里找不到形如 `/xxx/assets/….css` 的样式表链接 —— 无法核对 og 的路径前缀。',
  )
} else {
  okLine(`产物 base = ${base}`)

  const imgUrl = metas['og:image']
  if (imgUrl && /^https:\/\//.test(imgUrl)) {
    let imgPath = null
    try {
      imgPath = new URL(imgUrl).pathname
    } catch {
      /* 上面已经判过形状了 */
    }
    if (imgPath && !imgPath.startsWith(base)) {
      error(
        'og:image 的路径前缀和实际部署路径对不上',
        `og:image 指向 ${imgPath}，但产物部署在 ${base} 下。` +
          `多半是换过仓库名 / 域名，只改了 vite.config.js 的 REPO_NAME，` +
          `**忘了改 index.html 里写死的 og:url / og:image**（这两处是独立的，不会自动同步）。`,
      )
    } else if (imgPath) {
      okLine(`og:image 路径前缀与 base 一致（${imgPath}）`)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 4. og:image 指向的文件真实存在                                      */
/* ------------------------------------------------------------------ */

const ogImg = metas['og:image']
if (ogImg && /^https:\/\//.test(ogImg) && base) {
  const p = new URL(ogImg).pathname
  if (p.startsWith(base)) {
    const rel = p.slice(base.length)
    const abs = path.join(distDir, rel)
    if (existsSync(abs)) {
      okLine(`og:image 的文件存在（${rel}）`)
    } else {
      error(
        'og:image 指向的文件不存在',
        `产物里找不到 ${rel}（${abs}）。` +
          `图被删了 / 改名了，但 meta 还指着它 —— 分享卡片会是一张空白。`,
      )
    }
  }
}

/* ------------------------------------------------------------------ */
/* 5. 图标                                                             */
/* ------------------------------------------------------------------ */

const iconLink = headLinks.find((x) => x.rel === 'icon')
if (!iconLink) {
  error('缺少 <link rel="icon">', '产物里没有 favicon。')
} else if (base && !iconLink.href.startsWith(base)) {
  error(
    'icon 没带 base 前缀',
    `href=${iconLink.href}，但产物部署在 ${base} 下 —— 子路径部署时会 404。` +
      `源码里要写成以 / 开头的绝对路径，Vite 才会重写它。`,
  )
} else {
  okLine(`icon 路径正确（${iconLink.href}）`)
}

/*
 * apple-touch-icon **可选**：本站 favicon 是 SVG，而 iOS 的 apple-touch-icon
 * 只认 PNG（不支持 SVG）。源码里那个 link 指着 favicon.svg，属于已知的
 * 「写了但 iOS 不会用」—— 不因为它而失败，但路径必须是对的（子路径下要 404）。
 */
const ati = headLinks.find((x) => x.rel === 'apple-touch-icon')
if (!ati) {
  console.log('· 没有 apple-touch-icon（favicon 是 SVG，iOS 不支持 —— 属预期）')
} else if (base && !ati.href.startsWith(base)) {
  error('apple-touch-icon 没带 base 前缀', `href=${ati.href}，部署在 ${base} 下。`)
} else {
  okLine(`apple-touch-icon 路径正确（${ati.href}）`)
}

/* ------------------------------------------------------------------ */
/* 6. 404.html 也带卡片标签                                            */
/* ------------------------------------------------------------------ */

/*
 * GitHub Pages 没有 SPA 回退，深链靠 404.html 兜底（内容是 index.html 的副本，
 * 见 vite.config.js 的 spaFallbackPlugin）。分享深链时抓到的是它 ——
 * 所以它也得有 og 标签。
 */
const notFoundPath = path.join(distDir, '404.html')
if (!existsSync(notFoundPath)) {
  error('缺少 dist/404.html', 'SPA 深链会 404。检查 vite.config.js 的 spaFallbackPlugin。')
} else {
  const nf = metaMap(readFileSync(notFoundPath, 'utf8').split('</head>')[0])
  if (!nf['og:title'] || !nf['og:image']) {
    error('404.html 里没有分享卡片标签', '它应当是 index.html 的副本，深链分享靠它出卡片。')
  } else {
    okLine('404.html 同样带分享卡片标签')
  }
}

/* ------------------------------------------------------------------ */
/* 汇总                                                                */
/* ------------------------------------------------------------------ */

if (errors.length === 0) {
  okLine('分享卡片标签全部就绪')
  process.exit(0)
}

console.log(`\n❌ 分享卡片标签有 ${errors.length} 处问题，已拦下这次发布。`)
for (const e of errors) console.log(`   · ${e}`)
process.exit(1)
