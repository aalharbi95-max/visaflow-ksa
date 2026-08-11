const DB_NAME = 'sakan-offline'
const DB_VERSION = 1
const STORE_NAME = 'operations'

export const OFFLINE_OPERATION_TYPES = Object.freeze({
  CREATE_RECORD: 'CREATE_RECORD',
  UPDATE_INSPECTION: 'UPDATE_INSPECTION',
  HSE_ATTACHMENT: 'HSE_ATTACHMENT',
})

export function isHousingNetworkError(error) {
  const message = String(error?.message || error || '').toLowerCase()
  return typeof navigator !== 'undefined' && navigator.onLine === false
    || error?.name === 'TypeError'
    || /network|fetch|offline|failed to fetch|load failed|connection/.test(message)
}

export function createOfflineOperation(type, payload, now = new Date()) {
  if (!Object.values(OFFLINE_OPERATION_TYPES).includes(type)) throw new Error('Unsupported offline operation.')
  return {
    id: globalThis.crypto?.randomUUID?.() || `${now.getTime()}-${Math.random().toString(16).slice(2)}`,
    type,
    payload,
    status: 'Pending',
    attempts: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    last_error: null,
  }
}

export function summarizeOfflineOperations(items = []) {
  return items.reduce((summary, item) => {
    summary.total += 1
    const key = String(item.status || 'Pending').toLowerCase()
    if (key in summary) summary[key] += 1
    return summary
  }, { total: 0, pending: 0, syncing: 0, failed: 0, synced: 0 })
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('Offline storage is unavailable in this browser.'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!store.indexNames.contains('status')) store.createIndex('status', 'status')
      if (!store.indexNames.contains('created_at')) store.createIndex('created_at', 'created_at')
    }
    request.onsuccess = () => resolve(request.result)
  })
}

async function withStore(mode, action) {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode)
      const store = transaction.objectStore(STORE_NAME)
      const request = action(store)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export async function listOfflineOperations() {
  const items = await withStore('readonly', (store) => store.getAll())
  return items.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
}

export async function enqueueOfflineOperation(type, payload) {
  const operation = createOfflineOperation(type, payload)
  await withStore('readwrite', (store) => store.put(operation))
  return operation
}

export async function updateOfflineOperation(operation) {
  const updated = { ...operation, updated_at: new Date().toISOString() }
  await withStore('readwrite', (store) => store.put(updated))
  return updated
}

export async function removeOfflineOperation(id) {
  await withStore('readwrite', (store) => store.delete(id))
}

export async function clearSyncedOfflineOperations() {
  const items = await listOfflineOperations()
  await Promise.all(items.filter((item) => item.status === 'Synced').map((item) => removeOfflineOperation(item.id)))
}

export async function syncHousingOfflineQueue(execute, { keepSynced = true } = {}) {
  const items = (await listOfflineOperations()).filter((item) => ['Pending', 'Failed'].includes(item.status))
  const result = { synced: 0, failed: 0 }
  for (const item of items.reverse()) {
    const syncing = await updateOfflineOperation({ ...item, status: 'Syncing', attempts: Number(item.attempts || 0) + 1, last_error: null })
    try {
      await execute(syncing)
      result.synced += 1
      if (keepSynced) await updateOfflineOperation({ ...syncing, status: 'Synced', synced_at: new Date().toISOString() })
      else await removeOfflineOperation(syncing.id)
    } catch (error) {
      result.failed += 1
      await updateOfflineOperation({ ...syncing, status: 'Failed', last_error: String(error?.message || error || 'Sync failed') })
      if (isHousingNetworkError(error)) break
    }
  }
  return result
}
