import { isValidObjectId, startSession } from 'mongoose'
import { ApiError } from '../utils/api-error.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { MasterBranch } from '../models/master-branch.model.js'
import { MasterTopic } from '../models/master-topic.model.js'
import { Section } from '../models/section.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { RoadmapSource, TopicStatus } from '../types/enums.js'
import type { CreateRoadmapSchema } from '../schemas/roadmap.schema.js'
import { resolveBranchTopicOrder, assertPrerequisiteOrder } from './roadmap-topic-resolver.js'
import { buildRoadmapGraph, type GraphTopicInput } from './roadmap-graph.js'

// F18: a learner may keep at most this many roadmaps active at once.
const MAX_ACTIVE_ROADMAPS = 2

export const createUserRoadmap = async (userId: string, body: CreateRoadmapSchema) => {
  const { masterRoadmapId, branchSelections, orderedTopicIds, sourceType } = body

  const roadmap = await MasterRoadmap.findOne({ _id: masterRoadmapId, isPublished: true }).lean()
  if (!roadmap) {
    throw new ApiError(404, 'Master roadmap not found', 'MASTER_ROADMAP_NOT_FOUND')
  }

  // Cap + duplicate-active checks (F18).
  const activeRoadmaps = await UserRoadmap.find({ userId, isActive: true })
    .select('roadmapId')
    .lean()
  if (activeRoadmaps.length >= MAX_ACTIVE_ROADMAPS) {
    throw new ApiError(409, 'Maximum of 2 active roadmaps reached', 'ROADMAP_CAP_REACHED', {
      activeCount: activeRoadmaps.length,
    })
  }
  if (activeRoadmaps.some((r) => r.roadmapId.toString() === masterRoadmapId)) {
    throw new ApiError(409, 'This roadmap is already active', 'ROADMAP_ALREADY_ACTIVE')
  }

  // Re-enroll: if the learner previously followed then soft-deleted this exact
  // roadmap, restore that enrollment instead of inserting a duplicate. This keeps
  // their prior UserTopic list + section progress (preserve progress — no orphaned
  // docs). The new branchSelections/orderedTopicIds are intentionally ignored here:
  // re-enrolling resumes the existing roadmap as-is. Most recent archive wins.
  const archived = await UserRoadmap.findOne({
    userId,
    roadmapId: masterRoadmapId,
    isActive: false,
  }).sort({ updatedAt: -1 })
  if (archived) {
    archived.isActive = true
    try {
      await archived.save()
    } catch (error) {
      // Lost a concurrent re-enroll race against the partial-unique active index.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: number }).code === 11000
      ) {
        throw new ApiError(409, 'This roadmap is already active', 'ROADMAP_ALREADY_ACTIVE')
      }
      throw error
    }

    const topicCount = await UserTopic.countDocuments({ userRoadmapId: archived._id })
    return {
      _id: archived._id,
      roadmapId: archived.roadmapId,
      roleName: roadmap.roleName,
      sourceType: archived.sourceType,
      isActive: true,
      topicCount,
      reactivated: true,
    }
  }

  // Branches must belong to the roadmap.
  const branches = await MasterBranch.find({
    _id: { $in: branchSelections },
    roadmapId: masterRoadmapId,
  })
    .select('_id')
    .lean()
  if (branches.length !== branchSelections.length) {
    throw new ApiError(
      404,
      'One or more branches not found or do not belong to roadmap',
      'MASTER_BRANCH_NOT_FOUND',
    )
  }

  const defaultOrder = await resolveBranchTopicOrder(branches.map((b) => b._id.toString()))
  const validTopicIds = new Set(defaultOrder)

  // If the client sent an explicit order (AI suggest / customize), it must match
  // the branch topics exactly — no missing, extra, or unknown ids.
  let finalOrder = defaultOrder
  if (orderedTopicIds && orderedTopicIds.length > 0) {
    const sameSize = orderedTopicIds.length === validTopicIds.size
    const allKnown = orderedTopicIds.every((id) => validTopicIds.has(id))
    if (!sameSize || !allKnown) {
      throw new ApiError(
        400,
        'orderedTopicIds must match the selected branch topics exactly',
        'INVALID_TOPIC_ORDER',
      )
    }
    await assertPrerequisiteOrder(orderedTopicIds)
    finalOrder = orderedTopicIds
  }

  const session = await startSession()
  session.startTransaction()
  try {
    const [userRoadmap] = await UserRoadmap.create(
      [
        {
          userId,
          roadmapId: masterRoadmapId,
          sourceType: sourceType ?? RoadmapSource.SUGGESTED,
          isActive: true,
        },
      ],
      { session },
    )
    if (!userRoadmap) {
      throw new ApiError(500, 'Failed to create roadmap', 'ROADMAP_CREATE_FAILED')
    }

    const userTopics = finalOrder.map((topicId, index) => ({
      userRoadmapId: userRoadmap._id,
      topicId,
      customName: null,
      status: TopicStatus.NOT_STARTED,
      orderIndex: index,
    }))
    await UserTopic.insertMany(userTopics, { session })

    await session.commitTransaction()

    return {
      _id: userRoadmap._id,
      roadmapId: userRoadmap.roadmapId,
      roleName: roadmap.roleName,
      sourceType: userRoadmap.sourceType,
      isActive: userRoadmap.isActive,
      topicCount: userTopics.length,
      reactivated: false,
    }
  } catch (error) {
    await session.abortTransaction()
    // Lost the duplicate-active-role race: the partial-unique index rejected the
    // second active enrollment for the same role. Surface a clean 409.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new ApiError(409, 'This roadmap is already active', 'ROADMAP_ALREADY_ACTIVE')
    }
    throw error
  } finally {
    session.endSession()
  }
}

export const listActiveRoadmaps = async (userId: string) => {
  const roadmaps = await UserRoadmap.find({ userId, isActive: true }).sort({ createdAt: 1 }).lean()
  const masters = await MasterRoadmap.find({ _id: { $in: roadmaps.map((r) => r.roadmapId) } })
    .select('roleName')
    .lean()
  const roleNameById = new Map(masters.map((m) => [m._id.toString(), m.roleName]))

  return roadmaps.map((r) => ({
    _id: r._id,
    roadmapId: r.roadmapId,
    roleName: roleNameById.get(r.roadmapId.toString()) ?? null,
    sourceType: r.sourceType,
    isActive: r.isActive,
    createdAt: r.createdAt,
  }))
}

/**
 * Roadmap detail for the React Flow view (F5). Returns the owner's roadmap as a
 * domain graph: meta + topics (with 4-state status + section progress) + prereq edges.
 * The FE maps topics -> nodes and computes layout (dagre); BE owns data, FE owns visuals.
 */
export const getUserRoadmapDetail = async (userId: string, roadmapId: string) => {
  if (!isValidObjectId(roadmapId)) {
    throw new ApiError(400, 'Invalid roadmap id', 'INVALID_ROADMAP_ID')
  }

  // Active-only: a soft-deleted roadmap must not leak its topic graph to the FE
  // (the caller could otherwise render a deleted roadmap by guessing its id).
  const userRoadmap = await UserRoadmap.findOne({ _id: roadmapId, userId, isActive: true }).lean()
  if (!userRoadmap) {
    throw new ApiError(404, 'User roadmap not found', 'USER_ROADMAP_NOT_FOUND')
  }

  const [master, userTopics] = await Promise.all([
    MasterRoadmap.findById(userRoadmap.roadmapId).select('roleName').lean(),
    UserTopic.find({ userRoadmapId: userRoadmap._id }).sort({ orderIndex: 1 }).lean(),
  ])

  const masterTopicIds = userTopics.map((t) => t.topicId)
  const userTopicIds = userTopics.map((t) => t._id)

  const [masterTopics, sections, completedProgress] = await Promise.all([
    MasterTopic.find({ _id: { $in: masterTopicIds } })
      .select('name estimatedHours dependsOn.requiredTopicIds')
      .lean(),
    Section.find({ topicId: { $in: masterTopicIds }, isPublished: true })
      .select('topicId')
      .lean(),
    UserSectionProgress.find({ userTopicId: { $in: userTopicIds }, isCompleted: true })
      .select('userTopicId')
      .lean(),
  ])

  const masterById = new Map(masterTopics.map((m) => [m._id.toString(), m]))

  const sectionTotalByTopic = new Map<string, number>()
  for (const s of sections) {
    const id = s.topicId.toString()
    sectionTotalByTopic.set(id, (sectionTotalByTopic.get(id) ?? 0) + 1)
  }

  const completedByUserTopic = new Map<string, number>()
  for (const p of completedProgress) {
    const id = p.userTopicId.toString()
    completedByUserTopic.set(id, (completedByUserTopic.get(id) ?? 0) + 1)
  }

  const inputs: GraphTopicInput[] = userTopics.map((ut) => {
    const masterTopicId = ut.topicId.toString()
    const m = masterById.get(masterTopicId)
    return {
      masterTopicId,
      userTopicId: ut._id.toString(),
      name: ut.customName ?? m?.name ?? 'Untitled topic',
      orderIndex: ut.orderIndex,
      estimatedHours: m?.estimatedHours ?? 0,
      prerequisiteTopicIds: (m?.dependsOn?.requiredTopicIds ?? []).map((id) => id.toString()),
      rawStatus: ut.status,
      sectionTotal: sectionTotalByTopic.get(masterTopicId) ?? 0,
      sectionCompleted: completedByUserTopic.get(ut._id.toString()) ?? 0,
    }
  })

  const graph = buildRoadmapGraph(inputs)

  return {
    roadmap: {
      userRoadmapId: userRoadmap._id,
      masterRoadmapId: userRoadmap.roadmapId,
      roleName: master?.roleName ?? null,
      sourceType: userRoadmap.sourceType,
      isActive: userRoadmap.isActive,
    },
    topics: graph.topics,
    edges: graph.edges,
  }
}

export const softDeleteRoadmap = async (userId: string, roadmapId: string) => {
  if (!isValidObjectId(roadmapId)) {
    throw new ApiError(400, 'Invalid roadmap id', 'INVALID_ROADMAP_ID')
  }

  const roadmap = await UserRoadmap.findOne({ _id: roadmapId, userId })
  if (!roadmap) {
    throw new ApiError(404, 'User roadmap not found', 'USER_ROADMAP_NOT_FOUND')
  }

  // Soft delete only: keep UserTopic / progress documents intact (F15).
  if (roadmap.isActive) {
    roadmap.isActive = false
    await roadmap.save()
  }

  return { deleted: true }
}
