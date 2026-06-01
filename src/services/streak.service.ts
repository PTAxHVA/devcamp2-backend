import { UserProfile } from '../models/user-profile.model.js'
import { ApiError } from '../utils/api-error.js'

export const getStreak = async (userId: string) => {
  const userProfile = await UserProfile.findOne({ userId }).lean()

  if (!userProfile) throw new ApiError(404, 'User profile not found', 'USER_NOT_FOUND')

  let currentStreak = userProfile.streak
  if (userProfile.lastActivityDate) {
    const now = new Date()
    const lastActivity = userProfile.lastActivityDate
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const lastDate = new Date(
      Date.UTC(
        lastActivity.getUTCFullYear(),
        lastActivity.getUTCMonth(),
        lastActivity.getUTCDate(),
      ),
    )

    const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays > 1) {
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
