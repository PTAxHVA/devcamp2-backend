import { isValidObjectId } from 'mongoose'
import { ApiError } from '../utils/api-error.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { Section } from '../models/section.model.js'
import { Quiz } from '../models/quiz.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'

/**
 * Every active UserTopic for a master topic across the learner's active roadmaps.
 * A shared topic (F18 "add another role" enrols the same master topic in >1 roadmap)
 * has one UserTopic per roadmap. Ordered by createdAt so single-doc reads are
 * deterministic (earliest enrollment) instead of relying on Mongo's natural order.
 */
export const getEnrolledUserTopicsForTopic = async (topicId: string, userId: string) => {
  const userRoadmaps = await UserRoadmap.find({ userId, isActive: true }).select('_id').lean()
  if (userRoadmaps.length === 0) {
    throw new ApiError(404, 'User roadmap not found', 'USER_ROADMAP_NOT_FOUND')
  }

  const userTopics = await UserTopic.find({
    topicId,
    userRoadmapId: { $in: userRoadmaps.map((r) => r._id) },
  })
    .select('_id')
    .sort({ createdAt: 1 })
    .lean()
  if (userTopics.length === 0) {
    throw new ApiError(404, 'User topic not found', 'USER_TOPIC_NOT_FOUND')
  }

  return userTopics
}

// Single-enrollment check for read paths (section detail). Returns the earliest
// enrollment deterministically; after quiz grading mirrors progress across every
// roadmap sharing a topic, any of them carries the same section progress.
export const verifyTopicEnrollment = async (topicId: string, userId: string) => {
  const [userTopic] = await getEnrolledUserTopicsForTopic(topicId, userId)
  if (!userTopic) {
    throw new ApiError(404, 'User topic not found', 'USER_TOPIC_NOT_FOUND')
  }
  return userTopic
}

export const getSectionById = async (sectionId: string, userId: string) => {
  if (!isValidObjectId(sectionId)) {
    throw new ApiError(400, 'Invalid section id', 'INVALID_SECTION_ID')
  }

  const section = await Section.findById(sectionId).lean()
  if (!section) {
    throw new ApiError(404, 'Section not found', 'SECTION_NOT_FOUND')
  }
  const topicId = section.topicId

  const userTopic = await verifyTopicEnrollment(topicId.toString(), userId)

  const hasQuiz = await Quiz.exists({ sectionId })

  const userProgress = await UserSectionProgress.findOne({
    userTopicId: userTopic._id,
    sectionId: sectionId,
  }).lean()

  const sectionDTOs = section.resourceList.map((resource) => ({
    title: resource.title,
    url: resource.url,
    type: resource.type,
    provider: resource.provider,
    estimatedMinutes: resource.estimatedMinutes,
  }))

  const sectionDetails = {
    _id: section._id.toString(),
    title: section.name,
    contentOverview: section.contentOverview,
    orderIndex: section.orderIndex,
    resourceList: sectionDTOs,
    hasQuiz: hasQuiz,
    isCompleted: userProgress?.isCompleted ?? false,
  }

  return sectionDetails
}
