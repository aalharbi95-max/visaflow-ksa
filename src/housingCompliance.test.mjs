import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateLegalCapacity, canAssignToRoom, googleMapsUrl } from './housingCompliance.mjs'

test('legal capacity respects both room area and configured bed capacity', () => {
  assert.equal(calculateLegalCapacity({ areaSqm: 18, configuredCapacity: 6, minimumAreaPerPersonSqm: 4 }), 4)
  assert.equal(calculateLegalCapacity({ areaSqm: 30, configuredCapacity: 6, minimumAreaPerPersonSqm: 4 }), 6)
})

test('assignment remains allowed but raises a warning when legal capacity is exceeded', () => {
  assert.deepEqual(canAssignToRoom({ areaSqm: 18, configuredCapacity: 6, minimumAreaPerPersonSqm: 4, currentOccupants: 4 }), {
    allowed: true,
    compliant: false,
    requiresWarning: true,
    legalCapacity: 4,
    occupantsAfterAssignment: 5,
    remainingAfterAssignment: 0,
  })
})

test('Google Maps links are only produced for valid coordinates', () => {
  assert.match(googleMapsUrl(24.7136, 46.6753), /^https:\/\/www\.google\.com\/maps\/search/)
  assert.equal(googleMapsUrl(120, 46.6753), '')
})
