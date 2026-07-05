import { GenerateContentResult } from '@google/generative-ai'
import { Quiz } from '../models/quiz.model.js'
import { Section } from '../models/section.model.js'
import { buildExplainMistakesPrompt, MistakeQuestionInput } from '../config/ai-prompts.js'
import { geminiModel } from '../config/gemini.js'
import { logger } from '../config/logger.js'
import { explainMistakesAiResponseSchema } from '../schemas/ai.schema.js'
import { QuestionType } from '../types/enums.js'
import { getAttemptResult } from './quiz-attempt.service.js'

const GEMINI_TIMEOUT_MS = 10_000
// Defensive cap so an over-chatty model answer can't balloon the payload.
const MAX_EXPLANATION_CHARS = 400

export interface MistakeExplanation {
  questionId: string
  why: string
  reviewHint: string
}

export interface SectionResourceLink {
  title: string
  url: string
  type: string
}

export interface ExplainMistakesResult {
  attemptId: string
  sectionName: string
  source: 'ai' | 'fallback'
  explanations: MistakeExplanation[]
  resources: SectionResourceLink[]
}

type ResultQuestions = Awaited<ReturnType<typeof getAttemptResult>>['questions']

/** Wrong = server-graded incorrect OR never answered (empty/partial timeout submissions). */
const buildWrongQuestions = (questions: ResultQuestions): MistakeQuestionInput[] =>
  questions
    .filter((q) => !q.userAnswer || !q.userAnswer.isCorrect)
    .map((q) => {
      const isMcq = q.type === QuestionType.MULTIPLE_CHOICE
      const correctOption = q.options.find((o) => o.isCorrect)
      const chosenOption = q.options.find(
        (o) => o._id.toString() === q.userAnswer?.selectedOptionId?.toString(),
      )
      const userAnswerText = isMcq ? chosenOption?.content : q.userAnswer?.userInput?.trim()
      return {
        questionId: q._id.toString(),
        questionText: q.content,
        optionTexts: isMcq ? q.options.map((o) => o.content) : [],
        // MCQ: the correct option's text (Question.correctAnswer only caches the letter).
        correctAnswerText: isMcq ? (correctOption?.content ?? q.correctAnswer) : q.correctAnswer,
        userAnswerText: userAnswerText || '(no answer)',
      }
    })

const loadSectionForQuiz = async (quizId: string) => {
  const quiz = await Quiz.findById(quizId).select('sectionId').lean()
  const section = quiz
    ? await Section.findById(quiz.sectionId).select('name resourceList').lean()
    : null
  if (!section) {
    // Data hole (section removed after the attempt) — the coach still works,
    // it just can't point at curated resources.
    logger.warn({ quizId }, 'Mistake coach: no section found for quiz')
    return { sectionName: 'this section', resources: [] as SectionResourceLink[] }
  }
  return {
    sectionName: section.name,
    resources: section.resourceList.map((r) => ({ title: r.title, url: r.url, type: r.type })),
  }
}

/**
 * Ask Gemini to explain the wrong questions. Throws on timeout, bad JSON, or an
 * answer that does not cover every wrong question — the caller catches and
 * falls back, so this never surfaces to the user.
 */
const askGeminiToExplain = async (
  sectionName: string,
  resources: SectionResourceLink[],
  wrongQuestions: MistakeQuestionInput[],
): Promise<MistakeExplanation[]> => {
  const prompt = buildExplainMistakesPrompt({
    sectionName,
    resourceTitles: resources.map((r) => r.title),
    wrongQuestions,
  })

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
  const validated = explainMistakesAiResponseSchema.parse(parsed)

  // Hard guardrail: exactly one explanation per wrong question, in quiz order.
  // Entries for unknown questionIds are dropped; a missing one degrades to the
  // fallback (all-or-nothing keeps the 'ai' label honest for ≤5 questions).
  const byQuestionId = new Map(validated.explanations.map((e) => [e.questionId, e]))
  return wrongQuestions.map((q) => {
    const entry = byQuestionId.get(q.questionId)
    if (!entry) {
      throw new Error('AI answer did not cover every wrong question')
    }
    return {
      questionId: q.questionId,
      why: entry.why.trim().slice(0, MAX_EXPLANATION_CHARS),
      reviewHint: entry.reviewHint.trim().slice(0, MAX_EXPLANATION_CHARS),
    }
  })
}

/** No-AI fallback: the correct answer + a pointer to the section's curated resources. */
const buildFallbackExplanations = (
  sectionName: string,
  hasResources: boolean,
  wrongQuestions: MistakeQuestionInput[],
): MistakeExplanation[] => {
  const reviewHint = hasResources
    ? `Revisit "${sectionName}" with the curated resources below before retrying.`
    : `Revisit "${sectionName}" before retrying.`
  return wrongQuestions.map((q) => ({
    questionId: q.questionId,
    why:
      q.userAnswerText === '(no answer)'
        ? `This one was left unanswered — the correct answer is "${q.correctAnswerText}".`
        : `The correct answer is "${q.correctAnswerText}", not "${q.userAnswerText}".`,
    reviewHint,
  }))
}

export const explainMistakes = async (
  userId: string,
  attemptId: string,
): Promise<ExplainMistakesResult> => {
  // Ownership + submitted checks live in getAttemptResult (404 ATTEMPT_NOT_FOUND).
  // The coach never trusts client-sent answers — it re-reads the graded attempt.
  const result = await getAttemptResult(attemptId, userId)
  const { sectionName, resources } = await loadSectionForQuiz(result.quizAttempt.quizId.toString())

  const wrongQuestions = buildWrongQuestions(result.questions)
  if (wrongQuestions.length === 0) {
    return { attemptId, sectionName, source: 'fallback', explanations: [], resources }
  }

  try {
    const explanations = await askGeminiToExplain(sectionName, resources, wrongQuestions)
    return { attemptId, sectionName, source: 'ai', explanations, resources }
  } catch (error) {
    logger.error({ error }, 'Mistake-coach AI call failed — using fallback explanations')
    return {
      attemptId,
      sectionName,
      source: 'fallback',
      explanations: buildFallbackExplanations(sectionName, resources.length > 0, wrongQuestions),
      resources,
    }
  }
}
