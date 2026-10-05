import { today } from '../data'

// 各类证件的合理有效期：自续办日（或发证日）起按类别延长对应年限
export const renewalRules = {
  身份类: { years: 10, label: '10 年有效期', desc: '身份证等身份类证件，自续办日起 10 年' },
  资产类: { years: 20, label: '20 年有效期', desc: '房产、产权等资产类证件，自续办日起 20 年' },
  合同类: { years: 3, label: '3 年有效期', desc: '合同类文件，自续签日起 3 年' },
  医疗类: { years: 1, label: '1 年有效期', desc: '医保、保险类合同，自续保日起 1 年' },
  教育类: { years: 10, label: '10 年有效期', desc: '学历、资格证书等教育类证件，自续办日起 10 年' },
  其他: { years: 5, label: '5 年有效期', desc: '其他类别默认自续办日起 5 年' },
}

export function renewalRule(category) {
  return renewalRules[category] || renewalRules.其他
}

function clampDate(year, month, day) {
  const m = String(month).padStart(2, '0')
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const d = String(Math.min(day, lastDay)).padStart(2, '0')
  return `${year}-${m}-${d}`
}

// 在某个日期（YYYY-MM-DD）上顺延整年，自动处理 2 月 29 日等溢出情况
export function addYears(dateStr, years) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number)
  if (!y || !m || !d) return ''
  return clampDate(y + years, m, d)
}

// 续办后的新到期日：以续办当天为起点，套用证件类别对应的年限
export function nextExpiryDate(doc, baseDate = today) {
  return addYears(baseDate, renewalRule(doc?.category).years)
}

export function formatDateTime(iso) {
  if (!iso) return '时间未知（旧版未记录）'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '时间未知（旧版未记录）'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 旧版续办会把到期日统一写成「十年后的年底」（形如 2036-12-31），
// 可反推出续办实际发生的年份；不符合该特征、又无签发日可依时，
// 按当前年份续办处理，避免把旧档案的到期日推到过去
function inferLegacyRenewYear(oldExpires, issued) {
  if (/^\d{4}-12-31$/.test(oldExpires || '')) return Number(oldExpires.slice(0, 4)) - 10
  if (/^\d{4}-\d{2}-\d{2}$/.test(issued || '')) return Number(issued.slice(0, 4))
  return Number(today.slice(0, 4))
}

// 迁移旧版续办档案：
// 1. 识别只打了 renewed 标记、没有续办记录的旧档案
// 2. 按证件类别规则重算合理的新到期日（月日沿用签发日，缺失时用 12-31）
// 3. 补录一条「规则补录」历史，旧版未记录的续办时间如实标注为未知
// 幂等：__renewalVersion === 2 或已存在补录记录的档案不会重复处理
export function migrateRenewalHistory(data) {
  const next = structuredClone(data)
  if (!Array.isArray(next.renewals)) next.renewals = []
  if (next.__renewalVersion === 2) return next

  const recorded = new Set(next.renewals.map((r) => r.documentId))
  next.documents?.forEach((doc) => {
    if (!doc.renewed || recorded.has(doc.id)) return
    const rule = renewalRule(doc.category)
    const renewYear = inferLegacyRenewYear(doc.expires, doc.issued)
    const [, m = 12, d = 31] = /^\d{4}-(\d{2})-(\d{2})$/.test(doc.issued || '') ? doc.issued.split('-').map(Number) : []
    const oldExpires = doc.expires
    const newExpires = clampDate(renewYear + rule.years, m, d)
    doc.expires = newExpires
    doc.lastRenewedAt = null
    next.renewals.unshift({
      id: `renewal-backfill-${doc.id}`,
      documentId: doc.id,
      documentName: doc.name,
      holder: doc.holder,
      category: doc.category,
      oldExpires,
      newExpires,
      renewedAt: null,
      source: 'backfill',
      note: '旧版仅标记已续办、未记录续办时间，按证件类别规则补录新到期日',
    })
  })
  next.__renewalVersion = 2
  return next
}
