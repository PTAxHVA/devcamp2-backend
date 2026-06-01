import { UserProfile } from '../models/user-profile.model.js'
import { Section } from '../models/section.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserSectionProgress, IUserSectionProgress } from '../models/user-section-progress.model.js'
import { SkillLevel } from '../types/enums.js'

export const getDashboardAnalytics = async (userId: string) => {
  const [userProfile, userRoadmaps] = await Promise.all([
    UserProfile.findOne({ userId }).lean(),
    UserRoadmap.find({ userId }).lean(),
  ])

  let currentStreak = userProfile?.streak || 0
  if (userProfile?.lastActivityDate) {
    const now = new Date()
    const lastActivity = userProfile.lastActivityDate
    const getDayNumberUTC7 = (d: Date) => Math.floor((d.getTime() + 7 * 60 * 60 * 1000) / 86400000)

    if (getDayNumberUTC7(now) - getDayNumberUTC7(lastActivity) > 1) {
      currentStreak = 0
    }
  }

  const streak = {
    userId,
    streak: currentStreak,
    lastActivityDate: userProfile?.lastActivityDate || null,
    longestStreak: userProfile?.longestStreak || 0,
  }

  const roadmapIds = userRoadmaps.map((r) => r._id)
  const userTopics = await UserTopic.find({ userRoadmapId: { $in: roadmapIds } }).lean()
  const userTopicIds = userTopics.map((t) => t._id)
  const masterTopicIds = userTopics.map((t) => t.topicId)

  const [sections, sectionProgresses] = await Promise.all([
    Section.find({ topicId: { $in: masterTopicIds } }).lean(),
    UserSectionProgress.find({ userTopicId: { $in: userTopicIds } }).lean(),
  ])

  const userTopicToMasterTopic = new Map(
    userTopics.map((t) => [t._id.toString(), t.topicId.toString()]),
  )
  const userTopicToRoadmap = new Map(
    userTopics.map((t) => [t._id.toString(), t.userRoadmapId.toString()]),
  )
  const sectionMap = new Map(sections.map((s) => [s._id.toString(), s]))

  const roadmapSectionCounts = new Map<string, number>()
  const roadmapCompletedCounts = new Map<string, number>()
  const latestProgressPerRoadmap = new Map<string, IUserSectionProgress>()

  for (const r of userRoadmaps) {
    roadmapSectionCounts.set(r._id.toString(), 0)
    roadmapCompletedCounts.set(r._id.toString(), 0)
  }

  const sectionsPerMasterTopic = new Map<string, number>()
  for (const s of sections) {
    const tId = s.topicId.toString()
    sectionsPerMasterTopic.set(tId, (sectionsPerMasterTopic.get(tId) || 0) + 1)
  }

  for (const t of userTopics) {
    const count = sectionsPerMasterTopic.get(t.topicId.toString()) || 0
    const rId = t.userRoadmapId.toString()
    roadmapSectionCounts.set(rId, (roadmapSectionCounts.get(rId) || 0) + count)
  }

  for (const p of sectionProgresses) {
    const rId = userTopicToRoadmap.get(p.userTopicId.toString())
    if (!rId) continue

    if (p.isCompleted) {
      roadmapCompletedCounts.set(rId, (roadmapCompletedCounts.get(rId) || 0) + 1)
    } else {
      const currentLatest = latestProgressPerRoadmap.get(rId)
      if (
        !currentLatest ||
        new Date(p.startedAt).getTime() > new Date(currentLatest.startedAt).getTime()
      ) {
        latestProgressPerRoadmap.set(rId, p)
      }
    }
  }

  const progress = userRoadmaps.map((roadmap) => {
    const rId = roadmap._id.toString()
    const total = roadmapSectionCounts.get(rId) || 0
    const completed = roadmapCompletedCounts.get(rId) || 0
    return {
      roadmapId: roadmap.roadmapId,
      totalSections: total,
      totalCompletedSections: completed,
      roadmapCompletionPercentage: total > 0 ? (completed / total) * 100 : 0,
    }
  })

  const continueLearningList = userRoadmaps.map((roadmap) => {
    const rId = roadmap._id.toString()
    const latestProgress = latestProgressPerRoadmap.get(rId)
    let currentSection = null
    let currentTopicId = null

    if (latestProgress) {
      currentTopicId = userTopicToMasterTopic.get(latestProgress.userTopicId.toString()) || null
      const sectionDetails = sectionMap.get(latestProgress.sectionId.toString())
      if (sectionDetails) {
        currentSection = {
          sectionId: sectionDetails._id,
          name: sectionDetails.name,
          slug: sectionDetails.slug,
          startedAt: latestProgress.startedAt,
        }
      }
    }

    return {
      userRoadmapId: roadmap._id,
      roadmapId: roadmap.roadmapId,
      currentTopicId,
      currentSection,
    }
  })

  return {
    continueLearningList,
    roadmaps: userRoadmaps.map((roadmap) => roadmap.roadmapId),
    streak,
    stats: {
      progress,
      level: userProfile?.level || SkillLevel.BEGINNER,
    },
  }
}
