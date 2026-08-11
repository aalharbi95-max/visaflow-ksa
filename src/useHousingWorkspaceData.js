import { useCallback, useEffect, useState } from 'react'
import {
  acknowledgeHousingAlert,
  assignHousingEmployee,
  createHousingRecord,
  updateHousingInspection,
  createHousingSite,
  loadHousingWorkspaceData,
  seedHousingTestData,
  uploadHousingHseAttachment,
} from './housingService.mjs'
import { OFFLINE_OPERATION_TYPES, isHousingNetworkError } from './housingOffline.mjs'
import { useHousingOffline } from './useHousingOffline.js'

const emptyData = Object.freeze({
  dashboard: {}, projects: [], sites: [], buildings: [], floors: [], apartments: [], rooms: [], employees: [], assignments: [], alerts: [],
  licenses: [], hseReports: [], operations: [], incidents: [], surveys: [],
  maintenance: [], inspections: [], assets: [], contracts: [], utilityAccounts: [], utilityBills: [],
  employeeStatusEvents: [],
  notificationSettings: null, notificationRecipients: [], notificationEvents: [], notificationDeliveries: [],
  costCenters: [], costEntries: [], costAllocationRuns: [], dailyCostAllocations: [],
  inventoryLocations: [], inventoryItems: [], inventoryBalances: [], inventoryTransactions: [],
})

export function useHousingWorkspaceData(client, companyId) {
  const [data, setData] = useState(emptyData)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!client || !companyId) return
    setLoading(true)
    setError('')
    try { setData(await loadHousingWorkspaceData(client)) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load housing data.') }
    finally { setLoading(false) }
  }, [client, companyId])

  useEffect(() => { refresh() }, [refresh])

  const mutate = useCallback(async (operation) => {
    setSaving(true)
    setError('')
    try {
      const result = await operation()
      await refresh()
      return result
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save housing data.')
      throw reason
    } finally { setSaving(false) }
  }, [refresh])

  const executeOfflineOperation = useCallback(async (operation) => {
    const payload = operation.payload || {}
    if (operation.type === OFFLINE_OPERATION_TYPES.CREATE_RECORD) return createHousingRecord(client, payload.table, companyId, payload.input)
    if (operation.type === OFFLINE_OPERATION_TYPES.UPDATE_INSPECTION) return updateHousingInspection(client, payload.inspectionId, payload.input)
    if (operation.type === OFFLINE_OPERATION_TYPES.HSE_ATTACHMENT) return uploadHousingHseAttachment(client, companyId, payload.report, payload.file)
    throw new Error('Unsupported offline operation.')
  }, [client, companyId])

  const offline = useHousingOffline(executeOfflineOperation, refresh)

  const mutateOrQueue = useCallback(async (operation, type, payload) => {
    try { return await mutate(operation) }
    catch (reason) {
      if (!isHousingNetworkError(reason)) throw reason
      const queued = await offline.queue(type, payload)
      setError('')
      return { offlineQueued: true, operation: queued }
    }
  }, [mutate, offline.queue])

  return {
    data, loading, saving, error, refresh,
    createSite: (input) => mutate(() => createHousingSite(client, companyId, input)),
    createRecord: (table, input) => mutateOrQueue(() => createHousingRecord(client, table, companyId, input), OFFLINE_OPERATION_TYPES.CREATE_RECORD, { table, input }),
    updateInspection: (inspectionId, input) => mutateOrQueue(() => updateHousingInspection(client, inspectionId, input), OFFLINE_OPERATION_TYPES.UPDATE_INSPECTION, { inspectionId, input }),
    seedTestData: () => mutate(() => seedHousingTestData(client)),
    assignEmployee: (input) => mutate(() => assignHousingEmployee(client, input)),
    acknowledgeAlert: (alertId) => mutate(() => acknowledgeHousingAlert(client, alertId)),
    uploadHseAttachment: (report, file) => mutateOrQueue(() => uploadHousingHseAttachment(client, companyId, report, file), OFFLINE_OPERATION_TYPES.HSE_ATTACHMENT, { report, file }),
    offline,
  }
}
