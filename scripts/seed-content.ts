/* eslint-disable no-console -- CLI script: console output is the user-facing UI */
/**
 * VORA master content seeder.
 *
 * Reads `seed-data/frontend-content.csv` and `seed-data/backend-content.csv`
 * and upserts them into MongoDB per the v3 LOCKED schema (Scenario B).
 *
 * Architecture (validate-then-apply):
 *   Phase 1  parseAndValidate()  — load CSVs, build typed in-memory plan,
 *                                  reject malformed input BEFORE touching DB
 *   Phase 2  applyPlan()         — idempotent upserts that PRESERVE _id across
 *                                  runs (Questions/Options upserted by
 *                                  (parentId, orderIndex)) so any existing
 *                                  QuizAttemptAnswer.questionId / selectedOptionId
 *                                  references stay valid
 *   Phase 3  convergence prune   — delete BranchTopic links, Sections, Questions,
 *                                  and QuestionOptions that exist in DB but
 *                                  are no longer in the seed source
 *   Phase 4  report               — print apply stats + final DB counts
 *
 * Topics are deduplicated by slug across roadmaps — shared topics
 * (Git, JavaScript Fundamentals, TypeScript, Dev Environment Setup)
 * live as ONE MasterTopic doc but link to multiple branches via BranchTopic.
 *
 * Usage:
 *   yarn seed              # idempotent upsert (safe to re-run; converges to seed source)
 *   yarn seed:dry          # parse + validate + report, NO DB writes
 *   yarn seed:reset        # drop content collections first, then seed
 *
 * Requires MONGO_URI in .env.
 *
 * Known deferrals (see PR #6 review):
 *   - No MongoDB transaction wrapping (Scenario B partial-failure mitigated by
 *     pre-validation + idempotent re-run)
 *   - Sequential writes (perf optimisation deferred; ~2.5 min for 910 questions
 *     against Atlas dev cluster is acceptable for a one-time/occasional seed)
 *   - --reset breaks QuizAttempt + QuizAttemptAnswer references; user
 *     collections are intentionally NOT touched. Run only on dev clusters.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'
import { parse } from 'csv-parse/sync'
import mongoose from 'mongoose'
import { MasterRoadmap } from '../src/models/master-roadmap.model.js'
import { MasterBranch } from '../src/models/master-branch.model.js'
import { MasterTopic } from '../src/models/master-topic.model.js'
import { BranchTopic } from '../src/models/branch-topic.model.js'
import { Section } from '../src/models/section.model.js'
import { Quiz } from '../src/models/quiz.model.js'
import { Question } from '../src/models/question.model.js'
import { QuestionOption } from '../src/models/question-option.model.js'
import { QuestionType } from '../src/types/enums.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')

const args = new Set(process.argv.slice(2))
const RESET = args.has('--reset')
const DRY_RUN = args.has('--dry-run')

// ------------------------------------------------------------ Config

interface SeedJob {
  csvPath: string
  roleName: string
  branchName: string
}

const SEED_JOBS: SeedJob[] = [
  {
    csvPath: join(REPO_ROOT, 'seed-data/frontend-content.csv'),
    roleName: 'Frontend Web Developer',
    branchName: 'React + Tailwind',
  },
  {
    csvPath: join(REPO_ROOT, 'seed-data/backend-content.csv'),
    roleName: 'Backend Web Developer',
    branchName: 'Node + Express + Mongo',
  },
]

const RESOURCES_PATH = join(REPO_ROOT, 'seed-data/resources.json')
const RESOURCE_TYPES = ['article', 'video', 'docs', 'interactive'] as const
type ResourceType = (typeof RESOURCE_TYPES)[number]

interface ResourceEntry {
  title: string
  url: string
  type: ResourceType
  provider: string
  estimatedMinutes: number
}

/**
 * Curated learning resources keyed by topic slug, then by section slug (or
 * '_default' for the whole topic). A section uses its own list if present,
 * otherwise the topic '_default'. Top-level keys starting with '_' (e.g.
 * '_comment') are ignored. Shape mirrors ISection.resourceList.
 */
type ResourceMap = Record<string, Record<string, ResourceEntry[]>>

// ------------------------------------------------------------ Types

interface QuestionPlan {
  orderIndex: number // 1..5 within the parent quiz
  type: QuestionType
  content: string
  correctAnswer: string
  acceptableAnswers: string[]
  options: { content: string; isCorrect: boolean }[] // empty for FILL_IN_BLANK
}

interface SectionPlan {
  slug: string
  name: string
  orderIndex: number
  contentOverview: string
  questions: QuestionPlan[] // 0..5 (a section may have no quiz yet)
}

interface TopicPlan {
  slug: string
  name: string
  sections: SectionPlan[]
  // Per-branch order: same shared topic may sit at different positions in
  // FE vs BE roadmap. Map: branchKey -> orderIndex.
  branchOrders: Map<string, number>
}

interface RoadmapPlan {
  job: SeedJob
  topicSlugs: string[] // ordered list of topic slugs in this roadmap's branch
}

interface SeedPlan {
  roadmaps: RoadmapPlan[]
  topics: Map<string, TopicPlan> // slug -> plan, deduped across roadmaps
  resources: ResourceMap // topic slug -> (section slug | '_default') -> resources
}

interface ApplyStats {
  topicsUpserted: number
  branchLinksUpserted: number
  branchLinksPruned: number
  sectionsUpserted: number
  sectionsPruned: number
  quizzesUpserted: number
  quizzesPruned: number
  questionsUpserted: number
  questionsPruned: number
  optionsUpserted: number
  optionsPruned: number
  topicsWithPrereqs: number
  sectionsWithResources: number
}

// ------------------------------------------------------------ Helpers

function slugify(text: string): string {
  const out = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!out) {
    throw new Error(`slugify produced empty string for input "${text}"`)
  }
  return out
}

function branchKeyOf(job: SeedJob): string {
  return `${job.roleName} :: ${job.branchName}`
}

function cell(row: Record<string, string | undefined>, key: string): string {
  return (row[key] ?? '').trim()
}

async function readCsv(path: string): Promise<Record<string, string>[]> {
  const buf = await readFile(path)
  return parse(buf, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]
}

/**
 * Load + validate seed-data/resources.json. Pushes problems into `errors`
 * (validate-then-apply: a malformed resources file aborts the seed BEFORE any
 * DB write). Top-level keys starting with '_' (e.g. '_comment') are skipped.
 * Returns a typed ResourceMap (empty on any structural error).
 */
async function loadResources(errors: string[]): Promise<ResourceMap> {
  let raw: string
  try {
    raw = await readFile(RESOURCES_PATH, 'utf8')
  } catch {
    errors.push(`Cannot read resources file at ${RESOURCES_PATH}`)
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    errors.push(`resources.json is not valid JSON: ${(e as Error).message}`)
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) {
    errors.push('resources.json must be an object keyed by topic slug')
    return {}
  }

  const out: ResourceMap = {}
  for (const [topicSlug, byKey] of Object.entries(parsed as Record<string, unknown>)) {
    if (topicSlug.startsWith('_')) continue // skip _comment and similar metadata keys
    if (typeof byKey !== 'object' || byKey === null) {
      errors.push(`resources["${topicSlug}"] must be an object of section lists`)
      continue
    }
    const bucket: Record<string, ResourceEntry[]> = {}
    out[topicSlug] = bucket
    for (const [key, list] of Object.entries(byKey as Record<string, unknown>)) {
      if (!Array.isArray(list)) {
        errors.push(`resources["${topicSlug}"]["${key}"] must be an array`)
        continue
      }
      const entries: ResourceEntry[] = []
      list.forEach((item, i) => {
        const ref = `resources["${topicSlug}"]["${key}"][${i}]`
        if (typeof item !== 'object' || item === null) {
          errors.push(`${ref} must be an object`)
          return
        }
        const r = item as Record<string, unknown>
        const title = typeof r.title === 'string' ? r.title.trim() : ''
        const url = typeof r.url === 'string' ? r.url.trim() : ''
        const type = r.type
        const provider = typeof r.provider === 'string' ? r.provider : ''
        const estimatedMinutes = typeof r.estimatedMinutes === 'number' ? r.estimatedMinutes : 0
        if (!title) errors.push(`${ref}: missing title`)
        if (!url) errors.push(`${ref}: missing url`)
        if (typeof type !== 'string' || !RESOURCE_TYPES.includes(type as ResourceType)) {
          errors.push(`${ref}: type must be one of ${RESOURCE_TYPES.join('|')}`)
          return
        }
        if (estimatedMinutes < 0) {
          errors.push(`${ref}: estimatedMinutes must be >= 0`)
        }
        if (title && url) {
          entries.push({ title, url, type: type as ResourceType, provider, estimatedMinutes })
        }
      })
      bucket[key] = entries
    }
  }
  return out
}

/** Resolve the resource list for one section: section-specific, else topic '_default', else []. */
function resolveResources(
  map: ResourceMap,
  topicSlug: string,
  sectionSlug: string,
): ResourceEntry[] {
  const byKey = map[topicSlug]
  if (!byKey) return []
  return byKey[sectionSlug] ?? byKey['_default'] ?? []
}

class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`${errors.length} validation error(s)`)
    this.name = 'ValidationError'
  }
}

// ------------------------------------------------------------ Phase 1: parse + validate

function validateRowQuestion(
  row: Record<string, string>,
  q: number,
  sectionRef: string,
  errors: string[],
): QuestionPlan | null {
  const type = cell(row, `Q${q}_Type`)
  const text = cell(row, `Q${q}_Text`)
  const correct = cell(row, `Q${q}_Correct`)
  const altStr = cell(row, `Q${q}_Alternates`)

  // Empty Q slot is valid (a quiz may have <5 questions).
  if (!type && !text && !correct) return null

  if (!type) {
    errors.push(`${sectionRef} Q${q}: missing Qn_Type`)
    return null
  }
  if (!text) {
    errors.push(`${sectionRef} Q${q}: missing Qn_Text`)
    return null
  }
  if (!correct) {
    errors.push(`${sectionRef} Q${q}: missing Qn_Correct`)
    return null
  }

  const acceptable = altStr
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)

  if (type === 'mc') {
    const options: QuestionPlan['options'] = []
    for (const letter of ['A', 'B', 'C', 'D']) {
      const optContent = cell(row, `Q${q}_${letter}`)
      if (optContent) options.push({ content: optContent, isCorrect: letter === correct })
    }
    if (options.length !== 4) {
      errors.push(`${sectionRef} Q${q}: MC must have exactly 4 options, got ${options.length}`)
      return null
    }
    if (!['A', 'B', 'C', 'D'].includes(correct)) {
      errors.push(`${sectionRef} Q${q}: MC correctAnswer must be A|B|C|D, got "${correct}"`)
      return null
    }
    const correctCount = options.filter((o) => o.isCorrect).length
    if (correctCount !== 1) {
      errors.push(`${sectionRef} Q${q}: MC must have exactly 1 correct option, got ${correctCount}`)
      return null
    }
    return {
      orderIndex: q,
      type: QuestionType.MULTIPLE_CHOICE,
      content: text,
      correctAnswer: correct,
      acceptableAnswers: [],
      options,
    }
  }

  if (type === 'typed') {
    return {
      orderIndex: q,
      type: QuestionType.FILL_IN_BLANK,
      content: text,
      correctAnswer: correct,
      acceptableAnswers: acceptable,
      options: [],
    }
  }

  errors.push(`${sectionRef} Q${q}: unknown Qn_Type "${type}", expected "mc" or "typed"`)
  return null
}

function planFromRows(
  job: SeedJob,
  rows: Record<string, string>[],
  errors: string[],
): Map<string, { plan: TopicPlan; topicOrderIndex: number }> {
  const out = new Map<string, { plan: TopicPlan; topicOrderIndex: number }>()

  for (const row of rows) {
    const topicName = cell(row, 'Topic_Name')
    const sectionName = cell(row, 'Section_Name')
    const sectionIdRaw = cell(row, 'Section_ID')
    const topicIdRaw = cell(row, 'Topic_ID')
    const sectionRef = `[${job.roleName}] section ${sectionIdRaw || '?'}`

    if (!topicName) {
      errors.push(`${sectionRef}: missing Topic_Name`)
      continue
    }
    if (!sectionName) {
      errors.push(`${sectionRef}: missing Section_Name`)
      continue
    }

    let topicSlug: string
    let sectionSlug: string
    try {
      topicSlug = slugify(topicName)
      sectionSlug = slugify(sectionName)
    } catch (e) {
      errors.push(`${sectionRef}: ${(e as Error).message}`)
      continue
    }

    let topicEntry = out.get(topicSlug)
    if (!topicEntry) {
      const topicOrder = Number.parseInt(topicIdRaw, 10)
      if (Number.isNaN(topicOrder)) {
        errors.push(`${sectionRef}: invalid Topic_ID "${topicIdRaw}"`)
        continue
      }
      topicEntry = {
        plan: { slug: topicSlug, name: topicName, sections: [], branchOrders: new Map() },
        topicOrderIndex: topicOrder,
      }
      out.set(topicSlug, topicEntry)
    }

    const sectionOrderStr = sectionIdRaw.split('.')[1] ?? '0'
    const sectionOrder = Number.parseInt(sectionOrderStr, 10) || 0

    const questions: QuestionPlan[] = []
    for (let q = 1; q <= 5; q++) {
      const parsed = validateRowQuestion(row, q, sectionRef, errors)
      if (parsed) questions.push(parsed)
    }

    topicEntry.plan.sections.push({
      slug: sectionSlug,
      name: sectionName,
      orderIndex: sectionOrder,
      contentOverview: cell(row, 'Summary'),
      questions,
    })
  }

  return out
}

async function parseAndValidate(): Promise<SeedPlan> {
  const allErrors: string[] = []
  const topics = new Map<string, TopicPlan>()
  const roadmaps: RoadmapPlan[] = []

  for (const job of SEED_JOBS) {
    console.log(`  Reading ${job.csvPath.split('/').slice(-2).join('/')}...`)
    const rows = await readCsv(job.csvPath)
    console.log(`    ${rows.length} rows parsed`)

    const localTopics = planFromRows(job, rows, allErrors)
    const branchKey = branchKeyOf(job)
    const topicSlugs: string[] = []

    // Sort topics by their Topic_ID order so the BranchTopic.orderIndex is
    // assigned in the same order users will see them.
    const sortedTopics = [...localTopics.entries()].sort(
      ([, a], [, b]) => a.topicOrderIndex - b.topicOrderIndex,
    )

    for (const [slug, entry] of sortedTopics) {
      topicSlugs.push(slug)
      let merged = topics.get(slug)
      if (!merged) {
        merged = entry.plan
        topics.set(slug, merged)
      } else {
        // Same topic in multiple CSVs — merge sections, dedup by sectionSlug.
        const seen = new Set(merged.sections.map((s) => s.slug))
        for (const sec of entry.plan.sections) {
          if (!seen.has(sec.slug)) {
            merged.sections.push(sec)
            seen.add(sec.slug)
          }
        }
      }
      merged.branchOrders.set(branchKey, entry.topicOrderIndex)
    }

    // Sort sections within each topic by their orderIndex for deterministic output.
    for (const t of topics.values()) {
      t.sections.sort((a, b) => a.orderIndex - b.orderIndex)
    }

    roadmaps.push({ job, topicSlugs })
  }

  const resources = await loadResources(allErrors)

  if (allErrors.length > 0) {
    throw new ValidationError(allErrors)
  }
  return { roadmaps, topics, resources }
}

// ------------------------------------------------------------ Phase 2: apply

async function applyPlan(plan: SeedPlan): Promise<ApplyStats> {
  const stats: ApplyStats = {
    topicsUpserted: 0,
    branchLinksUpserted: 0,
    branchLinksPruned: 0,
    sectionsUpserted: 0,
    sectionsPruned: 0,
    quizzesUpserted: 0,
    quizzesPruned: 0,
    questionsUpserted: 0,
    questionsPruned: 0,
    optionsUpserted: 0,
    optionsPruned: 0,
    topicsWithPrereqs: 0,
    sectionsWithResources: 0,
  }

  // 2a. Upsert roadmaps + branches
  const branchIdByKey = new Map<string, mongoose.Types.ObjectId>()
  for (const rm of plan.roadmaps) {
    const roadmap = await MasterRoadmap.findOneAndUpdate(
      { roleName: rm.job.roleName },
      {
        $setOnInsert: {
          roleName: rm.job.roleName,
          description: `${rm.job.roleName} learning path`,
          isPublished: true,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
    if (!roadmap) throw new Error(`Failed to upsert roadmap ${rm.job.roleName}`)

    const branch = await MasterBranch.findOneAndUpdate(
      { roadmapId: roadmap._id, name: rm.job.branchName },
      {
        $setOnInsert: {
          roadmapId: roadmap._id,
          name: rm.job.branchName,
          description: '',
          orderIndex: 0,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
    if (!branch) throw new Error(`Failed to upsert branch ${rm.job.branchName}`)
    branchIdByKey.set(branchKeyOf(rm.job), branch._id as mongoose.Types.ObjectId)
  }

  // 2b. Upsert topics (library, dedup by slug)
  const topicIdBySlug = new Map<string, mongoose.Types.ObjectId>()
  for (const [slug, t] of plan.topics) {
    const topic = await MasterTopic.findOneAndUpdate(
      { slug },
      {
        $setOnInsert: {
          name: t.name,
          slug,
          description: '',
          descriptionShort: '',
          estimatedHours: 0,
          iconUrl: '',
          isPublished: true,
          dependsOn: { requiredTopicIds: [], requiredBranchIds: [] },
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
    if (!topic) throw new Error(`Failed to upsert topic ${slug}`)
    topicIdBySlug.set(slug, topic._id as mongoose.Types.ObjectId)
    stats.topicsUpserted++
  }

  // 2b-prereqs. Derive sequential prerequisites: each topic depends on the topic
  // immediately before it in every branch it belongs to (union across branches).
  // This is what drives roadmap-viz edges (buildRoadmapGraph) + customize-order
  // validation + AI suggest/feedback. Topics are shared across roadmaps (Scenario B),
  // so a cross-branch prerequisite id is simply filtered out per-roadmap downstream
  // (idSet.has / assertPrerequisiteOrder) — at worst a missing edge, never a wrong one.
  // Done as a second pass so every topic's _id is known before we reference it.
  const prereqSlugsByTopic = new Map<string, Set<string>>()
  for (const rm of plan.roadmaps) {
    for (let i = 1; i < rm.topicSlugs.length; i++) {
      const cur = rm.topicSlugs[i]
      const prev = rm.topicSlugs[i - 1]
      if (cur === undefined || prev === undefined) continue
      const set = prereqSlugsByTopic.get(cur) ?? new Set<string>()
      set.add(prev)
      prereqSlugsByTopic.set(cur, set)
    }
  }
  // Set requiredTopicIds for EVERY topic (empty for the first in each branch) so the
  // seed is convergent: re-running clears stale prereqs too.
  for (const slug of plan.topics.keys()) {
    const topicId = topicIdBySlug.get(slug)
    if (!topicId) continue
    const reqIds = [...(prereqSlugsByTopic.get(slug) ?? new Set<string>())]
      .map((s) => topicIdBySlug.get(s))
      .filter((id): id is mongoose.Types.ObjectId => id !== undefined)
    await MasterTopic.updateOne(
      { _id: topicId },
      { $set: { 'dependsOn.requiredTopicIds': reqIds } },
    )
    if (reqIds.length > 0) stats.topicsWithPrereqs++
  }

  // 2c. BranchTopic junctions + prune stale per branch
  for (const rm of plan.roadmaps) {
    const branchKey = branchKeyOf(rm.job)
    const branchId = branchIdByKey.get(branchKey)
    if (!branchId) throw new Error(`Missing branchId for ${branchKey}`)
    const expected: mongoose.Types.ObjectId[] = []

    for (const slug of rm.topicSlugs) {
      const topicId = topicIdBySlug.get(slug)
      const topicPlan = plan.topics.get(slug)
      if (!topicId || !topicPlan) throw new Error(`Missing topic data for ${slug}`)
      const orderIndex = topicPlan.branchOrders.get(branchKey) ?? 0
      await BranchTopic.findOneAndUpdate(
        { branchId, topicId },
        { $set: { orderIndex }, $setOnInsert: { branchId, topicId } },
        { upsert: true, returnDocument: 'after' },
      )
      expected.push(topicId)
      stats.branchLinksUpserted++
    }
    const pruned = await BranchTopic.deleteMany({ branchId, topicId: { $nin: expected } })
    stats.branchLinksPruned += pruned.deletedCount ?? 0
  }

  // 2d. For each topic: upsert Sections / prune stale / upsert Quiz / Questions / Options
  for (const [slug, topicPlan] of plan.topics) {
    const topicId = topicIdBySlug.get(slug)
    if (!topicId) throw new Error(`Missing topicId for ${slug}`)

    const expectedSectionSlugs = new Set(topicPlan.sections.map((s) => s.slug))
    const sectionIdBySlug = new Map<string, mongoose.Types.ObjectId>()

    // Upsert sections
    for (const sec of topicPlan.sections) {
      // resourceList moved to $set (was $setOnInsert) so re-seeding refreshes
      // curated links on already-seeded sections, not just new ones.
      const resourceList = resolveResources(plan.resources, slug, sec.slug)
      const section = await Section.findOneAndUpdate(
        { topicId, slug: sec.slug },
        {
          $set: {
            name: sec.name,
            contentOverview: sec.contentOverview,
            orderIndex: sec.orderIndex,
            isPublished: true,
            resourceList,
          },
          $setOnInsert: { topicId, slug: sec.slug },
        },
        { upsert: true, returnDocument: 'after' },
      )
      if (!section) throw new Error(`Failed to upsert section ${slug}/${sec.slug}`)
      sectionIdBySlug.set(sec.slug, section._id as mongoose.Types.ObjectId)
      stats.sectionsUpserted++
      if (resourceList.length > 0) stats.sectionsWithResources++
    }

    // Prune stale sections under this topic (cascade quiz + questions + options)
    const dbSections = await Section.find({ topicId }, { _id: 1, slug: 1 })
    for (const s of dbSections) {
      if (expectedSectionSlugs.has(s.slug)) continue
      const sId = s._id as mongoose.Types.ObjectId
      const staleQuiz = await Quiz.findOne({ sectionId: sId }, { _id: 1 })
      if (staleQuiz) {
        const staleQs = await Question.find({ quizId: staleQuiz._id }, { _id: 1 })
        if (staleQs.length > 0) {
          await QuestionOption.deleteMany({ questionId: { $in: staleQs.map((q) => q._id) } })
          await Question.deleteMany({ quizId: staleQuiz._id })
        }
        await Quiz.deleteOne({ _id: staleQuiz._id })
        stats.quizzesPruned++
      }
      await Section.deleteOne({ _id: sId })
      stats.sectionsPruned++
    }

    // Upsert quiz + questions + options (preserving _id for stable references)
    for (const sec of topicPlan.sections) {
      const sectionId = sectionIdBySlug.get(sec.slug)
      if (!sectionId) throw new Error(`Missing sectionId for ${sec.slug}`)

      const quiz = await Quiz.findOneAndUpdate(
        { sectionId },
        { $set: { minPassScore: 80 }, $setOnInsert: { sectionId } },
        { upsert: true, returnDocument: 'after' },
      )
      if (!quiz) throw new Error(`Failed to upsert quiz for section ${sec.slug}`)
      const quizId = quiz._id as mongoose.Types.ObjectId
      stats.quizzesUpserted++

      const expectedOrderIndexes = sec.questions.map((q) => q.orderIndex)

      for (const q of sec.questions) {
        const question = await Question.findOneAndUpdate(
          { quizId, orderIndex: q.orderIndex },
          {
            $set: {
              type: q.type,
              content: q.content,
              correctAnswer: q.correctAnswer,
              acceptableAnswers: q.acceptableAnswers,
            },
            $setOnInsert: { quizId, orderIndex: q.orderIndex },
          },
          { upsert: true, returnDocument: 'after' },
        )
        if (!question) throw new Error(`Failed to upsert question`)
        const questionId = question._id as mongoose.Types.ObjectId
        stats.questionsUpserted++

        // Options: upsert by (questionId, orderIndex), then prune leftover
        for (let i = 0; i < q.options.length; i++) {
          const opt = q.options[i]
          if (!opt) continue
          await QuestionOption.findOneAndUpdate(
            { questionId, orderIndex: i },
            {
              $set: { content: opt.content, isCorrect: opt.isCorrect },
              $setOnInsert: { questionId, orderIndex: i },
            },
            { upsert: true, returnDocument: 'after' },
          )
          stats.optionsUpserted++
        }
        const prunedOpts = await QuestionOption.deleteMany({
          questionId,
          orderIndex: { $gte: q.options.length },
        })
        stats.optionsPruned += prunedOpts.deletedCount ?? 0
      }

      // Prune leftover Questions in this quiz beyond what we just upserted
      const staleQs = await Question.find(
        { quizId, orderIndex: { $nin: expectedOrderIndexes } },
        { _id: 1 },
      )
      if (staleQs.length > 0) {
        await QuestionOption.deleteMany({ questionId: { $in: staleQs.map((p) => p._id) } })
        const r = await Question.deleteMany({
          quizId,
          orderIndex: { $nin: expectedOrderIndexes },
        })
        stats.questionsPruned += r.deletedCount ?? 0
      }
    }
  }

  return stats
}

// ------------------------------------------------------------ Main

async function main() {
  if (DRY_RUN) {
    console.log('--dry-run: parse + validate only, NO DB writes\n')
  }

  console.log('=== Phase 1: parse + validate ===')
  let plan: SeedPlan
  try {
    plan = await parseAndValidate()
  } catch (err) {
    if (err instanceof ValidationError) {
      console.error('\nFATAL: CSV validation failed:')
      for (const e of err.errors) console.error(`  - ${e}`)
      process.exit(1)
    }
    throw err
  }

  const totalSections = [...plan.topics.values()].reduce((a, t) => a + t.sections.length, 0)
  const totalQuestions = [...plan.topics.values()].reduce(
    (a, t) => a + t.sections.reduce((b, s) => b + s.questions.length, 0),
    0,
  )
  const totalOptions = [...plan.topics.values()].reduce(
    (a, t) =>
      a + t.sections.reduce((b, s) => b + s.questions.reduce((c, q) => c + q.options.length, 0), 0),
    0,
  )
  const totalBranchLinks = plan.roadmaps.reduce((a, r) => a + r.topicSlugs.length, 0)

  const resourceTopics = Object.keys(plan.resources).length
  const resourceEntries = Object.values(plan.resources).reduce(
    (a, byKey) => a + Object.values(byKey).reduce((b, list) => b + list.length, 0),
    0,
  )

  console.log(`  ✓ Validation passed`)
  console.log(`    Roadmaps:        ${plan.roadmaps.length}`)
  console.log(`    Unique topics:   ${plan.topics.size} (Scenario B dedup)`)
  console.log(`    BranchTopic links: ${totalBranchLinks}`)
  console.log(`    Sections:        ${totalSections}`)
  console.log(`    Questions:       ${totalQuestions}`)
  console.log(`    Options:         ${totalOptions}`)
  console.log(`    Resource topics: ${resourceTopics} (${resourceEntries} curated entries)`)

  if (DRY_RUN) {
    console.log('\n(dry-run: skipping DB)')
    return
  }

  if (!process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set. Add it to .env or export it.')
    process.exit(1)
  }

  console.log('\n=== Phase 2: connect + apply ===')
  await mongoose.connect(process.env.MONGO_URI)
  console.log('  ✓ Connected to MongoDB')

  if (RESET) {
    console.log('  --reset: dropping content collections...')
    console.warn(
      '  WARN: --reset invalidates any existing QuizAttemptAnswer.questionId / selectedOptionId',
    )
    console.warn('         references. User progress collections are NOT touched.')
    await Promise.all([
      MasterRoadmap.deleteMany({}),
      MasterBranch.deleteMany({}),
      MasterTopic.deleteMany({}),
      BranchTopic.deleteMany({}),
      Section.deleteMany({}),
      Quiz.deleteMany({}),
      Question.deleteMany({}),
      QuestionOption.deleteMany({}),
    ])
    console.log('  ✓ Reset complete')
  }

  const stats = await applyPlan(plan)

  console.log('\n=== Phase 3: apply stats ===')
  console.log(`  Topics upserted:        ${stats.topicsUpserted}`)
  console.log(
    `  BranchTopic links:      ${stats.branchLinksUpserted} upserted, ${stats.branchLinksPruned} pruned`,
  )
  console.log(
    `  Sections:               ${stats.sectionsUpserted} upserted, ${stats.sectionsPruned} pruned`,
  )
  console.log(
    `  Quizzes:                ${stats.quizzesUpserted} upserted, ${stats.quizzesPruned} pruned`,
  )
  console.log(
    `  Questions:              ${stats.questionsUpserted} upserted, ${stats.questionsPruned} pruned`,
  )
  console.log(
    `  QuestionOptions:        ${stats.optionsUpserted} upserted, ${stats.optionsPruned} pruned`,
  )
  console.log(`  Topics with prereqs:    ${stats.topicsWithPrereqs} (drives roadmap-viz edges)`)
  console.log(`  Sections w/ resources:  ${stats.sectionsWithResources}`)

  console.log('\n=== Phase 4: final DB counts ===')
  const [
    dbRoadmaps,
    dbBranches,
    dbTopics,
    dbBranchLinks,
    dbSections,
    dbQuizzes,
    dbQuestions,
    dbOptions,
  ] = await Promise.all([
    MasterRoadmap.countDocuments(),
    MasterBranch.countDocuments(),
    MasterTopic.countDocuments(),
    BranchTopic.countDocuments(),
    Section.countDocuments(),
    Quiz.countDocuments(),
    Question.countDocuments(),
    QuestionOption.countDocuments(),
  ])
  console.log(`  MasterRoadmaps:   ${dbRoadmaps}`)
  console.log(`  MasterBranches:   ${dbBranches}`)
  console.log(`  MasterTopics:     ${dbTopics}    (Scenario B: unique slugs)`)
  console.log(`  BranchTopics:     ${dbBranchLinks}`)
  console.log(`  Sections:         ${dbSections}`)
  console.log(`  Quizzes:          ${dbQuizzes}`)
  console.log(`  Questions:        ${dbQuestions}`)
  console.log(`  QuestionOptions:  ${dbOptions}`)

  await mongoose.disconnect()
  console.log('\n✓ Disconnected')
}

main().catch((err: unknown) => {
  console.error('FATAL:', err)
  process.exit(1)
})
