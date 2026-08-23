const { ipcMain } = require('electron')
const store = require('../utils/store')
const crypto = require('crypto')

const STORE_KEY = 'agentSkills'

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
    source: input.source === 'ai' ? 'ai' : 'manual',
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

ipcMain.handle('skills:list', async () => listSkills())
ipcMain.handle('skills:create', async (e, input) => createSkill(input))
ipcMain.handle('skills:update', async (e, id, patch) => updateSkill(id, patch))
ipcMain.handle('skills:delete', async (e, id) => deleteSkill(id))

module.exports = {}
