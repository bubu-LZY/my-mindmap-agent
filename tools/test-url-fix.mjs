function f(b) {
  if (!b) return ''
  let u = b.trim().replace(/\/+$/, '')
  u = u.replace(/(\/v\d+[a-z]*)(?:\/v\d+[a-z]*)+\/chat\/completions$/i, '$1/chat/completions')
  if (/\/chat\/completions$/i.test(u)) return u
  if (/\/v\d+[a-z]*$/i.test(u)) return u + '/chat/completions'
  return u + '/v1/chat/completions'
}

const cases = [
  ['https://open.bigmodel.cn/api/paas/v4/v1/chat/completions', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ['https://open.bigmodel.cn/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ['https://open.bigmodel.cn/api/paas/v4/chat/completions', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
  ['https://api.deepseek.com/v1/v1/chat/completions', 'https://api.deepseek.com/v1/chat/completions'],
  ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'],
  ['https://api.deepseek.com', 'https://api.deepseek.com/v1/chat/completions'],
  ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/chat/completions'],
  ['https://api.siliconflow.cn/v1/chat/completions', 'https://api.siliconflow.cn/v1/chat/completions'],
  ['https://my.ollama.local:11434', 'https://my.ollama.local:11434/v1/chat/completions']
]

let fail = 0
for (const [input, expect] of cases) {
  const got = f(input)
  const ok = got === expect
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${input} => ${got}${ok ? '' : ' (expect ' + expect + ')'}`)
}
process.exit(fail ? 1 : 0)
