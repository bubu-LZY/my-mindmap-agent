'use strict'

/**
 * 只读解析 Chromium Local Storage 的 leveldb 目录（*.ldb SSTable + *.log 日志）。
 * 仅用于旧版本 userData（mindmap-mubu）数据迁移，不写入、不删除任何文件。
 *
 * 键格式（实证 dump 确认）：
 *   '_' + origin + '\x00' + enc + name + map_id(8字节小端，旧 schema 无此后缀)
 *   enc: 0x01 = name 为 Latin1/UTF8 字节；0x00 = name 为 UTF-16LE 字节
 *   另有 'META:' + origin + enc + map_id 键，value 为 varint 时间戳，用于判定当前活跃 map_id
 * 值格式：前缀 0x01 = Latin1/UTF8 字节；前缀 0x00 = UTF-16LE 字节
 */

function readVarint(buf, pos) {
  let result = 0
  let shift = 0
  let p = pos
  while (p < buf.length) {
    const b = buf[p++]
    result += (b & 0x7f) * Math.pow(2, shift)
    if ((b & 0x80) === 0) return [result, p]
    shift += 7
    if (shift > 63) throw new Error('varint 过长')
  }
  throw new Error('varint 越界')
}

function parseVarint(buf, pos) {
  let result = 0n
  let shift = 0n
  let p = pos
  while (p < buf.length) {
    const b = buf[p++]
    result |= BigInt(b & 0x7f) << shift
    if ((b & 0x80) === 0) return [result, p]
    shift += 7n
    if (shift > 63n) break
  }
  return [result, p]
}

/** 从 block 数据中解析 (key, value) 条目 */
function parseBlockEntries(data) {
  const entries = []
  if (data.length < 4) return entries
  const numRestarts = data.readUInt32LE(data.length - 4)
  if (numRestarts === 0) return entries
  const restartsStart = data.length - 4 - numRestarts * 4
  if (restartsStart < 0) return entries
  let pos = 0
  let lastKey = Buffer.alloc(0)
  while (pos < restartsStart) {
    let shared, nonShared, valueLen, p
    ;[shared, p] = readVarint(data, pos); pos = p
    ;[nonShared, p] = readVarint(data, pos); pos = p
    ;[valueLen, p] = readVarint(data, pos); pos = p
    if (shared > lastKey.length) break
    const key = Buffer.concat([lastKey.subarray(0, shared), data.subarray(pos, pos + nonShared)])
    pos += nonShared
    const value = data.subarray(pos, pos + valueLen)
    pos += valueLen
    entries.push({ key, value })
    lastKey = key
  }
  return entries
}

function readBlock(buf, offset, size, snappyDecompress) {
  if (offset + size + 5 > buf.length) throw new Error('block 越界')
  const type = buf[offset + size]
  let data = buf.subarray(offset, offset + size)
  if (type === 1) {
    if (!snappyDecompress) throw new Error('SNAPPY_BLOCK')
    data = snappyDecompress(data)
  }
  return data
}

function parseSSTable(buf, snappyDecompress) {
  if (buf.length < 48) return []
  const footer = buf.subarray(buf.length - 48)
  const magic = footer.readBigUInt64LE(40)
  if (magic !== 0xdb4775248b80fb57n) return []
  let p
  // metaindex handle（跳过）
  ;[, p] = readVarint(footer, 0)
  ;[, p] = readVarint(footer, p)
  let idxOff, idxSize
  ;[idxOff, p] = readVarint(footer, p)
  ;[idxSize, p] = readVarint(footer, p)
  const indexEntries = parseBlockEntries(readBlock(buf, idxOff, idxSize, snappyDecompress))
  const entries = []
  for (const ie of indexEntries) {
    let off, size
    ;[off, p] = readVarint(ie.value, 0)
    ;[size, p] = readVarint(ie.value, p)
    entries.push(...parseBlockEntries(readBlock(buf, off, size, snappyDecompress)))
  }
  return entries
}

function parseLogFile(buf) {
  const records = []
  let pos = 0
  let pending = []
  const BLOCK = 32768
  while (pos + 7 <= buf.length) {
    const len = buf.readUInt16LE(pos + 4)
    const type = buf[pos + 6]
    if (type === 0 && len === 0) {
      pos = (Math.floor(pos / BLOCK) + 1) * BLOCK
      continue
    }
    const payload = buf.subarray(pos + 7, pos + 7 + len)
    pos += 7 + len
    if (type === 1) { records.push(payload); pending = [] }
    else if (type === 2) pending = [payload]
    else if (type === 3) pending.push(payload)
    else if (type === 4) { pending.push(payload); records.push(Buffer.concat(pending)); pending = [] }
    const inBlock = pos % BLOCK
    if (inBlock > 0 && inBlock + 7 > BLOCK) pos = (Math.floor(pos / BLOCK) + 1) * BLOCK
  }
  const entries = []
  for (const rec of records) {
    if (rec.length < 12) continue
    let pos2 = 12
    while (pos2 < rec.length) {
      const tag = rec[pos2]; pos2 += 1
      let keyLen, p
      ;[keyLen, p] = readVarint(rec, pos2); pos2 = p
      const key = rec.subarray(pos2, pos2 + keyLen); pos2 += keyLen
      if (tag === 1) {
        let valLen
        ;[valLen, p] = readVarint(rec, pos2); pos2 = p
        const value = rec.subarray(pos2, pos2 + valLen); pos2 += valLen
        entries.push({ key, value })
      } else if (tag === 0) {
        entries.push({ key, value: null })
      } else break
    }
  }
  return entries
}

/** 解析 leveldb 完整键 → {kind:'meta'|'data', name, mapId}；无法识别返回 null */
function parseKey(key) {
  const s = key.toString('latin1')
  let rest, kind
  if (s.startsWith('META:')) {
    kind = 'meta'
    rest = key.subarray('META:'.length)
    const encSep = rest.indexOf('\x00')
    if (encSep === -1) return { kind, name: '', mapId: null, origin: rest.toString('latin1') }
    const origin = rest.subarray(0, encSep)
    const tail = rest.subarray(encSep + 1)
    return { kind, name: '', origin: origin.toString('latin1'), ...splitNameAndMapId(tail) }
  }
  if (!s.startsWith('_')) return null
  kind = 'data'
  const sep = key.indexOf(0x00)
  if (sep === -1) return null
  const origin = key.subarray(1, sep).toString('latin1')
  const tail = key.subarray(sep + 1)
  return { kind, origin, ...splitNameAndMapId(tail) }
}

/** tail = enc + name + mapId?；返回 {name, mapId} */
function splitNameAndMapId(tail) {
  if (tail.length === 0) return { name: '', mapId: null }
  const enc = tail[0]
  let body = tail.subarray(1)
  let mapId = null
  // map_id 为 8 字节小端，数值较小（高 5~6 字节为 0）；name 全为可见 ASCII，不含连续 NUL
  if (body.length > 8) {
    const suffix = body.subarray(body.length - 8)
    let zeros = 0
    for (let i = 2; i < 8; i++) if (suffix[i] === 0) zeros++
    if (zeros >= 5) {
      mapId = Number(suffix.readBigUInt64LE(0))
      body = body.subarray(0, body.length - 8)
    }
  }
  let name
  if (enc === 0) name = body.toString('utf16le')
  else name = body.toString('utf8')
  return { name, mapId }
}

/** 值：前缀 0x00 = UTF-16LE；0x01 = Latin1/UTF8 */
function decodeValue(value) {
  if (!value || value.length === 0) return ''
  if (value[0] === 0) return value.subarray(1).toString('utf16le')
  if (value[0] === 1) return value.subarray(1).toString('utf8')
  return value.toString('utf8')
}

/** META 值里的 varint 时间戳（protobuf field1） */
function decodeMetaTimestamp(value) {
  if (!value || value.length === 0 || value[0] !== 0x08) return 0n
  try { return parseVarint(value, 1)[0] } catch { return 0n }
}

/**
 * 解析整个 leveldb 目录 → { currentMapId, items: [{name, value, mapId}] }
 * 同名键多个 mapId 版本共存时全部返回，由调用方按 currentMapId 挑选；
 * 无 mapId（旧 schema）条目 mapId 为 null。
 */
function readLocalStorageFromDir(dir, fs, path, snappyDecompress) {
  const all = [] // {name, value, mapId, fileSeq}
  const metaTs = new Map() // mapId -> 最新时间戳
  const files = fs.readdirSync(dir).filter(f => /\.(ldb|log)$/i.test(f))
  const fileSeq = (f) => parseInt(f.replace(/\D/g, ''), 10) || 0
  for (const f of [...files].sort((a, b) => fileSeq(a) - fileSeq(b))) {
    const buf = fs.readFileSync(path.join(dir, f))
    const isLdb = f.toLowerCase().endsWith('.ldb')
    let entries
    try {
      entries = isLdb ? parseSSTable(buf, snappyDecompress) : parseLogFile(buf)
    } catch (e) {
      if (String(e.message).includes('SNAPPY')) throw e
      continue
    }
    for (const e of entries) {
      const parsed = parseKey(e.key)
      if (!parsed) continue
      if (parsed.kind === 'meta') {
        if (parsed.mapId !== null) {
          const ts = decodeMetaTimestamp(e.value)
          const prev = metaTs.get(parsed.mapId) || 0n
          if (ts > prev) metaTs.set(parsed.mapId, ts)
        }
        continue
      }
      all.push({ name: parsed.name, value: e.value === null ? null : decodeValue(e.value), mapId: parsed.mapId, fileSeq: fileSeq(f), deleted: e.value === null })
    }
  }
  // 当前活跃 mapId = META 时间戳最大者
  let currentMapId = null
  let maxTs = -1n
  for (const [id, ts] of metaTs) {
    if (ts > maxTs) { maxTs = ts; currentMapId = id }
  }
  // 每个键取最终值：优先当前 mapId 的版本，其次 mapId 最大，最后旧 schema（null）
  const best = new Map()
  const rank = (it) => {
    if (it.mapId === currentMapId) return 3
    if (it.mapId === null) return 1
    return 2
  }
  for (const it of all) {
    if (it.deleted) continue
    const prev = best.get(it.name)
    const better = !prev ||
      rank(it) > rank(prev) ||
      (rank(it) === rank(prev) && (it.mapId ?? -1) > (prev.mapId ?? -1)) ||
      (rank(it) === rank(prev) && (it.mapId ?? -1) === (prev.mapId ?? -1) && it.fileSeq >= prev.fileSeq)
    if (better) best.set(it.name, it)
  }
  return { currentMapId, items: [...best.values()] }
}

module.exports = { readLocalStorageFromDir, parseSSTable, parseLogFile, parseKey, decodeValue }
