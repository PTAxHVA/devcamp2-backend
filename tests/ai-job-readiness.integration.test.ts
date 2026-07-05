import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import request from 'supertest'
import mongoose from 'mongoose'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { BranchTopic } from '../src/models/branch-topic.model.js'
import { Section } from '../src/models/section.model.js'
import { Quiz } from '../src/models/quiz.model.js'
import { Question } from '../src/models/question.model.js'
import { OnboardingQuestionnaire } from '../src/models/onboarding-questionnaire.model.js'
import { QuestionType } from '../src/types/enums.js'

// Intercept every Gemini call so no test ever leaves the process (and so we can
// simulate outages / invented-topic answers deterministically).
const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }))
vi.mock('../src/config/gemini.js', () => ({
  geminiModel: { generateContent: generateContentMock },
}))

const base = '/api/v1/client'
const ROLE_FE = 'Junior Frontend Developer'

const geminiJson = (payload: unknown) => ({
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

/**
 * Library of 4 published topics whose slugs overlap the 'Junior Frontend
 * Developer' curated fallback (html, css, git-github, react). CSS gets two
 * sections so it can sit "in progress"; the others get one.
 */
const seedGapLibrary = async () => {
  const roadmap = await MasterRoadmap.create({
    roleName: 'Frontend Gap',
    description: 'Frontend Gap roadmap',
    isPublished: true,
  })
  const branch = await MasterBranch.create({ roadmapId: roadmap._id, name: 'Core', orderIndex: 0 })
  const makeTopic = async (name: string, slug: string, orderIndex: number) => {
    const topic = await MasterTopic.create({ name, slug, estimatedHours: 2, isPublished: true })
    await BranchTopic.create({ branchId: branch._id, topicId: topic._id, orderIndex })
    return topic._id.toString()
  }
  const html = await makeTopic('HTML', 'html', 0)
  const css = await makeTopic('CSS', 'css', 1)
  const git = await makeTopic('Git & GitHub', 'git-github', 2)
  const react = await makeTopic('React', 'react', 3)
  const htmlQuiz = await seedSectionQuiz(html, 'gap-h1')
  const cssQuiz = await seedSectionQuiz(css, 'gap-c1')
  await seedSectionQuiz(css, 'gap-c2')
  await seedSectionQuiz(git, 'gap-g1')
  await seedSectionQuiz(react, 'gap-r1')
  return {
    roadmapId: roadmap._id.toString(),
    branchId: branch._id.toString(),
    ids: { html, css, git, react },
    htmlQuiz,
    cssQuiz,
  }
}

// Learner with HTML verified (1/1 sections), CSS in progress (1/2), Git & React untouched.
const seedLearner = async (email: string) => {
  const lib = await seedGapLibrary()
  const token = await register(email)
  await enroll(token, lib.roadmapId, lib.branchId)
  await passQuiz(token, lib.htmlQuiz.quizId, lib.htmlQuiz.questionId)
  await passQuiz(token, lib.cssQuiz.quizId, lib.cssQuiz.questionId)
  return { token, lib }
}

const analyze = (token: string, role: string) =>
  request(app)
    .post(`${base}/ai/job-readiness`)
    .set('Authorization', `Bearer ${token}`)
    .send({ role })

const topicIds = (items: Array<{ topicId: string }>) => items.map((t) => t.topicId)

describe('POST /ai/job-readiness (+ GET /ai/job-readiness/roles)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)
  // Braces on purpose: mockReset() returns the mock (a function), and a function
  // returned from beforeEach would be re-invoked by vitest as a cleanup hook.
  beforeEach(() => {
    generateContentMock.mockReset()
  })

  it('classifies AI-selected topics into verified / in progress / missing', async () => {
    const { token, lib } = await seedLearner('gap-happy@example.com')
    generateContentMock.mockResolvedValue(
      geminiJson({ requiredTopicIds: [lib.ids.html, lib.ids.css, lib.ids.react] }),
    )

    const res = await analyze(token, ROLE_FE)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)

    const data = res.body.data
    expect(data.role).toBe(ROLE_FE)
    expect(data.source).toBe('ai')
    expect(data.readinessPct).toBe(33) // 1 verified of 3 required
    expect(data.verified).toEqual([{ topicId: lib.ids.html, name: 'HTML', estimatedHours: 2 }])
    expect(data.inProgress).toEqual([{ topicId: lib.ids.css, name: 'CSS', estimatedHours: 2 }])
    expect(data.missing).toEqual([{ topicId: lib.ids.react, name: 'React', estimatedHours: 2 }])
    expect(data.etaWeeks).toBeUndefined() // no questionnaire hours captured
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('silently drops invented topic ids from an otherwise valid AI answer', async () => {
    const { token, lib } = await seedLearner('gap-invented@example.com')
    const invented = fakeId()
    generateContentMock.mockResolvedValue(
      geminiJson({ requiredTopicIds: [lib.ids.html, lib.ids.css, lib.ids.react, invented] }),
    )

    const res = await analyze(token, ROLE_FE)
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('ai')
    expect(
      topicIds([...res.body.data.verified, ...res.body.data.inProgress, ...res.body.data.missing]),
    ).toEqual([lib.ids.html, lib.ids.css, lib.ids.react])
    expect(JSON.stringify(res.body)).not.toContain(invented)
  })

  it('falls back to the curated role map when the AI only returns unknown ids', async () => {
    const { token, lib } = await seedLearner('gap-unknown-ids@example.com')
    generateContentMock.mockResolvedValue(
      geminiJson({ requiredTopicIds: [fakeId(), fakeId(), fakeId()] }),
    )

    const res = await analyze(token, ROLE_FE)
    expect(res.status).toBe(200)
    expect(res.body.data.source).toBe('fallback')
    // Curated fallback order for the role, restricted to seeded slugs.
    expect(topicIds(res.body.data.verified)).toEqual([lib.ids.html])
    expect(topicIds(res.body.data.inProgress)).toEqual([lib.ids.css])
    expect(topicIds(res.body.data.missing)).toEqual([lib.ids.git, lib.ids.react])
    expect(res.body.data.readinessPct).toBe(25) // 1 verified of 4 required
  })

  it('still returns a gap analysis (200, never 5xx) when Gemini is down, with ETA from the questionnaire', async () => {
    const { token, lib } = await seedLearner('gap-degrade@example.com')
    const me = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${token}`)
    await OnboardingQuestionnaire.create({
      userId: me.body.data.userId,
      timePerWeekHours: 3,
    })
    // Throw synchronously (like a network-level SDK failure): the service's
    // try/catch treats this exactly like a rejected Gemini call, and no 10s
    // race timer is ever armed, so the suite can't linger on a dangling timeout.
    generateContentMock.mockImplementation(() => {
      throw new Error('Gemini down (simulated)')
    })

    const res = await analyze(token, ROLE_FE)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.source).toBe('fallback')
    expect(topicIds(res.body.data.missing)).toEqual([lib.ids.git, lib.ids.react])
    // 2 missing topics × 2h = 4h at 3h/week → 2 weeks (ceil).
    expect(res.body.data.etaWeeks).toBe(2)
  })

  it('rejects a role outside the curated picker list', async () => {
    const token = await register('gap-unknown-role@example.com')
    const res = await analyze(token, 'Astronaut')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('UNKNOWN_TARGET_ROLE')
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('rejects an invalid role body (Zod)', async () => {
    const token = await register('gap-invalid-role@example.com')
    const tooShort = await analyze(token, 'a')
    expect(tooShort.status).toBe(400)
    const tooLong = await analyze(token, 'x'.repeat(81))
    expect(tooLong.status).toBe(400)
  })

  it('requires authentication on both endpoints', async () => {
    const post = await request(app).post(`${base}/ai/job-readiness`).send({ role: ROLE_FE })
    expect(post.status).toBe(401)
    const get = await request(app).get(`${base}/ai/job-readiness/roles`)
    expect(get.status).toBe(401)
  })

  it('lists the curated roles for the FE picker', async () => {
    const token = await register('gap-roles@example.com')
    const res = await request(app)
      .get(`${base}/ai/job-readiness/roles`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.data.roles).toEqual([
      'Junior Frontend Developer',
      'Junior Backend Developer',
      'Junior Fullstack Developer',
    ])
  })
})
