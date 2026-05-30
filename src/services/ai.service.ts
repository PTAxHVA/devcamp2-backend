import { isValidObjectId } from 'mongoose'
import { ApiError } from '../utils/api-error.js'
import { MasterRoadmap } from '../models/master-roadmap.model.js'
import { MasterBranch } from '../models/master-branch.model.js'
import { BranchTopic } from '../models/branch-topic.model.js'
import { MasterTopic } from '../models/master-topic.model.js'
import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import {
  AvailableTopic,
  buildRoadmapSuggestionPrompt,
  LearnerProfile,
  RoadmapSuggestionInput,
} from '../config/ai-prompts.js'
import { geminiModel } from '../config/gemini.js'
import { logger } from '../config/logger.js'

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

  const selectedMasterBranches = await MasterBranch.find({ _id: { $in: branchSelections } }).lean()
  if (!selectedMasterBranches) {
    throw new ApiError(404, 'Master branch not found', 'MASTER_BRANCH_NOT_FOUND')
  }

  const selectedBranchTopics = await BranchTopic.find({
    branchId: { $in: selectedMasterBranches.map((branch) => branch._id) },
  }).lean()
  if (!selectedBranchTopics) {
    throw new ApiError(404, 'Branch topics not found', 'BRANCH_TOPICS_NOT_FOUND')
  }

  const selectedMasterTopics = await MasterTopic.find({
    _id: { $in: selectedBranchTopics.map((topic) => topic.topicId) },
  }).lean()

  if (!selectedMasterTopics) {
    throw new ApiError(404, 'Master topics not found', 'MASTER_TOPICS_NOT_FOUND')
  }

  const topics = []
  for (const topic of selectedBranchTopics) {
    const masterTopic = await MasterTopic.findById(topic.topicId)
    if (!masterTopic) {
      throw new ApiError(404, 'Master topic not found', 'MASTER_TOPIC_NOT_FOUND')
    }
    topics.push({
      orderIndex: topic.orderIndex,
      topicId: masterTopic._id.toString(),
      name: masterTopic.name,
      descriptionShort: masterTopic.descriptionShort,
      estimatedHours: masterTopic.estimatedHours,
      requiredTopicIds: masterTopic.dependsOn.requiredTopicIds.map((id) => id.toString()),
    })
  }

  const fallback = {
    suggestedTopics: topics.sort((a, b) => a.orderIndex - b.orderIndex),
    explanation: 'AI is currently not available, showing the default roadmap',
  }

  const userOnboardingProfile = await OnboardingQuestionnaire.findOne({
    user: userId,
  }).lean()

  if (!userOnboardingProfile) {
    throw new ApiError(
      404,
      'User onboarding profile not found',
      'USER_ONBOARDING_PROFILE_NOT_FOUND',
    )
  }

  const availableTopics: AvailableTopic[] = []

  for (const topic of selectedMasterTopics) {
    availableTopics.push({
      id: topic._id.toString(),
      name: topic.name,
      descriptionShort: topic.descriptionShort,
      estimatedHours: topic.estimatedHours,
      requiredTopicIds: topic.dependsOn.requiredTopicIds.map((id) => id.toString()),
    })
  }

  const leanerProfile: LearnerProfile = {
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
    profile: leanerProfile,
    availableTopics: availableTopics,
  }

  const roadmapSuggestion = buildRoadmapSuggestionPrompt(roadmapSuggestionInput)

  try {
    const response: any = await Promise.race([
      geminiModel.generateContent(roadmapSuggestion),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Gemini API timeout')), 10_000)),
    ])

    if (!response.response.text()) {
      throw new Error('Empty response from Gemini API')
    }

    const suggestedRoadmap = JSON.parse(response.response.text())
    const topicNameById = new Map<string, string>(
      selectedMasterTopics.map((topic) => [topic._id.toString(), topic.name]),
    )

    return {
      suggestedTopics: suggestedRoadmap.orderedTopicIds
        .filter((topicId: any) => topicNameById.has(topicId))
        .map((topicId: string) => ({
          id: topicId,
          name: topicNameById.get(topicId),
        })),
      explanation: suggestedRoadmap.explanation,
    }
  } catch (error) {
    logger.error({ error }, 'Failed to generate suggested roadmap')
    return fallback
  }
}
