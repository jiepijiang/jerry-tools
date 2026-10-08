/**
 * 极简静态服务（重建版 —— 原文件被 /tmp 清理掉了）。
 *
 *   node serve-static.mjs <dist 目录> <URL 前缀> <端口>
 *   node serve-static.mjs "/path/to/dist" /jerry-tools/ 5200
 *
 * ⚠️ **只有「路径不是真实文件」时才回退 index.html。**
 *    无脑回退会让 `assets/index-xxx.js` 这类**写错的资源路径**也返回一坨 HTML，
 *    浏览器报的是「Unexpected token '<'」—— 看着像语法错，其实是 404 被伪装了。
 *    SPA 的 history 路由需要回退，但只该发生在**没有对应文件**的路径上。
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const [distDir, prefix, portArg] = process.argv.slice(2)
const PORT = Number(portArg || 5200)
const PREFIX = prefix || '/'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
}

async function exists(p) {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

createServer(async (req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)

  // 去掉 URL 前缀（部署在子路径下：/jerry-tools/...）
  if (PREFIX !== '/' && pathname.startsWith(PREFIX)) pathname = pathname.slice(PREFIX.length)
  if (!pathname.startsWith('/')) pathname = '/' + pathname

  // 防目录穿越
  const rel = normalize(pathname).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '')
  let file = join(distDir, rel)
  if (rel === '' || pathname.endsWith('/')) file = join(distDir, rel, 'index.html')

  if (!(await exists(file))) {
    // ⚠️ 带扩展名的路径**不回退** —— 那是「资源不存在」，必须如实 404。
    if (extname(rel)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 ' + pathname)
      return
    }
    file = join(distDir, 'index.html') // SPA history 路由回退
  }

  try {
    const buf = await readFile(file)
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(buf)
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('500 ' + e.message)
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${distDir} at http://127.0.0.1:${PORT}${PREFIX}`)
})
