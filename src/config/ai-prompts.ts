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

/**
 * A topic shown to the feedback model — referenced by NAME only, so no ObjectId
 * ever leaks into the user-facing feedback sentence.
 */
export interface FeedbackTopic {
  name: string
  descriptionShort: string
  prerequisiteNames: string[] // prerequisite topic NAMES (resolved from dependsOn.requiredTopicIds)
}

/** Everything the service must resolve before building the feedback prompt (F19). */
export interface RoadmapFeedbackInput {
  roadmapRole: string // MasterRoadmap.roleName, e.g. "Frontend Web"
  learnerGoal: string // OnboardingQuestionnaire.goal — UNTRUSTED user input
  action: 'add' | 'remove' // what the user just did in the customize editor
  editedTopic: FeedbackTopic // the topic being added or removed (curated content)
  currentTopics: FeedbackTopic[] // the OTHER topics currently in the user's roadmap (curated content)
}

/** Render the roadmap's current topics as compact lines: name + what it needs (curated, trusted). */
const formatFeedbackTopicLines = (topics: FeedbackTopic[]): string => {
  if (topics.length === 0) return '(no other topics in the roadmap yet)'
  return topics
    .map((t) => {
      const needs =
        t.prerequisiteNames.length > 0 ? ` | needs: ${t.prerequisiteNames.join(', ')}` : ''
      return `- ${t.name}${needs} — ${t.descriptionShort}`
    })
    .join('\n')
}

/**
 * F19 — AI Feedback on Roadmap Edit prompt.
 * One short, non-blocking note when a learner adds/removes a topic in the customize editor.
 * Returns a single string to pass to geminiModel.generateContent().
 */
export const buildRoadmapFeedbackPrompt = (input: RoadmapFeedbackInput): string => {
  const { roadmapRole, learnerGoal, action, editedTopic, currentTopics } = input

  const actionWord = action === 'add' ? 'ADDED' : 'REMOVED'
  const editedPrereqs =
    editedTopic.prerequisiteNames.length > 0 ? editedTopic.prerequisiteNames.join(', ') : '(none)'

  const safeContext = {
    targetRole: sanitizeInput(roadmapRole),
    learnerGoal: sanitizeInput(learnerGoal, 200),
  }

  return `You are a curriculum advisor for VORA, a learning platform for beginner web developers.
A learner is editing their personalized roadmap. Give ONE short, friendly note about the SINGLE edit below.
You do NOT create, rename, or suggest new topics. You only comment on this edit, using ONLY the topic names provided.

== LEARNER CONTEXT (UNTRUSTED USER INPUT) ==
\`\`\`json
${JSON.stringify(safeContext, null, 2)}
\`\`\`

== EDIT MADE ==
Action: ${actionWord} the topic "${editedTopic.name}" — ${editedTopic.descriptionShort}
Prerequisites of "${editedTopic.name}": ${editedPrereqs}

== OTHER TOPICS CURRENTLY IN THE ROADMAP ==
${formatFeedbackTopicLines(currentTopics)}

== HOW TO JUDGE SEVERITY ==
- ADDED a topic but one or more of its prerequisites are NOT in the roadmap above → "warning"; gently name the missing prerequisite.
- REMOVED a topic that another topic still needs (listed under "needs") → "warning"; name those dependent topics.
- Otherwise → "info"; one short, encouraging or neutral note (e.g. it fits their goal, or it is safe to remove).

== OUTPUT ==
- "feedback": exactly ONE short sentence in Vietnamese (max ~35 words). Friendly and concrete. Refer to topics by name only. No markdown, no IDs, no bullet points.
- "severity": "info" | "warning".

Return ONLY valid JSON (no markdown): { "feedback": "...", "severity": "info" | "warning" }
Only mention topic names that appear above. DO NOT invent topics.`
}
