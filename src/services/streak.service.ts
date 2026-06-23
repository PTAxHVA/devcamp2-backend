import { UserProfile } from '../models/user-profile.model.js'
import { ApiError } from '../utils/api-error.js'

import { calculateCurrentStreak } from '../utils/streak.util.js'

export const getStreak = async (userId: string) => {
  const userProfile = await UserProfile.findOne({ userId }).lean()

  if (!userProfile) throw new ApiError(404, 'User profile not found', 'USER_NOT_FOUND')

  const currentStreak = calculateCurrentStreak(userProfile.streak, userProfile.lastActivityDate)

  return {
    userId: userProfile.userId,
    streak: currentStreak,
    lastActivityDate: userProfile.lastActivityDate,
    longestStreak: userProfile.longestStreak,
  }
}
