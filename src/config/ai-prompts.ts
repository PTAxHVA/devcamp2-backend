/**
 * Prompt builders for VORA's user-facing AI features.
 * Content owned by the team lead. The AI service interpolates runtime data
 * and calls Gemini (see config/gemini.ts).
 */

/** One curated topic the AI is allowed to order. Resolved from the user's selected branches. */
export interface AvailableTopic {
  id: string // MasterTopic._id as a string
  name: string
  descriptionShort: string
  estimatedHours: number
  requiredTopicIds: string[] // prerequisite topic ids — must appear earlier in the order
}

/** Learner profile = the user's OnboardingQuestionnaire answers (F2 + F3). */
export interface LearnerProfile {
  rolePreference: string
  goal: string
  timePerWeekHours: number
  currentComfortLevel: string
  learningStyle: string
  frameworkPreference: string
  projectType: string
  cliComfort: string
  timelineGoal: string
  operatingSystem: string
  extraPreferences: string
}

/** Everything the service must resolve before building the suggestion prompt. */
export interface RoadmapSuggestionInput {
  roadmapRole: string // MasterRoadmap.roleName, e.g. "Frontend Web"
  selectedBranchNames: string[] // MasterBranch.name[] the user picked
  profile: LearnerProfile
  availableTopics: AvailableTopic[] // ONLY topics from the selected branches
}

/** Render the topic library as compact lines the model can reason over. */
const formatTopicLines = (topics: AvailableTopic[]): string =>
  topics
    .map((t) => {
      const prereq =
        t.requiredTopicIds.length > 0 ? ` | prereq: [${t.requiredTopicIds.join(', ')}]` : ''
      return `- ${t.id} | ${t.name} (~${t.estimatedHours}h)${prereq} — ${t.descriptionShort}`
    })
    .join('\n')

const sanitizeInput = (value: string | undefined | null, maxLength = 100): string => {
  if (!value) return '(not specified)'
  const trimmed = value.trim()
  if (!trimmed) return '(not specified)'
  return trimmed.substring(0, maxLength).replace(/[\r\n]+/g, ' ')
}

/**
 * F13 — Roadmap Suggestion Engine prompt.
 * Returns a single string to pass to geminiModel.generateContent().
 */
export const buildRoadmapSuggestionPrompt = (input: RoadmapSuggestionInput): string => {
  const { roadmapRole, selectedBranchNames, profile, availableTopics } = input

  const safeProfile = {
    targetRole: sanitizeInput(roadmapRole),
    selectedBranches: selectedBranchNames.length ? selectedBranchNames.join(', ') : '(none)',
    mainGoal: sanitizeInput(profile.goal, 200),
    comfortWithBasics: sanitizeInput(profile.currentComfortLevel),
    commandLineComfort: sanitizeInput(profile.cliComfort),
    preferredLearningStyle: sanitizeInput(profile.learningStyle),
    frameworkPreference: sanitizeInput(profile.frameworkPreference),
    projectType: sanitizeInput(profile.projectType, 200),
    timeAvailablePerWeekHours: profile.timePerWeekHours,
    targetTimeline: sanitizeInput(profile.timelineGoal),
    operatingSystem: sanitizeInput(profile.operatingSystem),
    otherNotes: sanitizeInput(profile.extraPreferences, 300),
  }

  return `You are a curriculum advisor for VORA, a learning platform for beginner web developers.
Your job: order a FIXED list of curated topics into the best learning sequence for ONE specific learner.
You do NOT create, rename, merge, split, or invent topics. You only reorder the topics given below.

== LEARNER PROFILE (UNTRUSTED USER INPUT) ==
\`\`\`json
${JSON.stringify(safeProfile, null, 2)}
\`\`\`

== AVAILABLE TOPICS (the ONLY topics you may use) ==
${formatTopicLines(availableTopics)}

== ORDERING RULES ==
1. Return EVERY topic id from the available list exactly once. Do not add, drop, or duplicate any.
2. A topic must appear AFTER all of its prerequisites.
3. Put foundational, beginner-friendly topics earlier — especially when comfort with basics is low.
4. Bring topics that match the learner's goal, framework preference, and project type earlier where prerequisites allow.
5. Keep the sequence realistic for the learner's weekly time and target timeline.

== EXPLANATION ==
Write 1-2 short, friendly sentences (max ~40 words) in Vietnamese telling the learner why this order suits them. No markdown, no bullet points, no topic ids.

Return ONLY valid JSON (no markdown): { "orderedTopicIds": [string], "explanation": "..." }
Only include topic IDs from the available list. DO NOT invent topics.`
}
