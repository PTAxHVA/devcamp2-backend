import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { BranchTopic } from '../src/models/branch-topic.model.js'
import { Section } from '../src/models/section.model.js'
import { Quiz } from '../src/models/quiz.model.js'
import { Question } from '../src/models/question.model.js'
import { QuestionType } from '../src/types/enums.js'

const base = '/api/v1/client'
const OWNER_EMAIL = 'passport-owner@example.com'

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

// Published section + fill-in-blank quiz (canonical answer 'npm') on a topic.
const seedSectionQuiz = async (topicId: string, slug: string) => {
  const section = await Section.create({ topicId, name: slug, slug, isPublished: true })
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

// Roadmap with topic "React Basics" (2 sections) + topic "CSS Layout" (1 section).
const seedPassportRoadmap = async () => {
  const roadmap = await MasterRoadmap.create({
    roleName: 'Frontend Passport',
    description: 'Frontend Passport roadmap',
    isPublished: true,
  })
  const branch = await MasterBranch.create({ roadmapId: roadmap._id, name: 'Core', orderIndex: 0 })
  const topicA = await MasterTopic.create({
    name: 'React Basics',
    slug: 'pp-react',
    isPublished: true,
  })
  const topicB = await MasterTopic.create({ name: 'CSS Layout', slug: 'pp-css', isPublished: true })
  await BranchTopic.create({ branchId: branch._id, topicId: topicA._id, orderIndex: 0 })
  await BranchTopic.create({ branchId: branch._id, topicId: topicB._id, orderIndex: 1 })
  const a1 = await seedSectionQuiz(topicA._id.toString(), 'pp-a1')
  const a2 = await seedSectionQuiz(topicA._id.toString(), 'pp-a2')
  const b1 = await seedSectionQuiz(topicB._id.toString(), 'pp-b1')
  return { roadmapId: roadmap._id.toString(), branchId: branch._id.toString(), a1, a2, b1 }
}

const passQuiz = async (token: string, quizId: string, questionId: string) => {
  const start = await request(app)
    .post(`${base}/quizzes/${quizId}/start`)
    .set('Authorization', `Bearer ${token}`)
  const attemptId = start.body.data.quizAttempt.attemptId as string
  const submit = await request(app)
    .post(`${base}/attempts/${attemptId}/submit`)
    .set('Authorization', `Bearer ${token}`)
    .send({ answers: [{ questionId, userInput: 'npm' }] })
  expect(submit.body.data.isPassed).toBe(true)
}

const setPassport = (token: string, body: { isPublic: boolean; regenerate?: boolean }) =>
  request(app).patch(`${base}/me/passport`).set('Authorization', `Bearer ${token}`).send(body)

// Owner with topic A fully verified (2/2 sections) and topic B untouched.
const seedVerifiedOwner = async () => {
  const token = await register(OWNER_EMAIL)
  const r = await seedPassportRoadmap()
  await enroll(token, r.roadmapId, r.branchId)
  await passQuiz(token, r.a1.quizId, r.a1.questionId)
  await passQuiz(token, r.a2.quizId, r.a2.questionId)
  const enabled = await setPassport(token, { isPublic: true })
  return { token, shareToken: enabled.body.data.shareToken as string, b1: r.b1 }
}

describe('verified skill passport (GET /p/:shareToken + /me/passport)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('serves a public passport with only fully-verified topics and no PII', async () => {
    const { token, shareToken } = await seedVerifiedOwner()

    const res = await request(app).get(`${base}/p/${shareToken}`) // no auth header
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const data = res.body.data
    expect(data.username).toBe('passport-owner')
    expect(data.level).toBe('BEGINNER')
    expect(data.streak).toBe(1) // both passes happened today
    expect(data.roadmaps).toEqual([
      { name: 'Frontend Passport', topicsCount: 2, verifiedCount: 1, isCompleted: false },
    ])
    expect(data.verifiedTopics).toEqual([{ name: 'React Basics', masteryPct: 100 }])
    expect(data.completedCount).toBe(1)
    expect(data.totalCount).toBe(2) // CSS Layout enrolled but NOT verified

    // Security contract: no email, no raw user id anywhere in the payload.
    const me = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${token}`)
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain(OWNER_EMAIL)
    expect(raw).not.toContain('email')
    expect(raw).not.toContain(me.body.data.userId as string)
  })

  it('answers 404 PASSPORT_NOT_FOUND for unknown tokens and for private passports alike', async () => {
    const unknown = await request(app).get(`${base}/p/${'ab'.repeat(16)}`)
    expect(unknown.status).toBe(404)
    expect(unknown.body.error.code).toBe('PASSPORT_NOT_FOUND')

    const { token, shareToken } = await seedVerifiedOwner()
    await setPassport(token, { isPublic: false })
    const hidden = await request(app).get(`${base}/p/${shareToken}`)
    expect(hidden.status).toBe(404)
    expect(hidden.body.error.code).toBe('PASSPORT_NOT_FOUND')
  })

  it('hides the passport of a deactivated account', async () => {
    const { token, shareToken } = await seedVerifiedOwner()
    await request(app)
      .patch(`${base}/me/account/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Sup3rPass!' })

    const res = await request(app).get(`${base}/p/${shareToken}`)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('PASSPORT_NOT_FOUND')
  })

  it('requires auth for passport settings and validates the toggle payload', async () => {
    expect((await request(app).get(`${base}/me/passport`)).status).toBe(401)
    expect((await request(app).patch(`${base}/me/passport`).send({ isPublic: true })).status).toBe(
      401,
    )

    const token = await register('passport-zod@example.com')
    const bad = await request(app)
      .patch(`${base}/me/passport`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isPublic: 'yes' })
    expect(bad.status).toBe(400)
  })

  it('keeps the token across disable/re-enable and mints a new one on regenerate', async () => {
    const { token, shareToken } = await seedVerifiedOwner()

    const disabled = await setPassport(token, { isPublic: false })
    expect(disabled.body.data).toMatchObject({ isPublic: false, shareToken })

    const reEnabled = await setPassport(token, { isPublic: true })
    expect(reEnabled.body.data.shareToken).toBe(shareToken)
    expect((await request(app).get(`${base}/p/${shareToken}`)).status).toBe(200)

    const regenerated = await setPassport(token, { isPublic: true, regenerate: true })
    const newToken = regenerated.body.data.shareToken as string
    expect(newToken).not.toBe(shareToken)
    expect(regenerated.body.data.publicUrl).toContain(`/p/${newToken}`)
    expect((await request(app).get(`${base}/p/${shareToken}`)).status).toBe(404)
    expect((await request(app).get(`${base}/p/${newToken}`)).status).toBe(200)

    const settings = await request(app)
      .get(`${base}/me/passport`)
      .set('Authorization', `Bearer ${token}`)
    expect(settings.body.data).toMatchObject({ isPublic: true, shareToken: newToken })
  })

  it('marks a roadmap completed (public certificate) once every topic is verified', async () => {
    const { token, shareToken, b1 } = await seedVerifiedOwner()
    await passQuiz(token, b1.quizId, b1.questionId) // finish the remaining topic

    const res = await request(app).get(`${base}/p/${shareToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.completedCount).toBe(2)
    expect(res.body.data.roadmaps).toEqual([
      { name: 'Frontend Passport', topicsCount: 2, verifiedCount: 2, isCompleted: true },
    ])
  })

  it('serves an empty passport safely for a learner with no roadmaps yet', async () => {
    const token = await register('passport-empty@example.com')
    const enabled = await setPassport(token, { isPublic: true })

    const res = await request(app).get(`${base}/p/${enabled.body.data.shareToken}`)
    expect(res.status).toBe(200)
    expect(res.body.data.verifiedTopics).toEqual([])
    expect(res.body.data.roadmaps).toEqual([])
    expect(res.body.data.completedCount).toBe(0)
    expect(res.body.data.totalCount).toBe(0)
  })
})
