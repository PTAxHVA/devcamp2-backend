import { UserProfile } from '../models/user-profile.model.js'
import { ApiError } from '../utils/api-error.js'

export const getStreak = async (userId: string) => {
  const userProfile = await UserProfile.findOne({ userId }).lean()

  if (!userProfile) throw new ApiError(404, 'User profile not found', 'USER_NOT_FOUND')

  let currentStreak = userProfile.streak
  if (userProfile.lastActivityDate) {
    const now = new Date()
    const lastActivity = userProfile.lastActivityDate
    const getDayNumberUTC7 = (d: Date) => Math.floor((d.getTime() + 7 * 60 * 60 * 1000) / 86400000)

    if (getDayNumberUTC7(now) - getDayNumberUTC7(lastActivity) > 1) {
      currentStreak = 0
    }
  }

  return {
    userId: userProfile.userId,
    streak: currentStreak,
    lastActivityDate: userProfile.lastActivityDate,
    longestStreak: userProfile.longestStreak,
  }
}
