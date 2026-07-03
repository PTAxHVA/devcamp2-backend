import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { seedRoadmap } from './helpers/fixtures.js'
import { Section } from '../src/models/section.model.js'
import { Quiz } from '../src/models/quiz.model.js'
import { Question } from '../src/models/question.model.js'
import { QuizAttempt } from '../src/models/quiz-attempt.model.js'
import { QuestionType } from '../src/types/enums.js'

const base = '/api/v1/client'

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

// A published section + fill-in-blank quiz (canonical answer 'npm') on a topic the
// learner is enrolled in — enough to start/submit an attempt.
const seedFillBlankQuiz = async (topicId: string) => {
  const section = await Section.create({
    topicId,
    name: 'S1',
    slug: 's1',
    isPublished: true,
    orderIndex: 0,
  })
  const quiz = await Quiz.create({ sectionId: section._id, minPassScore: 80 })
  const question = await Question.create({
    quizId: quiz._id,
    type: QuestionType.FILL_IN_BLANK,
    content: 'Node package manager?',
    correctAnswer: 'npm',
    orderIndex: 0,
  })
  return { quizId: quiz._id.toString(), questionId: question._id.toString() }
}

describe('quiz attempt (integration)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('grades fill-in-blank case-insensitively (C6): NPM matches npm', async () => {
    const token = await register('c6@example.com')
    const r = await seedRoadmap('Frontend C6')
    await enroll(token, r.roadmapId, r.branchId)
    const { quizId, questionId } = await seedFillBlankQuiz(r.topicIds[0]!)

    const start = await request(app)
      .post(`${base}/quizzes/${quizId}/start`)
      .set('Authorization', `Bearer ${token}`)
    const attemptId = start.body.data.quizAttempt.attemptId as string

    const submit = await request(app)
      .post(`${base}/attempts/${attemptId}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answers: [{ questionId, userInput: 'NPM' }] })

    expect(submit.status).toBe(200)
    expect(submit.body.data.isPassed).toBe(true)
    expect(submit.body.data.score).toBe(100)
  })

  it('resets an abandoned unsubmitted attempt after the time budget (NEW-10)', async () => {
    const token = await register('new10@example.com')
    const r = await seedRoadmap('Frontend New10')
    await enroll(token, r.roadmapId, r.branchId)
    const { quizId } = await seedFillBlankQuiz(r.topicIds[0]!)

    const start1 = await request(app)
      .post(`${base}/quizzes/${quizId}/start`)
      .set('Authorization', `Bearer ${token}`)
    expect(start1.status).toBe(200)
    const attemptId = start1.body.data.quizAttempt.attemptId as string

    // A fresh, still-active attempt must be protected (resumed), not reset.
    const startActive = await request(app)
      .post(`${base}/quizzes/${quizId}/start`)
      .set('Authorization', `Bearer ${token}`)
    expect(startActive.status).toBe(409)
    expect(startActive.body.error.code).toBe('QUIZ_ALREADY_STARTED')

    // Age it past the budget (12 min) → the next start resets instead of looping.
    await QuizAttempt.updateOne(
      { _id: attemptId },
      { $set: { startedAt: new Date(Date.now() - 13 * 60 * 1000) } },
    )
    const start2 = await request(app)
      .post(`${base}/quizzes/${quizId}/start`)
      .set('Authorization', `Bearer ${token}`)
    expect(start2.status).toBe(200)
    expect(start2.body.data.quizAttempt.attemptId).toBeTruthy()
  })
})
