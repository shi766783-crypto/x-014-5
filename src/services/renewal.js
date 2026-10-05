// 证件续办规则与历史迁移
// - 不同证件类别对应不同的有效期规则
// - 每次续办记录旧到期日、新到期日、操作时间，形成可追溯历史
// - 旧版本点过续办（renewed 标记、无历史、到期日被统一改成年底）的档案可被识别并补录

// 类别 -> 续办有效期规则。years 为空表示长期有效（如房产证）
export const renewalRules = {
  身份类: { years: 20, longTerm: false, label: '20 年（身份证件）' },
  资产类: { years: null, longTerm: true, label: '长期有效（资产凭证）' },
  合同类: { years: 3, longTerm: false, label: '3 年（合同协议）' },
  医疗类: { years: 1, longTerm: false, label: '1 年（医保 / 健康类）' },
  教育类: { years: 4, longTerm: false, label: '4 年（学历 / 在读类）' },
  其他: { years: 5, longTerm: false, label: '5 年（其他证件）' },
}

export function ruleFor(category) {
  return renewalRules[category] || renewalRules.其他
}

export function describeRule(category) {
  return ruleFor(category).label
}

// 用本地时区输出 YYYY-MM-DD，避免 toISOString 的 UTC 偏移问题
export function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 在指定日期上叠加整年，2/29 等越界日期回退到目标月最后一天
export function addYears(isoDate, years) {
  const base = new Date(`${isoDate}T00:00:00`)
  const targetYear = base.getFullYear() + years
  const daysInTargetMonth = new Date(targetYear, base.getMonth() + 1, 0).getDate()
  return toISODate(new Date(targetYear, base.getMonth(), Math.min(base.getDate(), daysInTargetMonth)))
}

// 续办基准日：临期提前续办不损失剩余有效期，取「今天 / 旧到期日」中较晚者；
// 已过期或缺少旧到期日的，从今天起算
export function renewalBaseDate(oldExpires, today = toISODate(new Date())) {
  if (oldExpires && oldExpires > today) return oldExpires
  return today
}

// 按证件类别计算续办后的新到期日，返回 null 表示长期有效
export function nextExpiry(category, oldExpires, today = toISODate(new Date())) {
  const rule = ruleFor(category)
  if (rule.longTerm) return null
  return addYears(renewalBaseDate(oldExpires, today), rule.years)
}

// 旧版续办特征：renewed 标记 + 无任何续办记录 + 到期日被统一改成某年 12-31
function looksLegacyRenewed(doc, renewals) {
  if (!doc.renewed) return false
  if (renewals.some((r) => r.documentId === doc.id)) return false
  return typeof doc.expires === 'string' && /^\d{4}-12-31$/.test(doc.expires)
}

// 推算旧版续办的发生年份：到期日正是「续办年 + 10」的年底
function estimateRenewedAt(doc) {
  const renewedYear = Number(doc.expires.slice(0, 4)) - 10
  return `${renewedYear}-06-30` // 具体日期旧版未记录，取年中作为估计值
}

// 识别并修复旧版点过续办的档案：按类别规则重算到期日，并补录一条带 backfilled 标记的续办历史
export function migrateLegacyRenewals(state, today = toISODate(new Date())) {
  if (!Array.isArray(state.renewals)) state.renewals = []
  const backfilled = []
  for (const doc of state.documents || []) {
    if (!looksLegacyRenewed(doc, state.renewals)) continue
    const operatedAt = estimateRenewedAt(doc)
    const oldExpires = doc.expires
    // 旧到期日是被旧逻辑污染的值（某年 12-31），不能作为续办基准，从推断的续办日期起算
    const newExpires = nextExpiry(doc.category, null, operatedAt)
    const note = `旧版续办未记录操作日期，依据旧到期日 ${oldExpires} 推断续办年份为 ${operatedAt.slice(0, 4)} 年，按「${ruleFor(doc.category).label}」规则补算。`
    doc.expires = newExpires
    state.renewals.push({
      id: `renewal-${doc.id}-backfill`,
      documentId: doc.id,
      name: doc.name,
      category: doc.category,
      oldExpires,
      newExpires,
      operatedAt,
      backfilled: true,
      note,
    })
    backfilled.push(doc.id)
  }
  return backfilled
}

export function formatDateTime(iso) {
  if (!iso) return ''
  if (iso.length === 10) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
