import { Section } from '../models/section.model.js'
import { ApiError } from '../utils/api-error.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { isValidObjectId } from 'mongoose'
import { MasterTopic } from '../models/master-topic.model.js'

export const getTopicById = async (topicId: string, userId: string) => {
  if (!isValidObjectId(topicId)) {
    throw new ApiError(400, 'Invalid topic id', 'INVALID_TOPIC_ID')
  }

  const userRoadmap = await UserRoadmap.find({ userId, isActive: true }).select('_id').lean()
  if (userRoadmap.length === 0) {
    throw new ApiError(404, 'User roadmap not found', 'USER_ROADMAP_NOT_FOUND')
  }

  const userTopic = await UserTopic.find({
    userRoadmapId: { $in: userRoadmap.map((r) => r._id) },
    topicId,
  })
    .select('_id')
    .lean()
  if (userTopic.length === 0) {
    throw new ApiError(404, 'User topic not found', 'USER_TOPIC_NOT_FOUND')
  }

  const topic = await MasterTopic.findById(topicId).select('_id').lean()
  if (!topic) {
    throw new ApiError(404, 'Topic not found', 'TOPIC_NOT_FOUND')
  }

  const sections = await Section.find({ topicId, isPublished: true }).sort({ orderIndex: 1 }).lean()
  if (!sections) {
    throw new ApiError(404, 'Sections not found', 'SECTIONS_NOT_FOUND')
  }
  const sectionsId = sections.map((s) => s._id)

  const userProgress = await UserSectionProgress.find({
    userTopicId: { $in: userTopic.map((u) => u._id) },
    sectionId: { $in: sectionsId },
  }).lean()

  return { userTopic, sections, userProgress }
}
