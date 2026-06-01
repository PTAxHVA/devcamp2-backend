import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { Section } from '../models/section.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'

export const getProgress = async (userId: string) => {
  const userRoadmaps = await UserRoadmap.find({ userId }).lean()

  const individualRoadmapProgress = []

  for (const roadmap of userRoadmaps) {
    const userTopics = await UserTopic.find({ userRoadmapId: roadmap._id }).lean()

    const topicIds = userTopics.map((userTopic) => userTopic.topicId)

    const sections = await Section.find({ topicId: { $in: topicIds } }).lean()

    const totalSections = sections.length

    const completedSections = await UserSectionProgress.find({
      userTopicId: { $in: userTopics.map((userTopic) => userTopic._id) },
      isCompleted: true,
    }).lean()

    const totalCompletedSections = completedSections.length

    const roadmapCompletionPercentage =
      totalSections > 0 ? (totalCompletedSections / totalSections) * 100 : 0

    individualRoadmapProgress.push({
      roadmapId: roadmap.roadmapId,
      totalSections,
      totalCompletedSections,
      roadmapCompletionPercentage,
    })
  }

  return individualRoadmapProgress
}
