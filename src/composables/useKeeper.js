import { computed, reactive } from 'vue'
import { createStorage } from '../services/storage'
import { migrateRenewalHistory, nextExpiryDate, renewalRule } from '../services/renewal'
import { config, seed, today } from '../data'

const storage = createStorage(config.storageKey, seed, migrateRenewalHistory)
export function useKeeper() {
  const state = reactive(storage.read())
  const persist = () => storage.write(state)
  if (state.__renewalVersion !== 2) persist()
  const add = (collection, item) => { state[collection].unshift({ id: `${collection}-${Date.now()}`, createdAt: new Date().toISOString(), ...item }); persist() }
  const update = (collection, id, patch) => { const item = state[collection].find((entry) => entry.id === id); if (item) Object.assign(item, patch); persist() }
  const remove = (collection, id) => { state[collection] = state[collection].filter((entry) => entry.id !== id); persist() }
  const reset = () => { Object.assign(state, structuredClone(seed)); persist() }
  const metrics = computed(() => config.metrics.map((metric) => ({ ...metric, value: metric.value ? metric.value(state) : state[metric.collection]?.length || 0 })))
  // 续办：按证件类别规则计算新到期日，并记录旧到期日、新到期日与操作时间
  const renewDocument = (id) => {
    const doc = state.documents.find((entry) => entry.id === id)
    if (!doc) return
    const oldExpires = doc.expires
    const newExpires = nextExpiryDate(doc, today)
    const renewedAt = new Date().toISOString()
    doc.expires = newExpires
    doc.renewed = true
    doc.lastRenewedAt = renewedAt
    state.renewals.unshift({
      id: `renewal-${Date.now()}`,
      documentId: doc.id,
      documentName: doc.name,
      holder: doc.holder,
      category: doc.category,
      oldExpires,
      newExpires,
      renewedAt,
      source: 'manual',
      note: `按${doc.category || '其他'}规则续办（${renewalRule(doc.category).label}）`,
    })
    persist()
  }
  return { state, add, update, remove, reset, persist, metrics, renewDocument }
}
