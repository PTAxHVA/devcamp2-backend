import { GenerateContentResult } from '@google/generative-ai'
import { MasterTopic } from '../models/master-topic.model.js'
import { Section } from '../models/section.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { OnboardingQuestionnaire } from '../models/onboarding-questionnaire.model.js'
import { TARGET_ROLES, TargetRole, findTargetRole } from '../config/job-readiness-roles.js'
import { buildJobReadinessPrompt, JobReadinessTopic } from '../config/ai-prompts.js'
import { geminiModel } from '../config/gemini.js'
import { logger } from '../config/logger.js'
import { jobReadinessAiResponseSchema } from '../schemas/ai.schema.js'
import { ApiError } from '../utils/api-error.js'

const GEMINI_TIMEOUT_MS = 10_000
// Fewer valid ids than this and the AI answer is degenerate → use the curated fallback.
const MIN_REQUIRED_TOPICS = 3

export interface GapTopicItem {
  topicId: string
  name: string
  estimatedHours: number
}

export interface JobReadinessResult {
  role: string
  readinessPct: number
  source: 'ai' | 'fallback'
  verified: GapTopicItem[]
  inProgress: GapTopicItem[]
  missing: GapTopicItem[]
  etaWeeks?: number
}

/** Role names the FE role-picker offers (single source of truth for both sides). */
export const getJobReadinessRoles = (): { roles: string[] } => ({
  roles: TARGET_ROLES.map((r) => r.role),
})

interface LibraryTopic {
  id: string
  name: string
  slug: string
  descriptionShort: string
  estimatedHours: number
}

const loadLibraryTopics = async (): Promise<LibraryTopic[]> => {
  const topics = await MasterTopic.find({ isPublished: true })
    .select('name slug descriptionShort estimatedHours')
    .lean()
  return topics.map((t) => ({
    id: t._id.toString(),
    name: t.name,
    slug: t.slug,
    descriptionShort: t.descriptionShort,
    estimatedHours: t.estimatedHours ?? 0,
  }))
}

/**
 * Per master topic: completed published sections (done) vs published sections
 * (total), across the user's ACTIVE roadmaps. Same "verified" basis as the
 * dashboard Completed Topics tile and the public passport: a topic is verified
 * when it has published sections and every one is quiz-passed, deduped across
 * roadmaps that share the topic (best per-roadmap count wins, so pre-sync
 * history can never undercount).
 */
const loadTopicProgress = async (
  userId: string,
): Promise<Map<string, { done: number; total: number }>> => {
  const userRoadmaps = await UserRoadmap.find({ userId, isActive: true }).select('_id').lean()
  if (userRoadmaps.length === 0) return new Map()

  const userTopics = await UserTopic.find({
    userRoadmapId: { $in: userRoadmaps.map((r) => r._id) },
  })
    .select('topicId')
    .lean()
  if (userTopics.length === 0) return new Map()

  const masterTopicIds = [...new Set(userTopics.map((t) => t.topicId.toString()))]
  const [sections, progresses] = await Promise.all([
    Section.find({ topicId: { $in: masterTopicIds }, isPublished: true })
      .select('topicId')
      .lean(),
    UserSectionProgress.find({ userTopicId: { $in: userTopics.map((t) => t._id) } })
      .select('userTopicId sectionId isCompleted')
      .lean(),
  ])

  const publishedSectionIds = new Set(sections.map((s) => s._id.toString()))
  const totalByTopic = new Map<string, number>()
  for (const s of sections) {
    const topicId = s.topicId.toString()
    totalByTopic.set(topicId, (totalByTopic.get(topicId) ?? 0) + 1)
  }

  const doneByUserTopic = new Map<string, number>()
  for (const p of progresses) {
    if (!p.isCompleted || !publishedSectionIds.has(p.sectionId.toString())) continue
    const id = p.userTopicId.toString()
    doneByUserTopic.set(id, (doneByUserTopic.get(id) ?? 0) + 1)
  }

  const progressByTopic = new Map<string, { done: number; total: number }>()
  for (const t of userTopics) {
    const topicId = t.topicId.toString()
    const done = doneByUserTopic.get(t._id.toString()) ?? 0
    const total = totalByTopic.get(topicId) ?? 0
    const prev = progressByTopic.get(topicId)
    if (!prev || done > prev.done) progressByTopic.set(topicId, { done, total })
  }
  return progressByTopic
}

/**
 * Ask Gemini which library topics the role requires. Throws on timeout, bad
 * JSON, or a degenerate answer — the caller catches and falls back, so this
 * never surfaces to the user.
 */
const askGeminiForRequiredIds = async (
  role: string,
  libraryTopics: LibraryTopic[],
): Promise<string[]> => {
  const promptTopics: JobReadinessTopic[] = libraryTopics.map((t) => ({
    id: t.id,
    name: t.name,
    descriptionShort: t.descriptionShort,
    estimatedHours: t.estimatedHours,
  }))
  const prompt = buildJobReadinessPrompt(role, promptTopics)

  let timeoutTimer: NodeJS.Timeout | undefined
  const response = (await Promise.race([
    geminiModel.generateContent(prompt),
    new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => reject(new Error('Gemini API timeout')), GEMINI_TIMEOUT_MS)
    }),
    // Clear the timer once the race settles so a fast Gemini answer doesn't
    // leave a 10s timeout holding the event loop per request.
  ]).finally(() => clearTimeout(timeoutTimer))) as GenerateContentResult

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
  const validated = jobReadinessAiResponseSchema.parse(parsed)

  // Hard guardrail: keep ONLY ids that exist in the curated library (order kept,
  // deduped). An invented id must never leak into the response payload.
  const libraryIds = new Set(libraryTopics.map((t) => t.id))
  const validIds = [...new Set(validated.requiredTopicIds)].filter((id) => libraryIds.has(id))

  if (validIds.length < Math.min(MIN_REQUIRED_TOPICS, libraryTopics.length)) {
    throw new Error('AI returned too few known topic ids')
  }
  return validIds
}

/** Curated slugs → library ids (order kept; slugs missing from the library are skipped). */
const resolveFallbackIds = (targetRole: TargetRole, libraryTopics: LibraryTopic[]): string[] => {
  const idBySlug = new Map(libraryTopics.map((t) => [t.slug, t.id]))
  return targetRole.fallbackTopicSlugs
    .map((slug) => idBySlug.get(slug))
    .filter((id): id is string => id !== undefined)
}

export const analyzeJobReadiness = async (
  userId: string,
  roleInput: string,
): Promise<JobReadinessResult> => {
  const targetRole = findTargetRole(roleInput)
  if (!targetRole) {
    throw new ApiError(400, 'Unknown target role', 'UNKNOWN_TARGET_ROLE', {
      roles: TARGET_ROLES.map((r) => r.role),
    })
  }

  const libraryTopics = await loadLibraryTopics()
  if (libraryTopics.length === 0) {
    throw new ApiError(404, 'No published topics available', 'TOPIC_LIBRARY_EMPTY')
  }

  let source: JobReadinessResult['source'] = 'ai'
  let requiredIds: string[]
  try {
    requiredIds = await askGeminiForRequiredIds(targetRole.role, libraryTopics)
  } catch (error) {
    logger.error({ error }, 'Job-readiness AI call failed — using curated fallback')
    source = 'fallback'
    requiredIds = resolveFallbackIds(targetRole, libraryTopics)
  }
  if (requiredIds.length === 0) {
    // Both the AI and the curated slugs missed the library (e.g. renamed topics
    // after a reseed) — treat the whole library as required rather than failing.
    logger.warn('Job-readiness fallback slugs resolved to no topics — using full library')
    requiredIds = libraryTopics.map((t) => t.id)
  }

  const progressByTopic = await loadTopicProgress(userId)
  const topicById = new Map(libraryTopics.map((t) => [t.id, t]))

  const verified: GapTopicItem[] = []
  const inProgress: GapTopicItem[] = []
  const missing: GapTopicItem[] = []
  for (const id of requiredIds) {
    const topic = topicById.get(id)
    if (!topic) continue // requiredIds ⊆ library by construction; defensive only
    const item: GapTopicItem = {
      topicId: topic.id,
      name: topic.name,
      estimatedHours: topic.estimatedHours,
    }
    const progress = progressByTopic.get(id)
    if (progress && progress.total > 0 && progress.done >= progress.total) verified.push(item)
    else if (progress && progress.done > 0) inProgress.push(item)
    else missing.push(item)
  }

  const readinessPct = Math.round((verified.length / requiredIds.length) * 100)

  // Optional "ETA to job-ready": hours of missing topics ÷ the learner's own
  // hours-per-week from the onboarding questionnaire (omitted when not captured).
  const questionnaire = await OnboardingQuestionnaire.findOne({ userId })
    .select('timePerWeekHours')
    .lean()
  const hoursPerWeek = questionnaire?.timePerWeekHours ?? 0
  const missingHours = missing.reduce((sum, t) => sum + t.estimatedHours, 0)
  // Both guards: no hours captured → no ETA; zero-hour missing topics → no
  // "0 weeks" claim while topics are still missing.
  const etaWeeks =
    missingHours > 0 && hoursPerWeek > 0 ? Math.ceil(missingHours / hoursPerWeek) : undefined

  return {
    role: targetRole.role,
    readinessPct,
    source,
    verified,
    inProgress,
    missing,
    ...(etaWeeks !== undefined ? { etaWeeks } : {}),
  }
}
