import { isValidObjectId } from 'mongoose'
import { ApiError } from '../utils/api-error.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { Section } from '../models/section.model.js'
import { Quiz } from '../models/quiz.model.js'

export const getSectionById = async (sectionId: string, userId: string) => {
  if (!isValidObjectId(sectionId)) {
    throw new ApiError(400, 'Invalid section id', 'INVALID_SECTION_ID')
  }

  const section = await Section.findById(sectionId).lean()
  if (!section) {
    throw new ApiError(404, 'Section not found', 'SECTION_NOT_FOUND')
  }
  const topicId = section.topicId

  const userTopic = await UserTopic.findOne({
    topicId,
    userId,
  })
    .select('_id')
    .lean()
  if (!userTopic) {
    throw new ApiError(404, 'User topic not found', 'USER_TOPIC_NOT_FOUND')
  }

  const quiz = await Quiz.find({
    sectionId: sectionId,
  })
    .select('sectionId')
    .lean()

  const hasQuizSet = new Set(quiz.map((q) => q.sectionId.toString()))

  const userProgress = await UserSectionProgress.find({
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
    hasQuiz: hasQuizSet.has(sectionId),
    isCompleted: userProgress[0]?.isCompleted ?? false,
  }

  return sectionDetails
}
