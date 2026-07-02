/** Day number since the Unix epoch in UTC+7 (Asia/Saigon). Two instants that fall
 *  on the same Saigon calendar day share a number. This is the single day boundary
 *  used by BOTH the streak reset check and the dashboard weekly-progress buckets,
 *  so the two always agree on what a "day" is. */
export const getDayNumberUTC7 = (d: Date): number =>
  Math.floor((d.getTime() + 7 * 60 * 60 * 1000) / 86400000)

export const calculateCurrentStreak = (
  dbStreak: number,
  lastActivityDate?: Date | null,
): number => {
  if (!lastActivityDate) return dbStreak

  let currentStreak = dbStreak
  const now = new Date()

  if (getDayNumberUTC7(now) - getDayNumberUTC7(lastActivityDate) > 1) {
    currentStreak = 0
  }

  return currentStreak
}

/** Sections completed per day for the current week, Mon→Sun (index 0 = Monday),
 *  bucketed on the UTC+7 day boundary. Feed it the completedAt of every completed
 *  section; entries outside this week (or null/undefined) are ignored. `now` is
 *  injectable so tests are deterministic. */
export const buildWeeklyProgress = (
  completedAts: (Date | string | null | undefined)[],
  now: Date = new Date(),
): number[] => {
  // Monday-first weekday index of `now` in UTC+7: Mon=0 … Sun=6.
  const mondayOffset = (new Date(now.getTime() + 7 * 60 * 60 * 1000).getUTCDay() + 6) % 7
  const mondayDayNum = getDayNumberUTC7(now) - mondayOffset

  const week = [0, 0, 0, 0, 0, 0, 0]
  for (const at of completedAts) {
    if (!at) continue
    const idx = getDayNumberUTC7(new Date(at)) - mondayDayNum
    if (idx >= 0 && idx < 7) week[idx] = (week[idx] ?? 0) + 1
  }
  return week
}
