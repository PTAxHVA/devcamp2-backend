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

// A published roadmap (1 branch) wired to an EXISTING master topic, so two roadmaps
// can both contain the same topic (F18 "add another role").
const seedRoadmapForTopic = async (roleName: string, topicId: string) => {
  const roadmap = await MasterRoadmap.create({
    roleName,
    description: `${roleName} roadmap`,
    isPublished: true,
  })
  const branch = await MasterBranch.create({
    roadmapId: roadmap._id,
    name: `${roleName} Core`,
    orderIndex: 0,
  })
  await BranchTopic.create({ branchId: branch._id, topicId, orderIndex: 0 })
  return { roadmapId: roadmap._id.toString(), branchId: branch._id.toString() }
}

// Published section + fill-in-blank quiz (canonical answer 'npm') on a given topic.
const seedFillBlankQuiz = async (topicId: string, slug: string) => {
  const section = await Section.create({
    topicId,
    name: 'S1',
    slug,
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

// Find one topic in the roadmap-detail graph by its master topic id.
const roadmapTopic = async (token: string, roadmapId: string, masterTopicId: string) => {
  const res = await request(app)
    .get(`${base}/roadmaps/${roadmapId}`)
    .set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  return res.body.data.topics.find(
    (t: { masterTopicId: string }) => t.masterTopicId === masterTopicId,
  ) as { sectionCompleted: number; sectionTotal: number; status: string }
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
  expect(submit.status).toBe(200)
  expect(submit.body.data.isPassed).toBe(true)
}

describe('shared-topic progress sync (SYNC-01, integration)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('mirrors a section pass to EVERY roadmap that shares the topic', async () => {
    const token = await register('sync01@example.com')

    // One shared master topic enrolled in two roadmaps.
    const topic = await MasterTopic.create({
      name: 'Dev Environment Setup',
      slug: 'shared-dev-env',
      estimatedHours: 2,
      isPublished: true,
    })
    const topicId = topic._id.toString()
    const fe = await seedRoadmapForTopic('Frontend Sync', topicId)
    const be = await seedRoadmapForTopic('Backend Sync', topicId)
    const { quizId, questionId } = await seedFillBlankQuiz(topicId, 'shared-s1')

    // The roadmap-detail endpoint is keyed by USER roadmap id (from the enroll response).
    const feEnroll = await enroll(token, fe.roadmapId, fe.branchId)
    const beEnroll = await enroll(token, be.roadmapId, be.branchId)
    const feUserRoadmapId = feEnroll.body.data._id as string
    const beUserRoadmapId = beEnroll.body.data._id as string

    // Pass the shared section's quiz once.
    await passQuiz(token, quizId, questionId)

    // BOTH roadmaps must now report the shared topic as 1/1 sections completed —
    // not just the arbitrarily-picked one (the old bug left the other at 0/1).
    const feTopic = await roadmapTopic(token, feUserRoadmapId, topicId)
    const beTopic = await roadmapTopic(token, beUserRoadmapId, topicId)

    expect(feTopic.sectionCompleted).toBe(1)
    expect(beTopic.sectionCompleted).toBe(1)
    expect(feTopic.status).toBe('completed')
    expect(beTopic.status).toBe('completed')

    // Dashboard must count the shared topic ONCE, not once per roadmap: one pass of
    // one section = completedTopics 1 and a single weekly-progress tick.
    const dash = await request(app).get(`${base}/dashboard`).set('Authorization', `Bearer ${token}`)
    expect(dash.status).toBe(200)
    expect(dash.body.data.stats.completedTopics).toBe(1)
    const weekTotal = (dash.body.data.weeklyProgress as number[]).reduce((a, b) => a + b, 0)
    expect(weekTotal).toBe(1)
  })

  it('backfills a completed shared topic when the second roadmap is added later', async () => {
    const token = await register('sync01-backfill@example.com')

    const topic = await MasterTopic.create({
      name: 'Shared Later',
      slug: 'shared-later',
      estimatedHours: 2,
      isPublished: true,
    })
    const topicId = topic._id.toString()
    const fe = await seedRoadmapForTopic('FE Backfill', topicId)
    const be = await seedRoadmapForTopic('BE Backfill', topicId)
    const { quizId, questionId } = await seedFillBlankQuiz(topicId, 'backfill-s1')

    // Enroll ONLY the first roadmap and complete the shared section there.
    const feEnroll = await enroll(token, fe.roadmapId, fe.branchId)
    const feUserRoadmapId = feEnroll.body.data._id as string
    await passQuiz(token, quizId, questionId)

    // Add the second roadmap AFTER the pass — it must already report the shared topic
    // as completed via enroll-time backfill, without re-taking the quiz.
    const beEnroll = await enroll(token, be.roadmapId, be.branchId)
    const beUserRoadmapId = beEnroll.body.data._id as string

    const feTopic = await roadmapTopic(token, feUserRoadmapId, topicId)
    const beTopic = await roadmapTopic(token, beUserRoadmapId, topicId)
    expect(feTopic.sectionCompleted).toBe(1)
    expect(beTopic.sectionCompleted).toBe(1)
    expect(beTopic.status).toBe('completed')
  })

  it('leaves single-roadmap grading unchanged (no regression)', async () => {
    const token = await register('sync01-single@example.com')

    const topic = await MasterTopic.create({
      name: 'Solo Topic',
      slug: 'solo-topic',
      estimatedHours: 2,
      isPublished: true,
    })
    const topicId = topic._id.toString()
    const only = await seedRoadmapForTopic('Solo Role', topicId)
    const { quizId, questionId } = await seedFillBlankQuiz(topicId, 'solo-s1')

    const onlyEnroll = await enroll(token, only.roadmapId, only.branchId)
    const onlyUserRoadmapId = onlyEnroll.body.data._id as string
    await passQuiz(token, quizId, questionId)

    const soloTopic = await roadmapTopic(token, onlyUserRoadmapId, topicId)
    expect(soloTopic.sectionCompleted).toBe(1)
    expect(soloTopic.status).toBe('completed')
  })
})
