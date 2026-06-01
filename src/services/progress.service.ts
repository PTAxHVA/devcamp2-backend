import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { Section } from '../models/section.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'

export const getProgress = async (userId: string) => {
  const userRoadmaps = await UserRoadmap.find({ userId }).lean()

  if (userRoadmaps.length === 0) return []

  const roadmapIds = userRoadmaps.map((r) => r._id)

  const userTopics = await UserTopic.find({ userRoadmapId: { $in: roadmapIds } }).lean()
  const topicIds = userTopics.map((userTopic) => userTopic.topicId)

  const sections = await Section.find({ topicId: { $in: topicIds } }).lean()

  const completedSections = await UserSectionProgress.find({
    userTopicId: { $in: userTopics.map((userTopic) => userTopic._id) },
    isCompleted: true,
  }).lean()

  const topicToRoadmapMap = new Map(
    userTopics.map((t) => [t._id.toString(), t.userRoadmapId.toString()]),
  )
  const roadmapSectionCounts = new Map<string, number>()
  for (const r of userRoadmaps) roadmapSectionCounts.set(r._id.toString(), 0)

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

  const roadmapCompletedCounts = new Map<string, number>()
  for (const r of userRoadmaps) roadmapCompletedCounts.set(r._id.toString(), 0)

  for (const c of completedSections) {
    const rId = topicToRoadmapMap.get(c.userTopicId.toString())
    if (rId) {
      roadmapCompletedCounts.set(rId, (roadmapCompletedCounts.get(rId) || 0) + 1)
    }
  }

  const individualRoadmapProgress = userRoadmaps.map((roadmap) => {
    const rId = roadmap._id.toString()
    const totalSections = roadmapSectionCounts.get(rId) || 0
    const totalCompletedSections = roadmapCompletedCounts.get(rId) || 0
    const roadmapCompletionPercentage =
      totalSections > 0 ? (totalCompletedSections / totalSections) * 100 : 0

    return {
      roadmapId: roadmap.roadmapId,
      totalSections,
      totalCompletedSections,
      roadmapCompletionPercentage,
    }
  })

  return individualRoadmapProgress
}
