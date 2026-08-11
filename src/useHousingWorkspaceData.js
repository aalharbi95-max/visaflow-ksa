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

const emptyData = Object.freeze({
  dashboard: {}, sites: [], buildings: [], floors: [], apartments: [], rooms: [], employees: [], assignments: [], alerts: [],
  licenses: [], hseReports: [], operations: [], incidents: [], surveys: [],
  maintenance: [], inspections: [], assets: [], contracts: [], utilityAccounts: [], utilityBills: [],
  employeeStatusEvents: [],
  notificationSettings: null, notificationRecipients: [], notificationEvents: [], notificationDeliveries: [],
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

  return {
    data, loading, saving, error, refresh,
    createSite: (input) => mutate(() => createHousingSite(client, companyId, input)),
    createRecord: (table, input) => mutate(() => createHousingRecord(client, table, companyId, input)),
    updateInspection: (inspectionId, input) => mutate(() => updateHousingInspection(client, inspectionId, input)),
    seedTestData: () => mutate(() => seedHousingTestData(client)),
    assignEmployee: (input) => mutate(() => assignHousingEmployee(client, input)),
    acknowledgeAlert: (alertId) => mutate(() => acknowledgeHousingAlert(client, alertId)),
    uploadHseAttachment: (report, file) => mutate(() => uploadHousingHseAttachment(client, companyId, report, file)),
  }
}
