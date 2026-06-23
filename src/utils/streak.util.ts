export const calculateCurrentStreak = (
  dbStreak: number,
  lastActivityDate?: Date | null,
): number => {
  if (!lastActivityDate) return dbStreak

  let currentStreak = dbStreak
  const now = new Date()
  const getDayNumberUTC7 = (d: Date) => Math.floor((d.getTime() + 7 * 60 * 60 * 1000) / 86400000)

  if (getDayNumberUTC7(now) - getDayNumberUTC7(lastActivityDate) > 1) {
    currentStreak = 0
  }

  return currentStreak
}
