import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { seedRoadmap } from './helpers/fixtures.js'
import { Section } from '../src/models/section.model.js'
import { Quiz } from '../src/models/quiz.model.js'
import { Question } from '../src/models/question.model.js'
import { QuestionOption } from '../src/models/question-option.model.js'
import { QuestionType } from '../src/types/enums.js'

// Intercept every AI provider call so no test ever leaves the process (and so we
// can simulate outages / uncovered-question answers deterministically).
const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }))
vi.mock('../src/config/ai-model.js', () => ({
  aiModel: { generateContent: generateContentMock },
}))

const base = '/api/v1/client'

const aiJson = (payload: unknown) => ({
  response: { text: () => JSON.stringify(payload) },
})

const fakeId = () => new mongoose.Types.ObjectId().toString()

const register = async (email: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/auth/signup`)
    .send({ email, password: 'Sup3rPass!', username: email.split('@')[0] })
  return res.body.data.token as string
}

const enroll = (token: string, roadmapId: string, branchId: string) =>
  request(app)
    .post(`${base}/roadmaps`)
    .set('Authorization', `Bearer ${token}`)
    .send({ masterRoadmapId: roadmapId, branchSelections: [branchId] })

interface SeededCoachQuiz {
  quizId: string
  mcqId: string
  fillId: string
  correctOptionId: string
  wrongOptionId: string
}

// Published section (with one curated resource) + 2-question quiz: an MCQ whose
// correct option is '<a>' and a fill-in-blank whose canonical answer is 'npm'.
const seedCoachQuiz = async (topicId: string): Promise<SeededCoachQuiz> => {
  const section = await Section.create({
    topicId,
    name: 'HTML Links',
    slug: 'html-links',
    isPublished: true,
    orderIndex: 0,
    resourceList: [
      {
        title: 'MDN: the <a> element',
        url: 'https://developer.mozilla.org/anchor',
        type: 'docs',
        provider: 'MDN',
        estimatedMinutes: 20,
      },
    ],
  })
  const quiz = await Quiz.create({ sectionId: section._id, minPassScore: 80 })
  const mcq = await Question.create({
    quizId: quiz._id,
    type: QuestionType.MULTIPLE_CHOICE,
    content: 'Which tag creates a hyperlink?',
    correctAnswer: 'A',
    orderIndex: 0,
  })
  const correctOption = await QuestionOption.create({
    questionId: mcq._id,
    content: '<a>',
    isCorrect: true,
    orderIndex: 0,
  })
  const wrongOption = await QuestionOption.create({
    questionId: mcq._id,
    content: '<div>',
    isCorrect: false,
    orderIndex: 1,
  })
  const fill = await Question.create({
    quizId: quiz._id,
    type: QuestionType.FILL_IN_BLANK,
    content: 'Node package manager?',
    correctAnswer: 'npm',
    orderIndex: 1,
  })
  return {
    quizId: quiz._id.toString(),
    mcqId: mcq._id.toString(),
    fillId: fill._id.toString(),
    correctOptionId: correctOption._id.toString(),
    wrongOptionId: wrongOption._id.toString(),
  }
}

// Start + submit in one go; returns the closed attempt id.
const submitAttempt = async (
  token: string,
  quizId: string,
  answers: unknown[],
): Promise<string> => {
  const start = await request(app)
    .post(`${base}/quizzes/${quizId}/start`)
    .set('Authorization', `Bearer ${token}`)
  const attemptId = start.body.data.quizAttempt.attemptId as string
  const submit = await request(app)
    .post(`${base}/attempts/${attemptId}/submit`)
    .set('Authorization', `Bearer ${token}`)
    .send({ answers })
  expect(submit.status).toBe(200)
  return attemptId
}

// Register + enroll + seed the coach quiz on a fresh roadmap.
const seedLearner = async (email: string, roleName: string) => {
  const token = await register(email)
  const r = await seedRoadmap(roleName)
  await enroll(token, r.roadmapId, r.branchId)
  const quiz = await seedCoachQuiz(r.topicIds[0]!)
  return { token, quiz }
}

const explain = (token: string, attemptId: string) =>
  request(app)
    .post(`${base}/ai/explain-mistakes`)
    .set('Authorization', `Bearer ${token}`)
    .send({ attemptId })

describe('POST /ai/explain-mistakes', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)
  // Braces on purpose: mockReset() returns the mock (a function), and a function
  // returned from beforeEach would be re-invoked by vitest as a cleanup hook.
  beforeEach(() => {
    generateContentMock.mockReset()
  })

  it('explains only the wrong questions with the AI answer (envelope + resources)', async () => {
    const { token, quiz } = await seedLearner('coach-happy@example.com', 'Coach Happy')
    // MCQ answered wrong, fill-in-blank answered right → exactly one mistake.
    const attemptId = await submitAttempt(token, quiz.quizId, [
      { questionId: quiz.mcqId, selectedOptionId: quiz.wrongOptionId },
      { questionId: quiz.fillId, userInput: 'npm' },
    ])
    generateContentMock.mockResolvedValue(
      aiJson({
        explanations: [
          {
            questionId: quiz.mcqId,
            why: 'The <div> tag only groups content; <a> is the anchor element that creates links.',
            reviewHint: 'Review anchor tags in "MDN: the <a> element".',
          },
        ],
      }),
    )

    const res = await explain(token, attemptId)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const data = res.body.data
    expect(data.source).toBe('ai')
    expect(data.sectionName).toBe('HTML Links')
    expect(data.explanations).toHaveLength(1)
    expect(data.explanations[0].questionId).toBe(quiz.mcqId)
    expect(data.explanations[0].why).toContain('anchor element')
    expect(data.resources).toEqual([
      { title: 'MDN: the <a> element', url: 'https://developer.mozilla.org/anchor', type: 'docs' },
    ])
    expect(generateContentMock).toHaveBeenCalledTimes(1)

    // Only the WRONG question is sent to the model — never the whole quiz.
    const prompt = generateContentMock.mock.calls[0]![0] as string
    expect(prompt).toContain('Which tag creates a hyperlink?')
    expect(prompt).not.toContain('Node package manager?')
  })

  it('falls back when the AI answer does not cover every wrong question', async () => {
    const { token, quiz } = await seedLearner('coach-uncovered@example.com', 'Coach Uncovered')
    const attemptId = await submitAttempt(token, quiz.quizId, [
      { questionId: quiz.mcqId, selectedOptionId: quiz.wrongOptionId },
      { questionId: quiz.fillId, userInput: 'npm' },
    ])
    // The model answers about an invented question only → unusable coverage.
    generateContentMock.mockResolvedValue(
      aiJson({
        explanations: [{ questionId: fakeId(), why: 'irrelevant', reviewHint: 'irrelevant' }],
      }),
    )

    const res = await explain(token, attemptId)
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('fallback')
    expect(res.body.data.explanations).toHaveLength(1)
    expect(res.body.data.explanations[0].questionId).toBe(quiz.mcqId)
    expect(res.body.data.explanations[0].why).toContain('"<a>"')
  })

  it("returns 404 for another user's attempt (no data leak, no AI call)", async () => {
    const { token, quiz } = await seedLearner('coach-owner-a@example.com', 'Coach Owner')
    const attemptId = await submitAttempt(token, quiz.quizId, [
      { questionId: quiz.mcqId, selectedOptionId: quiz.wrongOptionId },
    ])
    const intruderToken = await register('coach-owner-b@example.com')

    const res = await explain(intruderToken, attemptId)
    expect(res.status).toBe(404)
    expect(res.body.success).toBe(false)
    expect(res.body.error.code).toBe('ATTEMPT_NOT_FOUND')
    expect(res.body.data).toBeUndefined()
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an attempt that has not been submitted yet', async () => {
    const { token, quiz } = await seedLearner('coach-open@example.com', 'Coach Open')
    const start = await request(app)
      .post(`${base}/quizzes/${quiz.quizId}/start`)
      .set('Authorization', `Bearer ${token}`)
    const openAttemptId = start.body.data.quizAttempt.attemptId as string

    const res = await explain(token, openAttemptId)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('ATTEMPT_NOT_FOUND')
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('returns an empty review for a perfect attempt without calling the AI', async () => {
    const { token, quiz } = await seedLearner('coach-perfect@example.com', 'Coach Perfect')
    const attemptId = await submitAttempt(token, quiz.quizId, [
      { questionId: quiz.mcqId, selectedOptionId: quiz.correctOptionId },
      { questionId: quiz.fillId, userInput: 'npm' },
    ])

    const res = await explain(token, attemptId)
    expect(res.status).toBe(200)
    expect(res.body.data.explanations).toEqual([])
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('degrades to correct answers + curated resources when the AI provider is down (200, never 5xx)', async () => {
    const { token, quiz } = await seedLearner('coach-degrade@example.com', 'Coach Degrade')
    // Timed-out attempt submitted empty (NEW-10 path): both questions unanswered.
    const attemptId = await submitAttempt(token, quiz.quizId, [])
    // Throw synchronously (like a network-level SDK failure): the service's
    // try/catch treats this exactly like a rejected AI provider call, and no 10s
    // race timer is ever armed, so the suite can't linger on a dangling timeout.
    generateContentMock.mockImplementation(() => {
      throw new Error('AI provider down (simulated)')
    })

    const res = await explain(token, attemptId)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const data = res.body.data
    expect(data.source).toBe('fallback')
    expect(data.explanations).toHaveLength(2)
    const mcqEntry = data.explanations.find(
      (e: { questionId: string }) => e.questionId === quiz.mcqId,
    )
    expect(mcqEntry.why).toContain('unanswered')
    expect(mcqEntry.why).toContain('"<a>"')
    expect(mcqEntry.reviewHint).toContain('HTML Links')
    expect(data.resources).toHaveLength(1)
  })

  it('requires authentication', async () => {
    const res = await request(app).post(`${base}/ai/explain-mistakes`).send({ attemptId: fakeId() })
    expect(res.status).toBe(401)
  })

  it('rejects a malformed attemptId (Zod)', async () => {
    const token = await register('coach-zod@example.com')
    const res = await explain(token, 'not-an-object-id')
    expect(res.status).toBe(400)
  })
})
