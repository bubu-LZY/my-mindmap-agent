// 主进程 web-search 逻辑独立验证（与 electron/main.js IPC handler 保持一致）
const https = require('https')

const qs = process.argv[2] || '马克思主义基本原理'

const doRequest = () => new Promise((resolve, reject) => {
  const body = 'q=' + encodeURIComponent(qs)
  const req = https.request({
    hostname: 'html.duckduckgo.com',
    path: '/html/',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
    },
    timeout: 12000
  }, (res) => {
    let html = ''
    res.setEncoding('utf8')
    res.on('data', (c) => { html += c })
    res.on('end', () => resolve(html))
  })
  req.on('timeout', () => { req.destroy(new Error('请求超时')) })
  req.on('error', reject)
  req.write(body)
  req.end()
})

;(async () => {
  try {
    const html = await doRequest()
    console.log('html length:', html.length)
    const decode = (s) => String(s)
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ').trim()
    const results = []
    const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
    const snippetRe = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/
    let m
    while ((m = linkRe.exec(html)) !== null && results.length < 8) {
      let link = m[1]
      const uddg = link.match(/uddg=([^&]+)/)
      if (uddg) link = decodeURIComponent(uddg[1])
      const after = html.slice(linkRe.lastIndex)
      const sm = after.match(snippetRe)
      results.push({ title: decode(m[2]), link, snippet: (sm ? decode(sm[1]) : '').slice(0, 60) })
    }
    console.log('results:', results.length)
    results.slice(0, 3).forEach((r, i) => console.log(`\n${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`))
  } catch (e) {
    console.error('FAILED:', e.message)
  }
})()
