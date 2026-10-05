export function createStorage(key, seed, migrate = (x) => x) {
  const read = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(key))
      if (stored) return migrate(stored)
      return migrate(structuredClone(seed))
    } catch {
      return migrate(structuredClone(seed))
    }
  }
  const write = (value) => localStorage.setItem(key, JSON.stringify(value))
  return { read, write }
}
