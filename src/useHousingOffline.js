import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  clearSyncedOfflineOperations,
  enqueueOfflineOperation,
  listOfflineOperations,
  summarizeOfflineOperations,
  syncHousingOfflineQueue,
} from './housingOffline.mjs'

export function useHousingOffline(executeOperation, onSynced) {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false)
  const [operations, setOperations] = useState([])
  const [syncing, setSyncing] = useState(false)

  const refreshQueue = useCallback(async () => {
    try { setOperations(await listOfflineOperations()) } catch { setOperations([]) }
  }, [])

  const queue = useCallback(async (type, payload) => {
    const item = await enqueueOfflineOperation(type, payload)
    await refreshQueue()
    return item
  }, [refreshQueue])

  const syncNow = useCallback(async () => {
    if (!executeOperation || syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { synced: 0, failed: 0 }
    setSyncing(true)
    try {
      const result = await syncHousingOfflineQueue(executeOperation)
      await refreshQueue()
      if (result.synced) await onSynced?.(result)
      return result
    } finally { setSyncing(false) }
  }, [executeOperation, onSynced, refreshQueue, syncing])

  const clearSynced = useCallback(async () => { await clearSyncedOfflineOperations(); await refreshQueue() }, [refreshQueue])

  useEffect(() => {
    refreshQueue()
    const handleOnline = () => { setOnline(true); window.setTimeout(() => syncNow(), 300) }
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    const interval = window.setInterval(() => { if (navigator.onLine) syncNow() }, 60000)
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/housing-sw.js').catch(() => {})
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); window.clearInterval(interval) }
  }, [refreshQueue, syncNow])

  return { online, operations, summary: useMemo(() => summarizeOfflineOperations(operations), [operations]), syncing, queue, syncNow, clearSynced, refreshQueue }
}
