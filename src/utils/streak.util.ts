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

/** Sections completed per day over the trailing `days`-day window (oldest→newest),
 *  bucketed on the UTC+7 day boundary — powers the "View full" activity chart.
 *  `baseline` = completions strictly BEFORE the window, so the FE cumulative line
 *  starts from the true lifetime total instead of 0. `now` is injectable for tests. */
export const buildDailyActivity = (
  completedAts: (Date | string | null | undefined)[],
  days: number,
  now: Date = new Date(),
): { series: { date: string; count: number }[]; baseline: number } => {
  const todayNum = getDayNumberUTC7(now)
  const startNum = todayNum - (days - 1)

  const counts = new Array<number>(days).fill(0)
  let baseline = 0
  for (const at of completedAts) {
    if (!at) continue
    const dayNum = getDayNumberUTC7(new Date(at))
    if (dayNum < startNum) baseline += 1
    else if (dayNum <= todayNum) {
      const idx = dayNum - startNum
      counts[idx] = (counts[idx] ?? 0) + 1
    }
  }

  const series = counts.map((count, i) => ({
    // `dayNum * 86_400_000` as a Date is that UTC+7 calendar day at 00:00Z, so the
    // ISO date slice is the day's label (YYYY-MM-DD) in UTC+7.
    date: new Date((startNum + i) * 86_400_000).toISOString().slice(0, 10),
    count,
  }))

  return { series, baseline }
}
