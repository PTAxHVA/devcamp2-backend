import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { connectTestDb, disconnectTestDb } from './helpers/test-db.js'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { BranchTopic } from '../src/models/branch-topic.model.js'
import { parseAndValidate, applyPlan } from '../scripts/seed-content.js'
import request from 'supertest'
import app from '../src/app.js'

type SeedPlan = Awaited<ReturnType<typeof parseAndValidate>>

/** Resolve a topic's slug from the parsed plan by its exact CSV Topic_Name. */
const slugOfName = (plan: SeedPlan, name: string): string => {
  for (const [slug, topic] of plan.topics) {
    if (topic.name === name) return slug
  }
  throw new Error(`Topic named "${name}" not found in the seed plan`)
}

const topicByName = async (plan: SeedPlan, name: string) => {
  const topic = await MasterTopic.findOne({ slug: slugOfName(plan, name) }).lean()
  expect(topic, `seeded topic "${name}"`).not.toBeNull()
  return topic!
}

describe('seed fork groups (in-memory Mongo, real CSVs)', () => {
  let plan: SeedPlan

  beforeAll(async () => {
    await connectTestDb()
    plan = await parseAndValidate()
    await applyPlan(plan)
  }, 180000)
  afterAll(disconnectTestDb)

  it('splits the Backend roadmap into a mandatory core + three exclusive Database branches', async () => {
    const be = await MasterRoadmap.findOne({ roleName: 'Backend Web Developer' }).lean()
    expect(be).not.toBeNull()
    const branches = await MasterBranch.find({ roadmapId: be!._id }).sort({ orderIndex: 1 }).lean()
    expect(branches.map((b) => b.name)).toEqual([
      'Node + Express Core',
      'MongoDB',
      'PostgreSQL',
      'MySQL',
    ])

    const [core, mongo, pg, mysql] = branches
    expect(core!.selectionGroup).toBeNull()
    expect(core!.isMutuallyExclusive).toBe(false)
    expect(core!.isMandatory).toBe(true)
    expect(core!.orderIndex).toBe(0)
    for (const branch of [mongo!, pg!, mysql!]) {
      expect(branch.selectionGroup).toBe('Database')
      expect(branch.isMutuallyExclusive).toBe(true)
      expect(branch.isMandatory).toBe(false)
    }

    // Edge split: core keeps 7 topics; each fork branch exactly its one topic,
    // which KEEPS its CSV Topic_ID as orderIndex so any composition (core + one
    // fork) reads in the original CSV order.
    expect(await BranchTopic.countDocuments({ branchId: core!._id })).toBe(7)
    const mongoTopic = await topicByName(plan, 'MongoDB (with Mongoose)')
    const pgTopic = await topicByName(plan, 'PostgreSQL (with Prisma)')
    const mysqlTopic = await topicByName(plan, 'MySQL (with Prisma)')
    const mongoEdges = await BranchTopic.find({ branchId: mongo!._id }).lean()
    const pgEdges = await BranchTopic.find({ branchId: pg!._id }).lean()
    const mysqlEdges = await BranchTopic.find({ branchId: mysql!._id }).lean()
    expect(mongoEdges).toHaveLength(1)
    expect(pgEdges).toHaveLength(1)
    expect(mysqlEdges).toHaveLength(1)
    expect(mongoEdges[0]!.topicId.toString()).toBe(mongoTopic._id.toString())
    expect(pgEdges[0]!.topicId.toString()).toBe(pgTopic._id.toString())
    expect(mysqlEdges[0]!.topicId.toString()).toBe(mysqlTopic._id.toString())
    expect(pgEdges[0]!.orderIndex).toBeLessThan(mongoEdges[0]!.orderIndex) // CSV: Postgres before Mongo
  })

  it('splits the Frontend roadmap into a mandatory core + UI Framework and Styling fork groups', async () => {
    const fe = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    const branches = await MasterBranch.find({ roadmapId: fe!._id }).sort({ orderIndex: 1 }).lean()
    expect(branches.map((b) => b.name)).toEqual([
      'Frontend Core',
      'React',
      'Vue',
      'Angular',
      'Tailwind CSS',
      'Bootstrap',
    ])
    const byName = new Map(branches.map((b) => [b.name, b]))
    expect(byName.get('Frontend Core')!.selectionGroup).toBeNull()
    expect(byName.get('Frontend Core')!.isMandatory).toBe(true)
    for (const n of ['React', 'Vue', 'Angular']) {
      expect(byName.get(n)!.selectionGroup).toBe('UI Framework')
      expect(byName.get(n)!.isMutuallyExclusive).toBe(true)
    }
    for (const n of ['Tailwind CSS', 'Bootstrap']) {
      expect(byName.get(n)!.selectionGroup).toBe('Styling')
      expect(byName.get(n)!.isMutuallyExclusive).toBe(true)
    }

    // React branch keeps both React and Next.js; each other fork branch carries one topic.
    const react = await topicByName(plan, 'React')
    const next = await topicByName(plan, 'Next.js')
    const reactEdges = await BranchTopic.find({ branchId: byName.get('React')!._id }).lean()
    expect(new Set(reactEdges.map((e) => e.topicId.toString()))).toEqual(
      new Set([react._id.toString(), next._id.toString()]),
    )
    expect(await BranchTopic.countDocuments({ branchId: byName.get('Vue')!._id })).toBe(1)

    // Composition prereqs: each framework follows TypeScript; each styling option follows CSS.
    const reqIds = (t: typeof react) =>
      (t.dependsOn?.requiredTopicIds ?? []).map((id) => id.toString())
    const ts = await topicByName(plan, 'TypeScript')
    const css = await topicByName(plan, 'CSS')
    const vue = await topicByName(plan, 'Vue')
    const bootstrap = await topicByName(plan, 'Bootstrap')
    expect(reqIds(react)).toContain(ts._id.toString())
    expect(reqIds(vue)).toContain(ts._id.toString())
    expect(reqIds(bootstrap)).toContain(css._id.toString())
  })

  it('derives composition prereqs: each DB topic follows Node & Express, the join topic needs all three', async () => {
    const node = await topicByName(plan, 'Node.js & Express')
    const mongo = await topicByName(plan, 'MongoDB (with Mongoose)')
    const pg = await topicByName(plan, 'PostgreSQL (with Prisma)')
    const mysql = await topicByName(plan, 'MySQL (with Prisma)')
    const auth = await topicByName(plan, 'Authentication & Authorization')

    const reqIds = (t: typeof node) =>
      (t.dependsOn?.requiredTopicIds ?? []).map((id) => id.toString())

    expect(reqIds(mongo)).toEqual([node._id.toString()])
    expect(reqIds(pg)).toEqual([node._id.toString()])
    expect(reqIds(mysql)).toEqual([node._id.toString()])
    // The join topic (Auth) follows every DB branch: its prereqs union all three.
    expect(new Set(reqIds(auth))).toEqual(
      new Set([mongo._id.toString(), pg._id.toString(), mysql._id.toString()]),
    )
    // Spot-check the core chain is intact.
    const ts = await topicByName(plan, 'TypeScript')
    expect(reqIds(node)).toContain(ts._id.toString())
  })

  it('reconciles a stale renamed branch (and its edges) on re-apply', async () => {
    const be = await MasterRoadmap.findOne({ roleName: 'Backend Web Developer' }).lean()
    const anyTopic = await MasterTopic.findOne().lean()
    const stale = await MasterBranch.create({
      roadmapId: be!._id,
      name: 'Node + Express + Mongo', // the pre-fork prod branch name
      orderIndex: 9,
    })
    await BranchTopic.create({ branchId: stale._id, topicId: anyTopic!._id, orderIndex: 0 })

    await applyPlan(plan)

    expect(await MasterBranch.findById(stale._id).lean()).toBeNull()
    expect(await BranchTopic.countDocuments({ branchId: stale._id })).toBe(0)
    expect(await MasterBranch.countDocuments({ roadmapId: be!._id })).toBe(4)
  }, 120000)

  it('heals blanked fork fields on existing branch docs ($set, not $setOnInsert)', async () => {
    const be = await MasterRoadmap.findOne({ roleName: 'Backend Web Developer' }).lean()
    await MasterBranch.updateOne(
      { roadmapId: be!._id, name: 'MongoDB' },
      { $set: { selectionGroup: null, isMutuallyExclusive: false } },
    )

    await applyPlan(plan)

    const healed = await MasterBranch.findOne({ roadmapId: be!._id, name: 'MongoDB' }).lean()
    expect(healed!.selectionGroup).toBe('Database')
    expect(healed!.isMutuallyExclusive).toBe(true)
  }, 120000)

  it('is idempotent: a second apply keeps branches, edges and prereqs stable', async () => {
    const branchesBefore = await MasterBranch.countDocuments()
    const edgesBefore = await BranchTopic.countDocuments()
    const authBefore = await topicByName(plan, 'Authentication & Authorization')

    await applyPlan(plan)

    expect(await MasterBranch.countDocuments()).toBe(branchesBefore)
    expect(await BranchTopic.countDocuments()).toBe(edgesBefore)
    const authAfter = await topicByName(plan, 'Authentication & Authorization')
    expect(new Set((authAfter.dependsOn?.requiredTopicIds ?? []).map(String))).toEqual(
      new Set((authBefore.dependsOn?.requiredTopicIds ?? []).map(String)),
    )
  }, 120000)

  // GET /master-roadmaps/:id/graph — the all-branches graph the Customize editor uses
  // to render every parallel branch (highlight enrolled, ghost the rest).
  it('GET /master-roadmaps/:id/graph returns every parallel branch topic + core', async () => {
    const fe = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    const res = await request(app).get(`/api/v1/client/master-roadmaps/${fe!._id.toString()}/graph`)
    expect(res.status).toBe(200)
    expect(res.body.data.roadmap.roleName).toBe('Frontend Web Developer')
    const names = new Set(res.body.data.topics.map((t: { name: string }) => t.name))
    for (const n of [
      'HTML',
      'CSS',
      'TypeScript',
      'React',
      'Next.js',
      'Vue',
      'Angular',
      'Tailwind CSS',
      'Bootstrap',
    ]) {
      expect(names.has(n), `graph includes ${n}`).toBe(true)
    }
    // core (7) + React, Next.js, Vue, Angular, Tailwind CSS, Bootstrap (6) = 13
    expect(res.body.data.topics).toHaveLength(13)
  })

  it('the graph branches at each fork without connecting exclusive siblings', async () => {
    const fe = await MasterRoadmap.findOne({ roleName: 'Frontend Web Developer' }).lean()
    const res = await request(app).get(`/api/v1/client/master-roadmaps/${fe!._id.toString()}/graph`)
    const { topics, edges } = res.body.data
    const idOf = (name: string) =>
      topics.find((t: { name: string; masterTopicId: string }) => t.name === name)!.masterTopicId
    const has = (source: string, target: string) =>
      edges.some(
        (e: { source: string; target: string }) =>
          e.source === idOf(source) && e.target === idOf(target),
      )
    // Each framework depends on TypeScript; each styling option depends on CSS.
    expect(has('TypeScript', 'React')).toBe(true)
    expect(has('TypeScript', 'Vue')).toBe(true)
    expect(has('TypeScript', 'Angular')).toBe(true)
    expect(has('CSS', 'Tailwind CSS')).toBe(true)
    expect(has('CSS', 'Bootstrap')).toBe(true)
    // Exclusive siblings are never directly connected.
    expect(has('React', 'Vue')).toBe(false)
    expect(has('Tailwind CSS', 'Bootstrap')).toBe(false)
  })

  it('GET /master-roadmaps/:id/graph 404s for an unknown roadmap id', async () => {
    const res = await request(app).get(
      '/api/v1/client/master-roadmaps/507f1f77bcf86cd799439011/graph',
    )
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('MASTER_ROADMAP_NOT_FOUND')
  })
})
