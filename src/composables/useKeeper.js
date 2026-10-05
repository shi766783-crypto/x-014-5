import { computed, reactive } from 'vue'
import { createStorage } from '../services/storage'
import { nextExpiry, ruleFor, toISODate, migrateLegacyRenewals } from '../services/renewal'
import { config, seed } from '../data'

const storage = createStorage(config.storageKey, seed)
function loadState() {
  const state = reactive(storage.read())
  // 识别旧版点过续办但没有历史的档案，按类别规则补算到期日并补录续办记录
  const backfilled = migrateLegacyRenewals(state)
  if (backfilled.length) storage.write(state)
  return state
}
export function useKeeper() {
  const state = loadState()
  const persist = () => storage.write(state)
  const add = (collection, item) => { state[collection].unshift({ id: `${collection}-${Date.now()}`, createdAt: new Date().toISOString(), ...item }); persist() }
  const update = (collection, id, patch) => { const item = state[collection].find((entry) => entry.id === id); if (item) Object.assign(item, patch); persist() }
  const remove = (collection, id) => { state[collection] = state[collection].filter((entry) => entry.id !== id); persist() }
  const reset = () => { Object.assign(state, structuredClone(seed)); migrateLegacyRenewals(state); persist() }
  // 续办：按证件类别规则计算新到期日，并记录旧到期日、新到期日与操作时间
  const renewDocument = (doc) => {
    const item = state.documents.find((entry) => entry.id === doc.id)
    if (!item) return null
    const oldExpires = item.expires ?? null
    const operatedAt = new Date()
    const newExpires = nextExpiry(item.category, oldExpires, toISODate(operatedAt))
    const record = {
      id: `renewal-${Date.now()}`,
      documentId: item.id,
      name: item.name,
      category: item.category,
      oldExpires,
      newExpires,
      operatedAt: operatedAt.toISOString(),
      backfilled: false,
      note: `按「${ruleFor(item.category).label}」规则续办。`,
    }
    state.renewals.unshift(record)
    item.expires = newExpires
    item.renewed = true
    persist()
    return record
  }
  const metrics = computed(() => config.metrics.map((metric) => ({ ...metric, value: metric.value ? metric.value(state) : state[metric.collection]?.length || 0 })))
  return { state, add, update, remove, reset, persist, metrics, renewDocument }
}
