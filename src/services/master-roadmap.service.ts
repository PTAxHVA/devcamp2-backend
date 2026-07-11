import { isValidObjectId, type Types } from 'mongoose'
import { ApiError } from '../utils/api-error.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { MasterBranch } from '../models/master-branch.model.js'
import { BranchTopic } from '../models/branch-topic.model.js'
import { MasterTopic } from '../models/master-topic.model.js'
import { Section } from '../models/section.model.js'
import { buildRoadmapGraph, type GraphTopicInput } from './roadmap-graph.js'

/** Published roadmap catalog (Browse / onboarding role list). */
export const listMasterRoadmaps = async () => {
  const roadmaps = await MasterRoadmap.find({ isPublished: true })
    .select('roleName description')
    .sort({ roleName: 1 })
    .lean()

  // topicsCount per roadmap (M9): distinct topics across its branches. Scenario B
  // lets a topic sit in several branches, so dedupe by topicId per roadmap.
  const branches = await MasterBranch.find({ roadmapId: { $in: roadmaps.map((r) => r._id) } })
    .select('_id roadmapId')
    .lean()
  const branchToRoadmap = new Map(branches.map((b) => [b._id.toString(), b.roadmapId.toString()]))
  const branchTopics = await BranchTopic.find({ branchId: { $in: branches.map((b) => b._id) } })
    .select('branchId topicId')
    .lean()
  const topicSetByRoadmap = new Map<string, Set<string>>()
  for (const bt of branchTopics) {
    const roadmapId = branchToRoadmap.get(bt.branchId.toString())
    if (!roadmapId) continue
    const set = topicSetByRoadmap.get(roadmapId) ?? new Set<string>()
    set.add(bt.topicId.toString())
    topicSetByRoadmap.set(roadmapId, set)
  }

  return roadmaps.map((r) => ({
    _id: r._id,
    roleName: r.roleName,
    description: r.description,
    topicsCount: topicSetByRoadmap.get(r._id.toString())?.size ?? 0,
  }))
}

/**
 * Branches of a roadmap, ordered, each annotated with how many topics it links
 * and the ordered topic ids themselves (the FE fork UI maps enrolled topics to
 * their branch with these — radio preview, path switch, graph indicator).
 */
const listBranchesForRoadmap = async (roadmapId: Types.ObjectId | string) => {
  const branches = await MasterBranch.find({ roadmapId }).sort({ orderIndex: 1 }).lean()
  if (branches.length === 0) return []

  const branchTopics = await BranchTopic.find({ branchId: { $in: branches.map((b) => b._id) } })
    .select('branchId topicId orderIndex')
    .lean()
  const topicsByBranch = new Map<string, { topicId: string; orderIndex: number }[]>()
  for (const bt of branchTopics) {
    const id = bt.branchId.toString()
    const list = topicsByBranch.get(id) ?? []
    list.push({ topicId: bt.topicId.toString(), orderIndex: bt.orderIndex })
    topicsByBranch.set(id, list)
  }

  return branches.map((b) => {
    const topics = (topicsByBranch.get(b._id.toString()) ?? []).sort(
      (x, y) => x.orderIndex - y.orderIndex,
    )
    return {
      _id: b._id,
      name: b.name,
      description: b.description,
      selectionGroup: b.selectionGroup,
      isMutuallyExclusive: b.isMutuallyExclusive,
      isMandatory: b.isMandatory,
      orderIndex: b.orderIndex,
      topicCount: topics.length,
      topicIds: topics.map((t) => t.topicId),
    }
  })
}

const findPublishedRoadmapOrThrow = async (id: string) => {
  if (!isValidObjectId(id)) {
    throw new ApiError(400, 'Invalid roadmap id', 'INVALID_MASTER_ROADMAP_ID')
  }
  const roadmap = await MasterRoadmap.findOne({ _id: id, isPublished: true }).lean()
  if (!roadmap) {
    throw new ApiError(404, 'Master roadmap not found', 'MASTER_ROADMAP_NOT_FOUND')
  }
  return roadmap
}

/** Roadmap detail + its branches (onboarding branch selection). */
export const getMasterRoadmapById = async (id: string) => {
  const roadmap = await findPublishedRoadmapOrThrow(id)
  const branches = await listBranchesForRoadmap(roadmap._id)
  return {
    _id: roadmap._id,
    roleName: roadmap.roleName,
    description: roadmap.description,
    branches,
  }
}

/** Branches only (branch-selection screen). */
export const getMasterRoadmapBranches = async (id: string) => {
  const roadmap = await findPublishedRoadmapOrThrow(id)
  return listBranchesForRoadmap(roadmap._id)
}

/**
 * Build the full { roadmap, topics, edges } graph for a roadmap: every branch's
 * topics (deduped across branches, smallest orderIndex kept), status derived from
 * prerequisites only — NO user progress. Shared by the public demo tree and the
 * authed all-branches graph (Customize shows every parallel branch at once).
 */
const buildMasterRoadmapGraph = async (roadmap: {
  _id: Types.ObjectId
  roleName: string
  description?: string | null
}) => {
  const branches = await MasterBranch.find({ roadmapId: roadmap._id }).select('_id').lean()
  const branchTopics = await BranchTopic.find({ branchId: { $in: branches.map((b) => b._id) } })
    .select('topicId orderIndex')
    .lean()

  // Dedupe topics shared across branches, keeping the smallest orderIndex.
  const orderByTopic = new Map<string, number>()
  for (const bt of branchTopics) {
    const id = bt.topicId.toString()
    const prev = orderByTopic.get(id)
    if (prev === undefined || bt.orderIndex < prev) orderByTopic.set(id, bt.orderIndex)
  }
  const topicIds = Array.from(orderByTopic.keys())

  const [masterTopics, sections] = await Promise.all([
    MasterTopic.find({ _id: { $in: topicIds }, isPublished: true })
      .select('name descriptionShort estimatedHours dependsOn.requiredTopicIds')
      .lean(),
    Section.find({ topicId: { $in: topicIds }, isPublished: true })
      .select('topicId')
      .lean(),
  ])

  const sectionTotalByTopic = new Map<string, number>()
  for (const s of sections) {
    const id = s.topicId.toString()
    sectionTotalByTopic.set(id, (sectionTotalByTopic.get(id) ?? 0) + 1)
  }

  const inputs: GraphTopicInput[] = masterTopics.map((m) => {
    const masterTopicId = m._id.toString()
    return {
      masterTopicId,
      userTopicId: null,
      name: m.name,
      descriptionShort: m.descriptionShort ?? '',
      orderIndex: orderByTopic.get(masterTopicId) ?? 0,
      estimatedHours: m.estimatedHours,
      prerequisiteTopicIds: (m.dependsOn?.requiredTopicIds ?? []).map((id) => id.toString()),
      rawStatus: null,
      sectionTotal: sectionTotalByTopic.get(masterTopicId) ?? 0,
      sectionCompleted: 0,
    }
  })

  const graph = buildRoadmapGraph(inputs)
  return {
    roadmap: {
      masterRoadmapId: roadmap._id,
      roleName: roadmap.roleName,
      description: roadmap.description,
    },
    topics: graph.topics,
    edges: graph.edges,
  }
}

/**
 * Public, no-login demo tree (mentor #1). Picks the Frontend roadmap, falling back
 * to the first published one, then builds its all-branches graph (no user progress).
 */
export const getDemoRoadmap = async () => {
  const roadmap =
    (await MasterRoadmap.findOne({ isPublished: true, roleName: /frontend/i }).lean()) ??
    (await MasterRoadmap.findOne({ isPublished: true }).sort({ roleName: 1 }).lean())
  if (!roadmap) {
    throw new ApiError(404, 'No published roadmap available for demo', 'DEMO_ROADMAP_NOT_FOUND')
  }
  const graph = await buildMasterRoadmapGraph(roadmap)
  return { ...graph, isDemo: true }
}

/**
 * Full all-branches graph for a specific published roadmap — same
 * { roadmap, topics, edges } shape as the demo tree, with no user progress. Powers
 * the Customize editor's "show every parallel branch" view (the FE overlays the
 * learner's enrolled topics to highlight the chosen branch and ghost the rest,
 * mapping topics to branches via GET /master-roadmaps/:id/branches topicIds).
 */
export const getMasterRoadmapGraph = async (id: string) => {
  const roadmap = await findPublishedRoadmapOrThrow(id)
  return buildMasterRoadmapGraph(roadmap)
}
