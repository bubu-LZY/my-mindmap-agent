const { ipcMain, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const store = require('../utils/store')
const crypto = require('crypto')

const STORE_KEY = 'agentSkills'
const SKILL_DIR_NAME = 'skills'

// ============ 内置 Skill：AI 能力扩展引导 ============
// 用途：当用户说"帮我写个 Skill / 工具 / MCP"时，AI 可自动调用本 Skill 加载引导流程
// - 固定 id：避免与用户创建的 Skill 重名；AI 通过 invoke_skill(skillId=...) 精准加载
// - source='builtin'：在 UI 上可识别为"系统预设"，UI 决定是否允许编辑/删除
// - 文档文件：docs/skill-creation-guide.md（开发态与打包后都能定位到）
const BUILTIN_SKILL_ID = '__builtin_skill_creation_guide__'
const BUILTIN_SKILL_NAME = 'AI 能力扩展引导'
const BUILTIN_SKILL_DESC = '当你希望添加 Skill、自定义工具或 MCP 服务时，自动加载此引导流程。'

const resolveBuiltinSkillPath = () => {
  // 打包后：app.getAppPath() 指向 resources/app.asar 或 app 目录
  // 开发态：指向项目根目录；兜底从 __dirname 往上一层（electron/ipc → electron → 根目录）
  const candidates = [
    require('path').join(process.cwd(), 'docs', 'skill-creation-guide.md'),
    require('path').join(__dirname, '..', '..', 'docs', 'skill-creation-guide.md')
  ]
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p } catch (e) {}
  }
  return ''
}

const loadBuiltinSkillContent = () => {
  const p = resolveBuiltinSkillPath()
  if (!p) return ''
  try { return fs.readFileSync(p, 'utf8') } catch (e) { return '' }
}

// 启动时调用：确保内置 Skill 已登记到 store（同名 name 不重复创建；用户删了就重新建）
const ensureBuiltinSkill = () => {
  const content = loadBuiltinSkillContent()
  if (!content) return // 文档缺失（开发期未放置）静默跳过，不影响其他功能
  const skills = listSkills()
  // 用固定 id 找（避免 name 重名导致覆盖用户同名 Skill）
  const existing = skills.find(s => s.id === BUILTIN_SKILL_ID)
  const next = normalizeSkill({
    id: BUILTIN_SKILL_ID,
    name: BUILTIN_SKILL_NAME,
    description: BUILTIN_SKILL_DESC,
    instructions: content,
    enabled: true,
    autoInvoke: false, // 始终手动触发：避免 AI 在普通对话里无故加载
    source: 'builtin'
  })
  if (existing) {
    // 已存在：仅当 instructions 不同或被禁用时才更新（用户禁用则尊重）
    if (existing.enabled === false) return
    const idx = skills.findIndex(s => s.id === BUILTIN_SKILL_ID)
    if (existing.instructions !== content) {
      skills[idx] = { ...existing, ...next, createdAt: existing.createdAt, updatedAt: Date.now() }
      saveSkills(skills)
    }
    return
  }
  skills.push(next)
  saveSkills(skills)
}

const listSkills = () => {
  // 每次 list 时确保内置 Skill 存在（用户删除后可自动重建）
  try { ensureBuiltinSkill() } catch (e) {}
  const list = store.get(STORE_KEY, []) || []
  return list.filter(s => s && s.id)
}

const saveSkills = (list) => {
  store.set(STORE_KEY, list)
  return list
}

const normalizeSkill = (input = {}) => {
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '未命名技能').trim(),
    description: String(input.description || '').trim(),
    instructions: String(input.instructions || '').trim(),
    enabled: input.enabled !== false,
    autoInvoke: input.autoInvoke === true,
    source: ['builtin', 'ai', 'import'].includes(input.source) ? input.source : 'manual',
    dir: String(input.dir || ''),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Date.now()
  }
}

const createSkill = (input) => {
  const skills = listSkills()
  const skill = normalizeSkill(input)
  skills.push(skill)
  saveSkills(skills)
  return skill
}

const updateSkill = (id, patch) => {
  const skills = listSkills()
  const idx = skills.findIndex(s => s.id === id)
  if (idx < 0) throw new Error('技能不存在')
  skills[idx] = { ...skills[idx], ...normalizeSkill({ ...skills[idx], ...patch, id, updatedAt: Date.now() }) }
  saveSkills(skills)
  return skills[idx]
}

const deleteSkill = (id) => {
  // 内置 Skill 不允许删除（避免误删；如确需关闭，前端用 enabled=false 即可）
  if (id === BUILTIN_SKILL_ID) throw new Error('系统内置 Skill 不可删除（可点停用按钮关闭）')
  const skills = listSkills().filter(s => s.id !== id)
  saveSkills(skills)
  return true
}

// ========== Skill 目录（文件化存储） ==========

const getUserSkillDir = () => path.join(app.getPath('userData'), SKILL_DIR_NAME)

const ensureUserSkillDir = () => {
  const dir = getUserSkillDir()
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) {}
  return dir
}

const sanitizeFolderName = (name) => String(name || 'skill').replace(/[\\/:*?"<>|]/g, '_').trim() || 'skill'

// 解析 SKILL.md 的 YAML 前置元数据（name / description）
const parseFrontmatter = (content) => {
  const text = String(content || '').replace(/^\uFEFF/, '')
  const meta = { name: '', description: '' }
  let body = text
  const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (m) {
    body = text.slice(m[0].length)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/)
      if (kv) {
        const key = kv[1].toLowerCase()
        let val = kv[2].trim().replace(/^["']|["']$/g, '')
        if (key === 'name') meta.name = val
        else if (key === 'description') meta.description = val
      }
    }
  }
  return { meta, body }
}

const firstLineAsDescription = (text) => {
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    return t.replace(/^#{1,6}\s*/, '').trim()
  }
  return ''
}

// 从一个 .md 文件构建 skill 定义（name/description/instructions）
const buildSkillFromMd = (fileName, relativePath, content) => {
  const { meta, body } = parseFrontmatter(content)
  const stem = String(fileName || '').replace(/\.md$/i, '')
  const dir = String(relativePath || '').split('/').slice(0, -1).join('/')
  const parentFolder = dir ? dir.split('/').pop() : ''
  let name = (meta.name || '').trim()
  if (!name) {
    name = /^skill$/i.test(stem) && parentFolder ? parentFolder : stem
  }
  name = name.trim()
  const description = (meta.description || firstLineAsDescription(body)).trim()
  const instructions = (body.trim() || content.trim()).trim()
  return { name, description, instructions }
}

// 解压 zip，返回扁平文件列表（跳过 __MACOSX / .DS_Store 等无关内容）
// 安全加固：校验每个文件的相对路径，防止 Zip Slip 路径遍历
const unzipFiles = async (zipEntry) => {
  const buf = Buffer.from(zipEntry.base64 || '', 'base64')
  const zip = await JSZip.loadAsync(buf)
  const out = []
  const jobs = []
  zip.forEach((relPath, file) => {
    if (file.dir) return
    if (/(^|\/)__MACOSX\//.test(relPath) || /(^|\/)\.DS_Store$/.test(relPath)) return
    // Zip Slip 防护：拒绝含 .. 的路径、绝对路径、空字节等
    const normalized = String(relPath || '').replace(/\\/g, '/')
    if (!normalized || normalized.includes('..') || normalized.startsWith('/') || normalized.includes('\0')) {
      return // 跳过可疑路径文件
    }
    jobs.push((async () => {
      const content = await file.async('nodebuffer')
      out.push({ name: normalized.split('/').pop(), relativePath: normalized, buf: content })
    })())
  })
  await Promise.all(jobs)
  return out
}

// 将 md 文件分组为「技能」：SKILL.md 优先，其所在目录视为一个技能（含同目录支持文件）
const groupSkillFiles = (flat, mdFiles) => {
  const dirOf = (p) => {
    const i = p.lastIndexOf('/')
    return i < 0 ? '' : p.slice(0, i)
  }
  const skillMd = mdFiles.filter(f => /^skill\.md$/i.test(f.name))
  const plainMd = mdFiles.filter(f => !/^skill\.md$/i.test(f.name))
  const groups = []
  const coveredDirs = new Set()
  for (const smd of skillMd) {
    const dir = dirOf(smd.relativePath)
    coveredDirs.add(dir)
    const supporting = flat.filter(f =>
      f.relativePath !== smd.relativePath && (dir ? f.relativePath.startsWith(dir + '/') : false)
    )
    groups.push({ instruction: smd, supporting, rootDir: dir })
  }
  for (const pmd of plainMd) {
    const dir = dirOf(pmd.relativePath)
    if (coveredDirs.has(dir)) continue
    groups.push({ instruction: pmd, supporting: [], rootDir: dir })
  }
  return groups
}

// 落盘到 userData/skills/<名称>/，写入 SKILL.md 及支持文件
const writeSkillToDir = (skill, fullContent, group) => {
  const base = ensureUserSkillDir()
  const safe = sanitizeFolderName(skill.name)
  let target = path.join(base, safe)
  let suffix = 2
  while (fs.existsSync(target)) {
    target = path.join(base, `${safe}-${suffix}`)
    suffix++
  }
  fs.mkdirSync(target, { recursive: true })
  const targetResolved = path.resolve(target)
  fs.writeFileSync(path.join(target, 'SKILL.md'), fullContent, 'utf8')
  const rootDir = group.rootDir || ''
  for (const f of group.supporting || []) {
    const rel = rootDir ? f.relativePath.slice(rootDir.length + 1) : f.relativePath
    if (!rel) continue
    // 二次防护：支持文件路径不得包含 ..，且解析后必须在 target 内
    if (rel.includes('..')) continue
    const dest = path.join(target, rel)
    const destResolved = path.resolve(dest)
    if (!destResolved.startsWith(targetResolved + path.sep)) continue
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, f.buf)
  }
  return target
}

// 登记到 store：同名（忽略大小写）则更新，否则新建（保证重复拖入幂等）
const upsertImportedSkill = (skill) => {
  const skills = listSkills()
  const norm = (s) => String(s || '').trim().toLowerCase()
  const existing = skills.find(s => norm(s.name) === norm(skill.name))
  if (existing) {
    const idx = skills.findIndex(s => s.id === existing.id)
    skills[idx] = { ...existing, ...normalizeSkill({ ...existing, ...skill, id: existing.id, updatedAt: Date.now() }) }
    saveSkills(skills)
    return skills[idx]
  }
  return createSkill({ ...skill, source: 'import', enabled: true, autoInvoke: false })
}

const importSkillFiles = async ({ files = [] } = {}) => {
  // 1. 展开 zip，得到扁平文件列表
  const flat = []
  for (const f of files) {
    const name = String(f.name || '')
    if (/\.zip$/i.test(name)) {
      const inner = await unzipFiles(f)
      for (const it of inner) flat.push(it)
    } else {
      flat.push({
        name,
        relativePath: String(f.relativePath || name || ''),
        buf: Buffer.from(f.base64 || '', 'base64')
      })
    }
  }

  // 2. 找出 md 文件并按目录分组
  const mdFiles = flat.filter(f => /\.md$/i.test(f.name))
  if (mdFiles.length === 0) throw new Error('未发现 .md / SKILL.md 文件，请拖入 Skill 文档、压缩包或包含 SKILL.md 的文件夹')

  const groups = groupSkillFiles(flat, mdFiles)

  // 3. 逐组解析、落盘、登记
  const created = []
  for (const g of groups) {
    const fullContent = g.instruction.buf.toString('utf8')
    const skill = buildSkillFromMd(g.instruction.name, g.instruction.relativePath, fullContent)
    if (!skill.name) continue
    const dir = writeSkillToDir(skill, fullContent, g)
    const record = upsertImportedSkill({ ...skill, dir })
    created.push(record)
  }
  if (created.length === 0) throw new Error('未能从拖入内容中解析出 Skill')
  return { ok: true, count: created.length, skills: created }
}

ipcMain.handle('skills:list', async () => listSkills())
ipcMain.handle('skills:create', async (e, input) => createSkill(input))
ipcMain.handle('skills:update', async (e, id, patch) => updateSkill(id, patch))
ipcMain.handle('skills:delete', async (e, id) => deleteSkill(id))
ipcMain.handle('skills:import', async (e, payload) => importSkillFiles(payload || {}))
ipcMain.handle('skills:openDir', async () => {
  const dir = ensureUserSkillDir()
  const err = await shell.openPath(dir)
  return { ok: !err, error: err || '', dir }
})
// 让前端能拿到内置 Skill 创建指南的 SKILL.md 文本（用于"下载 Skill 创建指南"按钮）
ipcMain.handle('skills:getBuiltinGuideContent', async () => {
  const p = resolveBuiltinSkillPath()
  if (!p) return { ok: false, error: '内置 Skill 创建指南文件不存在' }
  try {
    const content = fs.readFileSync(p, 'utf-8')
    return { ok: true, content, path: p }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

module.exports = {}
