import { MasterTopic } from '../models/master-topic.model.js'
import { Section } from '../models/section.model.js'
import { ApiError } from '../utils/api-error.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'

export const getTopicById = async (topicId: string, userId: string) => {
  const topic = await MasterTopic.findById(topicId)
  const sectionInTopic = await Section.find({ topicId })
  const userProgress = await UserSectionProgress.find({ topicId, userId })
  if (!topic) {
    throw new ApiError(404, 'Topic not found')
  }
  if (!sectionInTopic) {
    throw new ApiError(404, 'Sections not found')
  }
  if (!userProgress) {
    throw new ApiError(404, 'User progress not found')
  }
  return { topic, sectionInTopic, userProgress }
}
