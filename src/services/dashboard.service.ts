import { getStreak } from './streak.service.js'
import { getProgress } from './progress.service.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { UserProfile } from '../models/user-profile.model.js'

export const getDashboardAnalytics = async (userId: string) => {
  const [userProfile, userRoadmaps, streak, progress] = await Promise.all([
    UserProfile.findOne({ userId }).lean(),
    UserRoadmap.find({ userId }).lean(),
    getStreak(userId).catch(() => ({
      userId,
      streak: 0,
      lastActivityDate: null,
      longestStreak: 0,
    })),
    getProgress(userId).catch(() => []),
  ])

  const continueLearningList = await Promise.all(
    userRoadmaps.map(async (roadmap) => {
      const userTopics = await UserTopic.find({ userRoadmapId: roadmap._id }).lean()

      const sections = await UserSectionProgress.find({
        userTopicId: { $in: userTopics.map((userTopic) => userTopic._id) },
        startedAt: { $ne: null },
        isCompleted: { $ne: true },
      })
        .sort({ startedAt: -1 })
        .limit(1)
        .lean()

      return {
        roadmap: roadmap._id,
        userTopics,
        sections,
      }
    }),
  )
  // TODO: Implement the logic to get available roles to add
  const availableRolesToAdd: any[] = []

  return {
    continueLearningList,
    roadmaps: userRoadmaps.map((roadmap) => roadmap.roadmapId),
    streak,
    stats: {
      progress: progress,
      level: userProfile?.level,
    },
    availableRolesToAdd,
  }
}
