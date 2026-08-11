const DEFAULT_MINIMUM_AREA_PER_PERSON = 4

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function calculateLegalCapacity({
  areaSqm,
  configuredCapacity,
  minimumAreaPerPersonSqm = DEFAULT_MINIMUM_AREA_PER_PERSON,
} = {}) {
  const area = number(areaSqm)
  const configured = Math.max(0, Math.floor(number(configuredCapacity)))
  const minimumArea = number(minimumAreaPerPersonSqm)
  if (area <= 0 || configured <= 0 || minimumArea <= 0) return 0
  return Math.min(configured, Math.floor(area / minimumArea))
}

export function canAssignToRoom({ currentOccupants = 0, ...room } = {}) {
  const legalCapacity = calculateLegalCapacity(room)
  const occupantsAfterAssignment = Math.max(0, Math.floor(number(currentOccupants))) + 1
  const compliant = legalCapacity > 0 && occupantsAfterAssignment <= legalCapacity
  return Object.freeze({
    allowed: true,
    compliant,
    requiresWarning: !compliant,
    legalCapacity,
    occupantsAfterAssignment,
    remainingAfterAssignment: Math.max(0, legalCapacity - occupantsAfterAssignment),
  })
}

export function googleMapsUrl(latitude, longitude) {
  const lat = number(latitude)
  const lng = number(longitude)
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (!lat && !lng)) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`
}

export { DEFAULT_MINIMUM_AREA_PER_PERSON }
