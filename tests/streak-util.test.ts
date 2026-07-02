import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { calculateCurrentStreak, buildWeeklyProgress } from '../src/utils/streak.util'

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

/**
 * Guards the dashboard Weekly Progress buckets. `now` is passed explicitly so the
 * Monday-first, UTC+7 day math is fully deterministic — no fake timers needed.
 * 2026-07-06 is a Monday, so this week runs Mon 07-06 → Sun 07-12.
 */
describe('buildWeeklyProgress', () => {
  // Wednesday 2026-07-08, noon in Saigon (05:00Z). Monday of this week = 2026-07-06.
  const NOW_WED = new Date('2026-07-08T05:00:00.000Z')

  it('counts completed sections into the right weekday (Mon=0 … Sun=6)', () => {
    const week = buildWeeklyProgress(
      [
        new Date('2026-07-06T02:00:00.000Z'), // Mon 09:00 UTC+7
        new Date('2026-07-06T05:00:00.000Z'), // Mon 12:00 UTC+7
        new Date('2026-07-08T05:00:00.000Z'), // Wed 12:00 UTC+7 (today)
      ],
      NOW_WED,
    )
    expect(week).toEqual([2, 0, 1, 0, 0, 0, 0])
  })

  it('buckets by UTC+7, not UTC (Sunday evening in UTC is Monday in Saigon)', () => {
    // 2026-07-05T20:00Z is a Sunday in UTC but Monday 03:00 in UTC+7 → index 0.
    expect(buildWeeklyProgress([new Date('2026-07-05T20:00:00.000Z')], NOW_WED)).toEqual([
      1, 0, 0, 0, 0, 0, 0,
    ])
  })

  it('ignores null/undefined and completions outside the current week', () => {
    expect(
      buildWeeklyProgress(
        [
          null,
          undefined,
          new Date('2026-07-04T05:00:00.000Z'), // Sat, previous week
          new Date('2026-07-15T05:00:00.000Z'), // Wed, next week
        ],
        NOW_WED,
      ),
    ).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('places a Sunday completion at index 6', () => {
    const sundayNow = new Date('2026-07-12T05:00:00.000Z') // Sun 12:00 UTC+7
    expect(buildWeeklyProgress([new Date('2026-07-12T05:00:00.000Z')], sundayNow)).toEqual([
      0, 0, 0, 0, 0, 0, 1,
    ])
  })

  it('returns all zeros for no completions (default now, no throw)', () => {
    expect(buildWeeklyProgress([])).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
})
