import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { BranchTopic } from '../src/models/branch-topic.model.js'

// Intercept every Gemini call so no test ever leaves the process (and so we can
// simulate outages deterministically).
const { generateContentMock } = vi.hoisted(() => ({ generateContentMock: vi.fn() }))
vi.mock('../src/config/gemini.js', () => ({
  geminiModel: { generateContent: generateContentMock },
}))

const base = '/api/v1/client'

const geminiJson = (payload: unknown) => ({
  response: { text: () => JSON.stringify(payload) },
})

const register = async (email: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/auth/signup`)
    .send({ email, password: 'Sup3rPass!', username: email.split('@')[0] })
  return res.body.data.token as string
}

// The AI reads the learner profile server-side — the suggest endpoint 404s
// without a saved questionnaire, so every test saves one first.
const saveQuestionnaire = (token: string) =>
  request(app)
    .post(`${base}/onboarding/questionnaire`)
    .set('Authorization', `Bearer ${token}`)
    .send({ rolePreference: 'frontend', goal: 'job' })

/** Two published topics on one branch, canonical order HTML → CSS. */
const seedSuggestLibrary = async () => {
  const roadmap = await MasterRoadmap.create({
    roleName: 'Frontend Suggest',
    description: 'Frontend Suggest roadmap',
    isPublished: true,
  })
  const branch = await MasterBranch.create({ roadmapId: roadmap._id, name: 'Core', orderIndex: 0 })
  const makeTopic = async (name: string, slug: string, orderIndex: number) => {
    const topic = await MasterTopic.create({
      name,
      slug,
      descriptionShort: `${name} basics`,
      estimatedHours: 2,
      isPublished: true,
    })
    await BranchTopic.create({ branchId: branch._id, topicId: topic._id, orderIndex })
    return topic._id.toString()
  }
  const html = await makeTopic('HTML', 'sug-html', 0)
  const css = await makeTopic('CSS', 'sug-css', 1)
  return { roadmapId: roadmap._id.toString(), branchId: branch._id.toString(), html, css }
}

const suggest = (token: string, roadmapId: string, branchId: string) =>
  request(app)
    .post(`${base}/ai/roadmap-suggest`)
    .set('Authorization', `Bearer ${token}`)
    .send({ masterRoadmapId: roadmapId, branchSelections: [branchId] })

describe('POST /ai/roadmap-suggest', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)
  // Braces on purpose: mockReset() returns the mock (a function), and a function
  // returned from beforeEach would be re-invoked by vitest as a cleanup hook.
  beforeEach(() => {
    generateContentMock.mockReset()
  })

  it('tags a real Gemini ordering with source ai and keeps its explanation', async () => {
    const lib = await seedSuggestLibrary()
    const token = await register('suggest-ai@example.com')
    await saveQuestionnaire(token)
    // AI reorders CSS before HTML (no prerequisites, so any order is valid).
    generateContentMock.mockResolvedValue(
      geminiJson({
        orderedTopicIds: [lib.css, lib.html],
        explanation: 'CSS first suits your visual project goal.',
      }),
    )

    const res = await suggest(token, lib.roadmapId, lib.branchId)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.source).toBe('ai')
    expect(res.body.data.explanation).toBe('CSS first suits your visual project goal.')
    expect(res.body.data.suggestedTopics.map((t: { id: string }) => t.id)).toEqual([
      lib.css,
      lib.html,
    ])
  })

  it('degrades to source fallback with the default order when Gemini is down', async () => {
    const lib = await seedSuggestLibrary()
    const token = await register('suggest-down@example.com')
    await saveQuestionnaire(token)
    generateContentMock.mockRejectedValue(new Error('gemini down'))

    const res = await suggest(token, lib.roadmapId, lib.branchId)
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.source).toBe('fallback')
    // Canonical branch order, untouched by the failed AI call.
    expect(res.body.data.suggestedTopics.map((t: { id: string }) => t.id)).toEqual([
      lib.html,
      lib.css,
    ])
    expect(typeof res.body.data.explanation).toBe('string')
  })
})
