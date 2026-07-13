import { describe, it, expect } from 'vitest'
import { buildDailyActivity } from '../src/utils/streak.util'

/**
 * Guards the "View full" activity series. `now` is injected so the trailing-window
 * + UTC+7 day math is fully deterministic. Anchor: Wed 2026-07-08 noon Saigon.
 */
const NOW = new Date('2026-07-08T05:00:00.000Z')

describe('buildDailyActivity', () => {
  it('returns a series of the requested length ending today, all zero for no completions', () => {
    const { series, baseline } = buildDailyActivity([], 30, NOW)
    expect(series).toHaveLength(30)
    expect(baseline).toBe(0)
    expect(series.every((p) => p.count === 0)).toBe(true)
    expect(series[29].date).toBe('2026-07-08') // last entry = today (UTC+7)
    expect(series[0].date).toBe('2026-06-09') // 29 days earlier
  })

  it('buckets completions into the right UTC+7 day and splits out the baseline', () => {
    const { series, baseline } = buildDailyActivity(
      [
        new Date('2026-07-08T05:00:00.000Z'), // today 12:00 UTC+7
        new Date('2026-07-08T02:00:00.000Z'), // today 09:00 UTC+7
        new Date('2026-07-06T05:00:00.000Z'), // 2 days ago
        new Date('2026-06-01T05:00:00.000Z'), // before the 30-day window → baseline
        null,
        undefined,
      ],
      30,
      NOW,
    )
    expect(baseline).toBe(1)
    expect(series[29].count).toBe(2) // today
    expect(series[27].count).toBe(1) // 2026-07-06
    expect(series.reduce((sum, p) => sum + p.count, 0)).toBe(3)
  })

  it('buckets by UTC+7 (a Sunday-evening-UTC completion is Monday in Saigon)', () => {
    // 2026-07-05T20:00Z = Mon 03:00 UTC+7.
    const { series } = buildDailyActivity([new Date('2026-07-05T20:00:00.000Z')], 30, NOW)
    expect(series.find((p) => p.date === '2026-07-06')?.count).toBe(1)
  })

  it('honors the window size (7 days)', () => {
    const { series } = buildDailyActivity([], 7, NOW)
    expect(series).toHaveLength(7)
    expect(series[6].date).toBe('2026-07-08')
    expect(series[0].date).toBe('2026-07-02')
  })
})
