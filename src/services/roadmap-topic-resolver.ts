import { ApiError } from '../utils/api-error.js'
import { BranchTopic } from '../models/branch-topic.model.js'
import { MasterTopic } from '../models/master-topic.model.js'

/**
 * Resolve the ordered topic list for a set of selected branches.
 * Dedupes topics shared across branches (Scenario B library), keeping the
 * smallest orderIndex. Mirrors ai-suggest.service's dedupe so suggest → accept
 * stays consistent. Returns master topic ids in default order.
 */
export const resolveBranchTopicOrder = async (branchIds: string[]): Promise<string[]> => {
  const branchTopics = await BranchTopic.find({ branchId: { $in: branchIds } })
    .select('topicId orderIndex')
    .lean()
  if (branchTopics.length === 0) {
    throw new ApiError(404, 'Branch topics not found', 'BRANCH_TOPICS_NOT_FOUND')
  }

  const orderByTopic = new Map<string, number>()
  for (const bt of branchTopics) {
    const id = bt.topicId.toString()
    const prev = orderByTopic.get(id)
    if (prev === undefined || bt.orderIndex < prev) orderByTopic.set(id, bt.orderIndex)
  }

  return Array.from(orderByTopic.keys()).sort((a, b) => orderByTopic.get(a)! - orderByTopic.get(b)!)
}

/**
 * Guard a client-supplied topic order: every prerequisite that is part of this
 * roadmap must come before the topic that depends on it. Mirrors the prerequisite
 * check in ai-suggest.service so a customized order can't place a dependent topic
 * before its prerequisite.
 */
export const assertPrerequisiteOrder = async (orderedTopicIds: string[]): Promise<void> => {
  const topics = await MasterTopic.find({ _id: { $in: orderedTopicIds } })
    .select('dependsOn.requiredTopicIds')
    .lean()

  const positionById = new Map(orderedTopicIds.map((id, index) => [id, index]))
  for (const topic of topics) {
    const topicPos = positionById.get(topic._id.toString())!
    for (const reqId of topic.dependsOn?.requiredTopicIds ?? []) {
      const reqPos = positionById.get(reqId.toString())
      // Only enforce ordering for prerequisites that are inside this roadmap.
      if (reqPos !== undefined && reqPos > topicPos) {
        throw new ApiError(
          400,
          'A prerequisite topic is ordered after a topic that depends on it',
          'INVALID_TOPIC_ORDER',
        )
      }
    }
  }
}
