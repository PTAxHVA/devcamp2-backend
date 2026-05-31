import { UserProfile } from '../models/user-profile.model.js'
import { ApiError } from '../utils/api-error.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'

export const getStreak = async (userId: string) => {
  const userProfile = await UserProfile.findOne({ userId })

  if (!userProfile) throw new ApiError(404, 'User profile not found', 'USER_NOT_FOUND')

  const userRoadmap = await UserRoadmap.find({ userId }).select('_id').lean()

  if (userRoadmap.length === 0)
    throw new ApiError(404, 'User roadmap not found', 'USER_ROADMAP_NOT_FOUND')

  const userTopics = await UserTopic.find({ userRoadmapId: { $in: userRoadmap.map((r) => r._id) } })
    .select('_id')
    .lean()

  const completedSectionProgress = await UserSectionProgress.find(
    { userTopicId: { $in: userTopics.map((r) => r._id) }, completedAt: { $ne: null } },
    { completedAt: 1 },
  )
    .sort({ completedAt: -1 })
    .lean()

  if (completedSectionProgress.length === 0)
    throw new ApiError(404, 'User has no completed sections', 'NO_COMPLETED_SECTIONS')

  let userStreak =
    userProfile.lastActivityDate &&
    userProfile.lastActivityDate.getTime() <= Date.now() - 24 * 60 * 60 * 1000
      ? userProfile.streak
      : 0

  for (const section of completedSectionProgress) {
    if (
      section.completedAt &&
      section.completedAt.getTime() <= Date.now() &&
      section.completedAt.getTime() >= Date.now() - 24 * 60 * 60 * 1000
    ) {
      userStreak++
      break
    }
  }

  const streakDetails = {
    userId: userProfile.userId,
    streak: userStreak,
    lastActivityDate: userProfile.lastActivityDate,
    longestStreak: Math.max(userProfile.longestStreak, userStreak),
  }
  return streakDetails
}
