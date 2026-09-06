const { ipcMain, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const JSZip = require('jszip')
const store = require('../utils/store')
const crypto = require('crypto')

const STORE_KEY = 'agentSkills'
const SKILL_DIR_NAME = 'skills'

const listSkills = () => {
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
    source: input.source === 'ai' ? 'ai' : (input.source === 'import' ? 'import' : 'manual'),
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
const unzipFiles = async (zipEntry) => {
  const buf = Buffer.from(zipEntry.base64 || '', 'base64')
  const zip = await JSZip.loadAsync(buf)
  const out = []
  const jobs = []
  zip.forEach((relPath, file) => {
    if (file.dir) return
    if (/(^|\/)__MACOSX\//.test(relPath) || /(^|\/)\.DS_Store$/.test(relPath)) return
    jobs.push((async () => {
      const content = await file.async('nodebuffer')
      out.push({ name: relPath.split('/').pop(), relativePath: relPath, buf: content })
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
  fs.writeFileSync(path.join(target, 'SKILL.md'), fullContent, 'utf8')
  const rootDir = group.rootDir || ''
  for (const f of group.supporting || []) {
    const rel = rootDir ? f.relativePath.slice(rootDir.length + 1) : f.relativePath
    if (!rel) continue
    const dest = path.join(target, rel)
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

module.exports = {}
