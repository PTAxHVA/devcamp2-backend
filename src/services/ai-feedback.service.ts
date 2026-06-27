import { Types } from 'mongoose'
import { GenerateContentResult } from '@google/generative-ai'
import { ApiError } from '../utils/api-error.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { MasterBranch } from '../models/master-branch.model.js'
import { BranchTopic } from '../models/branch-topic.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { MasterTopic } from '../models/master-topic.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { buildRoadmapFeedbackPrompt, RoadmapFeedbackInput } from '../config/ai-prompts.js'
import { geminiModel } from '../config/gemini.js'
import { logger } from '../config/logger.js'
import { RoadmapFeedbackSchema, aiFeedbackResponseSchema } from '../schemas/ai.schema.js'

export const feedbackRoadmap = async (userId: string, reqBody: RoadmapFeedbackSchema) => {
  const { userRoadmapId, action, topicId } = reqBody

  const userRoadmap = await UserRoadmap.findOne({ _id: userRoadmapId, userId }).lean()
  if (!userRoadmap) {
    throw new ApiError(404, 'User roadmap not found', 'USER_ROADMAP_NOT_FOUND')
  }

  const userOnboardingProfile = await OnboardingQuestionnaire.findOne({ userId })
    .select('goal')
    .lean()
  if (!userOnboardingProfile) {
    throw new ApiError(
      404,
      'User onboarding profile not found',
      'USER_ONBOARDING_PROFILE_NOT_FOUND',
    )
  }

  const masterRoadmap = await MasterRoadmap.findById(userRoadmap.roadmapId).lean()
  if (!masterRoadmap) {
    throw new ApiError(404, 'Master roadmap not found', 'MASTER_ROADMAP_NOT_FOUND')
  }

  const masterBranches = await MasterBranch.find({ roadmapId: userRoadmap.roadmapId }).lean()
  const branchTopic = await BranchTopic.findOne({
    topicId,
    branchId: { $in: masterBranches.map((b) => b._id) },
  }).lean()

  if (!branchTopic) {
    throw new ApiError(400, 'Topic does not belong to this roadmap', 'TOPIC_NOT_IN_ROADMAP')
  }

  const editedTopic = await MasterTopic.findOne({ _id: topicId, isPublished: true }).lean()
  if (!editedTopic) {
    throw new ApiError(404, 'Master topic not found or not published', 'MASTER_TOPIC_NOT_FOUND')
  }

  const userTopics = await UserTopic.find({ userRoadmapId }).lean()
  const masterTopics = await MasterTopic.find({
    _id: {
      $in: userTopics.map((userTopics) => userTopics.topicId),
    },
  }).lean()

  const masterTopicMap = new Map(masterTopics.map((t) => [t._id.toString(), t]))

  const allRequiredIds = new Set<string>()
  editedTopic.dependsOn?.requiredTopicIds?.forEach((id) => allRequiredIds.add(id.toString()))
  masterTopics.forEach((t) =>
    t.dependsOn?.requiredTopicIds?.forEach((id) => allRequiredIds.add(id.toString())),
  )

  const requiredTopics = await MasterTopic.find({ _id: { $in: Array.from(allRequiredIds) } })
    .select('name')
    .lean()
  const idToNameMap = new Map(requiredTopics.map((t) => [t._id.toString(), t.name]))

  // Only surface prerequisites that are part of THIS roadmap. Shared topics (Scenario B)
  // can carry cross-branch prereq ids in dependsOn — exclude them so the AI feedback
  // prompt never references a topic outside the user's roadmap.
  const inRoadmapTopicIds = new Set(masterTopics.map((t) => t._id.toString()))
  const resolveNames = (ids: Types.ObjectId[] = []) =>
    ids
      .map((id) => id.toString())
      .filter((id) => inRoadmapTopicIds.has(id))
      .map((id) => idToNameMap.get(id))
      .filter(Boolean) as string[]

  const feedbackInput: RoadmapFeedbackInput = {
    roadmapRole: masterRoadmap.roleName,
    learnerGoal: userOnboardingProfile.goal,
    action: action,
    editedTopic: {
      name: editedTopic.name,
      descriptionShort: editedTopic.descriptionShort,
      prerequisiteNames: resolveNames(editedTopic.dependsOn?.requiredTopicIds),
    },
    currentTopics: userTopics
      .filter((ut) => ut.topicId.toString() !== editedTopic._id.toString())
      .map((userTopic) => {
        const masterTopic = masterTopicMap.get(userTopic.topicId.toString())
        if (!masterTopic) {
          throw new ApiError(404, 'Master topic not found in map', 'MASTER_TOPIC_NOT_FOUND')
        }
        return {
          name: masterTopic.name,
          descriptionShort: masterTopic.descriptionShort,
          prerequisiteNames: resolveNames(masterTopic.dependsOn?.requiredTopicIds),
        }
      }),
  }

  const roadmapFeedbackPrompt = buildRoadmapFeedbackPrompt(feedbackInput)

  const fallbackFeedback =
    reqBody.action === 'add'
      ? {
          feedback: 'Please consider topic dependencies and pre-completion before adding.',
          severity: 'medium',
        }
      : {
          feedback:
            "Removing this topic might impact your roadmap's coverage of certain concepts. Please review your roadmap before removing this topic.",
          severity: 'medium',
        }

  try {
    const response = (await Promise.race([
      geminiModel.generateContent(roadmapFeedbackPrompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini API timeout')), 10_000)),
    ])) as GenerateContentResult

    const rawText = response.response.text()
    if (!rawText) {
      throw new Error('Empty response from Gemini API')
    }

    const cleanedText = rawText
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()
    const parsed = JSON.parse(cleanedText)
    const validated = aiFeedbackResponseSchema.parse(parsed)

    return {
      feedback: validated.feedback,
      severity: validated.severity,
    }
  } catch (error) {
    logger.error({ error }, 'Failed to generate roadmap feedback')
    return fallbackFeedback
  }
}
