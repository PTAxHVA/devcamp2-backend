import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { calculateCurrentStreak } from '../src/utils/streak.util'

/**
 * Guards the shared streak-display logic read by /me/profile, /me/streak and
 * /dashboard (T04). Pure, DB-free. Time is frozen so the day-gap math is
 * fully deterministic: a streak survives only if the last activity is within
 * 1 day (UTC+7), otherwise it resets to 0.
 */
const ANCHOR = new Date('2026-06-15T12:00:00.000Z')
const daysBefore = (n: number): Date => new Date(ANCHOR.getTime() - n * 86400000)

describe('calculateCurrentStreak', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(ANCHOR)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the stored streak unchanged when there is no last-activity date', () => {
    expect(calculateCurrentStreak(5, null)).toBe(5)
    expect(calculateCurrentStreak(3, undefined)).toBe(3)
  })

  it('keeps the streak when the last activity is today (gap = 0)', () => {
    expect(calculateCurrentStreak(7, new Date())).toBe(7)
  })

  it('resets the streak to 0 when the last activity is more than 1 day ago', () => {
    expect(calculateCurrentStreak(9, daysBefore(10))).toBe(0)
    expect(calculateCurrentStreak(1, daysBefore(3))).toBe(0)
  })
})
