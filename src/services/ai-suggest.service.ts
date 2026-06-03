import { isValidObjectId } from 'mongoose'
import { GenerateContentResult } from '@google/generative-ai'
import { ApiError } from '../utils/api-error.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { MasterBranch } from '../models/master-branch.model.js'
import { BranchTopic, IBranchTopic } from '../models/branch-topic.model.js'
import { MasterTopic, IMasterTopic } from '../models/master-topic.model.js'
import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import {
  AvailableTopic,
  buildRoadmapSuggestionPrompt,
  LearnerProfile,
  RoadmapSuggestionInput,
} from '../config/ai-prompts.js'
import { geminiModel } from '../config/gemini.js'
import { logger } from '../config/logger.js'
import { aiResponseSchema } from '../schemas/ai.schema.js'

interface DedupedTopic {
  id: string
  name: string
  descriptionShort: string
  estimatedHours: number
  requiredTopicIds: string[]
  orderIndex: number
}

const dedupeAndOrderTopics = (
  selectedBranchTopics: IBranchTopic[],
  masterTopicMap: Map<string, IMasterTopic>,
): DedupedTopic[] => {
  const topicDedupMap = new Map<string, DedupedTopic>()
  for (const topic of selectedBranchTopics) {
    const masterTopicId = topic.topicId.toString()
    const masterTopic = masterTopicMap.get(masterTopicId)
    if (!masterTopic) {
      throw new ApiError(404, 'Master topic not found in map', 'MASTER_TOPIC_NOT_FOUND')
    }

    if (!topicDedupMap.has(masterTopicId)) {
      topicDedupMap.set(masterTopicId, {
        id: masterTopicId,
        name: masterTopic.name,
        descriptionShort: masterTopic.descriptionShort,
        estimatedHours: masterTopic.estimatedHours,
        requiredTopicIds: masterTopic.dependsOn.requiredTopicIds.map((id) => id.toString()),
        orderIndex: topic.orderIndex,
      })
    } else {
      const existing = topicDedupMap.get(masterTopicId)
      if (existing && topic.orderIndex < existing.orderIndex) {
        existing.orderIndex = topic.orderIndex
      }
    }
  }

  const topics = Array.from(topicDedupMap.values())
  return topics.sort((a, b) => a.orderIndex - b.orderIndex)
}

export const generateSuggestedRoadmap = async (
  masterRoadmapId: string,
  branchSelections: string[],
  userId: string,
) => {
  if (!isValidObjectId(masterRoadmapId)) {
    throw new ApiError(400, 'Invalid master roadmap ID', 'INVALID_MASTER_ROADMAP_ID')
  }

  for (const branchId of branchSelections) {
    if (!isValidObjectId(branchId)) {
      throw new ApiError(400, 'Invalid branch ID', 'INVALID_BRANCH_ID')
    }
  }

  const roadmap = await MasterRoadmap.findById(masterRoadmapId).lean()
  if (!roadmap) {
    throw new ApiError(404, 'Master roadmap not found', 'MASTER_ROADMAP_NOT_FOUND')
  }

  const selectedMasterBranches = await MasterBranch.find({
    _id: { $in: branchSelections },
    roadmapId: masterRoadmapId,
  }).lean()
  if (selectedMasterBranches.length !== branchSelections.length) {
    throw new ApiError(
      404,
      'One or more master branches not found or do not belong to roadmap',
      'MASTER_BRANCH_NOT_FOUND',
    )
  }

  const selectedBranchTopics = await BranchTopic.find({
    branchId: { $in: selectedMasterBranches.map((branch) => branch._id) },
  }).lean()
  if (selectedBranchTopics.length === 0) {
    throw new ApiError(404, 'Branch topics not found', 'BRANCH_TOPICS_NOT_FOUND')
  }

  const selectedMasterTopics = await MasterTopic.find({
    _id: { $in: selectedBranchTopics.map((topic) => topic.topicId) },
  }).lean()

  if (selectedMasterTopics.length === 0) {
    throw new ApiError(404, 'Master topics not found', 'MASTER_TOPICS_NOT_FOUND')
  }

  const masterTopicMap = new Map(selectedMasterTopics.map((t) => [t._id.toString(), t]))

  const defaultOrderedTopics = dedupeAndOrderTopics(selectedBranchTopics, masterTopicMap)
  const topics = defaultOrderedTopics

  const fallback = {
    suggestedTopics: defaultOrderedTopics,
    explanation: 'AI is currently not available, showing the default roadmap',
  }

  const userOnboardingProfile = await OnboardingQuestionnaire.findOne({
    userId,
  }).lean()

  if (!userOnboardingProfile) {
    throw new ApiError(
      404,
      'User onboarding profile not found',
      'USER_ONBOARDING_PROFILE_NOT_FOUND',
    )
  }

  const availableTopics: AvailableTopic[] = defaultOrderedTopics.map((t) => ({
    id: t.id,
    name: t.name,
    descriptionShort: t.descriptionShort,
    estimatedHours: t.estimatedHours,
    requiredTopicIds: t.requiredTopicIds,
  }))

  const learnerProfile: LearnerProfile = {
    rolePreference: userOnboardingProfile.rolePreference,
    goal: userOnboardingProfile.goal,
    timePerWeekHours: userOnboardingProfile.timePerWeekHours,
    currentComfortLevel: userOnboardingProfile.currentComfortLevel,
    learningStyle: userOnboardingProfile.learningStyle,
    frameworkPreference: userOnboardingProfile.frameworkPreference,
    projectType: userOnboardingProfile.projectType,
    cliComfort: userOnboardingProfile.cliComfort,
    timelineGoal: userOnboardingProfile.timelineGoal,
    operatingSystem: userOnboardingProfile.operatingSystem,
    extraPreferences: userOnboardingProfile.extraPreferences,
  }

  const roadmapSuggestionInput: RoadmapSuggestionInput = {
    roadmapRole: roadmap.roleName,
    selectedBranchNames: selectedMasterBranches.map((branch) => branch.name),
    profile: learnerProfile,
    availableTopics: availableTopics,
  }

  const roadmapSuggestion = buildRoadmapSuggestionPrompt(roadmapSuggestionInput)

  try {
    const response = (await Promise.race([
      geminiModel.generateContent(roadmapSuggestion),
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
    const validated = aiResponseSchema.parse(parsed)

    const aiIds = validated.orderedTopicIds
    const availableIdsSet = new Set(availableTopics.map((t) => t.id))
    const aiIdsSet = new Set(aiIds)

    if (aiIds.length !== availableTopics.length || aiIdsSet.size !== availableTopics.length) {
      throw new Error('AI returned missing, extra, or duplicated topic IDs')
    }
    for (const id of aiIds) {
      if (!availableIdsSet.has(id)) {
        throw new Error('AI returned unknown topic ID')
      }
    }

    const resolvedOrder = new Map<string, number>()
    aiIds.forEach((id, index) => resolvedOrder.set(id, index))

    for (const topic of topics) {
      const topicIndex = resolvedOrder.get(topic.id)!
      for (const reqId of topic.requiredTopicIds) {
        if (!availableIdsSet.has(reqId)) continue
        const reqIndex = resolvedOrder.get(reqId)!
        if (reqIndex > topicIndex) {
          throw new Error('AI violated prerequisite order')
        }
      }
    }

    const topicDtoMap = new Map(topics.map((t) => [t.id, t]))
    const hydratedTopics = aiIds.map((id, index) => {
      const t = topicDtoMap.get(id)!
      return { ...t, orderIndex: index }
    })

    return {
      suggestedTopics: hydratedTopics,
      explanation: validated.explanation,
    }
  } catch (error) {
    logger.error({ error }, 'Failed to generate suggested roadmap')
    return fallback
  }
}
