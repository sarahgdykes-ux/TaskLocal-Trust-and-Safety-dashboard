import { describe, expect, it } from 'vitest'
import { getAttention, getMetrics } from './model'

describe('Trust & Safety analytics', () => {
  it('prioritizes safety concerns above other report types', () => {
    expect(getAttention({ flag_type: 'safety_concern', flag_status: 'pending_review' }).rank)
      .toBeLessThan(getAttention({ flag_type: 'pricing_dispute', flag_status: 'investigating' }).rank)
  })

  it('calculates report KPIs from current report rows', () => {
    const metrics = getMetrics({ reports: [
      { flag_type: 'safety_concern', flag_status: 'pending_review', service_type: 'moving' },
      { flag_type: 'low_rating', flag_status: 'resolved', service_type: 'cleaning' },
      { flag_type: 'no_show', flag_status: 'investigating', service_type: 'moving' },
    ] })

    expect(metrics.total).toBe(3)
    expect(metrics.open).toBe(2)
    expect(metrics.pending).toBe(1)
    expect(metrics.investigating).toBe(1)
    expect(metrics.resolved).toBe(1)
    expect(metrics.safety).toBe(1)
    expect(metrics.byService.moving).toBe(2)
  })
})
