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

  const userTopic = await UserTopic.findOne({
    userRoadmapId: { $in: userRoadmap.map((r) => r._id) },
    topicId,
  })
    .sort({ createdAt: 1 })
    .lean()
  if (!userTopic) {
    throw new ApiError(404, 'User topic not found', 'USER_TOPIC_NOT_FOUND')
  }

  const topic = await MasterTopic.findById(topicId).lean()
  if (!topic) {
    throw new ApiError(404, 'Topic not found', 'TOPIC_NOT_FOUND')
  }

  const sections = await Section.find({ topicId, isPublished: true }).sort({ orderIndex: 1 }).lean()
  const sectionsId = sections.map((s) => s._id)

  const userProgress = await UserSectionProgress.find({
    userTopicId: userTopic._id,
    sectionId: { $in: sectionsId },
  }).lean()

  const topicDetails = {
    _id: topic._id,
    name: topic.name,
    description: topic.description,
    whyLearn: topic.whyLearn,
    estimatedHours: topic.estimatedHours,
    resources: [],
    orderIndex: userTopic.orderIndex,
    sectionList: sections,
    userProgress: userProgress,
  }

  return topicDetails
}
