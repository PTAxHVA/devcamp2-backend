/* eslint-disable no-console -- CLI script: console output is the user-facing UI */
/**
 * VORA master content seeder.
 *
 * Reads `seed-data/frontend-content.csv` and `seed-data/backend-content.csv`
 * and upserts them into MongoDB per the v3 LOCKED schema (Scenario B).
 *
 * Topics are deduplicated by slug across roadmaps — shared topics
 * (Git, JavaScript Fundamentals, TypeScript, etc.) live as ONE MasterTopic
 * doc but link to multiple branches via BranchTopic junction.
 *
 * Usage:
 *   yarn seed              # idempotent upsert (safe to re-run)
 *   yarn seed:dry          # parse + report, no DB writes
 *   yarn seed:reset        # drop content collections first, then seed
 *
 * Requires MONGO_URI in .env (uses BE's existing dotenv setup).
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

// ------------------------------------------------------------ CLI flags
const args = new Set(process.argv.slice(2))
const RESET = args.has('--reset')
const DRY_RUN = args.has('--dry-run')

// ------------------------------------------------------------ Seed jobs
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

// ------------------------------------------------------------ Types

interface CsvRow {
  Topic_ID: string
  Topic_Name: string
  Section_ID: string
  Section_Name: string
  Summary: string
  Notes: string
  // Q1..Q5 fields are read dynamically via keys
  [key: string]: string
}

interface ParsedQuestion {
  type: QuestionType
  content: string
  correctAnswer: string
  acceptableAnswers: string[]
  options: { content: string; isCorrect: boolean }[] // empty for FILL_IN_BLANK
}

interface SeedStats {
  topics: number
  sections: number
  quizzes: number
  questions: number
  questionOptions: number
}

// ------------------------------------------------------------ Helpers

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function parseCsv(path: string): Promise<CsvRow[]> {
  const buf = await readFile(path)
  return parse(buf, { columns: true, skip_empty_lines: true, trim: true }) as CsvRow[]
}

function groupByTopic(rows: CsvRow[]): Map<string, CsvRow[]> {
  const out = new Map<string, CsvRow[]>()
  for (const row of rows) {
    const key = row.Topic_Name
    if (!out.has(key)) out.set(key, [])
    out.get(key)!.push(row)
  }
  return out
}

function buildQuestion(row: CsvRow, qNum: number): ParsedQuestion | null {
  const type = row[`Q${qNum}_Type`]
  const text = row[`Q${qNum}_Text`]
  const correct = row[`Q${qNum}_Correct`]
  const alternatesStr = row[`Q${qNum}_Alternates`] || ''
  if (!type || !text) return null

  const acceptable = alternatesStr
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)

  if (type === 'mc') {
    const options: ParsedQuestion['options'] = []
    for (const letter of ['A', 'B', 'C', 'D']) {
      const optContent = row[`Q${qNum}_${letter}`]
      if (optContent) {
        options.push({ content: optContent, isCorrect: letter === correct })
      }
    }
    return {
      type: QuestionType.MULTIPLE_CHOICE,
      content: text,
      correctAnswer: correct,
      acceptableAnswers: [],
      options,
    }
  }

  if (type === 'typed') {
    return {
      type: QuestionType.FILL_IN_BLANK,
      content: text,
      correctAnswer: correct,
      acceptableAnswers: acceptable,
      options: [],
    }
  }

  console.warn(`  ! Unknown Qn_Type at section ${row.Section_ID} Q${qNum}: "${type}"`)
  return null
}

// ------------------------------------------------------------ Per-roadmap seeder

async function seedOne(job: SeedJob): Promise<SeedStats> {
  console.log(`\n=== Seeding ${job.roleName} from ${job.csvPath} ===`)
  const rows = await parseCsv(job.csvPath)
  console.log(`  Parsed ${rows.length} CSV rows`)

  const stats: SeedStats = { topics: 0, sections: 0, quizzes: 0, questions: 0, questionOptions: 0 }

  // Upsert roadmap + branch (idempotent)
  let branchId: mongoose.Types.ObjectId

  if (DRY_RUN) {
    branchId = new mongoose.Types.ObjectId()
  } else {
    const roadmap = await MasterRoadmap.findOneAndUpdate(
      { roleName: job.roleName },
      {
        $setOnInsert: {
          roleName: job.roleName,
          description: `${job.roleName} learning path`,
          isPublished: true,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
    const roadmapId = roadmap._id as mongoose.Types.ObjectId

    const branch = await MasterBranch.findOneAndUpdate(
      { roadmapId, name: job.branchName },
      {
        $setOnInsert: {
          roadmapId,
          name: job.branchName,
          description: '',
          orderIndex: 0,
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
    branchId = branch._id as mongoose.Types.ObjectId
  }
  console.log(`  Roadmap "${job.roleName}"  |  Branch "${job.branchName}"`)

  const byTopic = groupByTopic(rows)

  for (const [topicName, topicRows] of byTopic) {
    const topicSlug = slugify(topicName)
    const topicOrderIndex = Number.parseInt(topicRows[0].Topic_ID, 10) || 0
    stats.topics++

    let topicId: mongoose.Types.ObjectId
    if (DRY_RUN) {
      topicId = new mongoose.Types.ObjectId()
    } else {
      // MasterTopic is a LIBRARY entity — upsert by slug (Scenario B dedup).
      const topic = await MasterTopic.findOneAndUpdate(
        { slug: topicSlug },
        {
          $setOnInsert: {
            name: topicName,
            slug: topicSlug,
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
      topicId = topic._id as mongoose.Types.ObjectId

      // Link topic to this branch via junction (order depends on branch context).
      await BranchTopic.findOneAndUpdate(
        { branchId, topicId },
        { $set: { orderIndex: topicOrderIndex } },
        { upsert: true, returnDocument: 'after' },
      )
    }

    for (const row of topicRows) {
      const sectionSlug = slugify(row.Section_Name)
      const sectionOrderIndex =
        Number.parseInt((row.Section_ID || '').split('.')[1] || '0', 10) || 0
      stats.sections++

      let sectionId: mongoose.Types.ObjectId
      if (DRY_RUN) {
        sectionId = new mongoose.Types.ObjectId()
      } else {
        const section = await Section.findOneAndUpdate(
          { topicId, slug: sectionSlug },
          {
            $set: {
              name: row.Section_Name,
              contentOverview: row.Summary || '',
              orderIndex: sectionOrderIndex,
              isPublished: true,
            },
            $setOnInsert: { topicId, slug: sectionSlug, resourceList: [] },
          },
          { upsert: true, returnDocument: 'after' },
        )
        sectionId = section._id as mongoose.Types.ObjectId
      }

      // Upsert quiz, then REWRITE all its Questions + QuestionOptions
      // (idempotent: drop existing then re-insert).
      let quizId: mongoose.Types.ObjectId
      if (DRY_RUN) {
        quizId = new mongoose.Types.ObjectId()
      } else {
        const quiz = await Quiz.findOneAndUpdate(
          { sectionId },
          { $set: { sectionId, minPassScore: 80 } },
          { upsert: true, returnDocument: 'after' },
        )
        quizId = quiz._id as mongoose.Types.ObjectId

        // Wipe and re-insert questions + options for this quiz.
        const oldQuestions = await Question.find({ quizId }, { _id: 1 })
        const oldQuestionIds = oldQuestions.map((q) => q._id)
        if (oldQuestionIds.length > 0) {
          await QuestionOption.deleteMany({ questionId: { $in: oldQuestionIds } })
          await Question.deleteMany({ quizId })
        }
      }
      stats.quizzes++

      for (let q = 1; q <= 5; q++) {
        const parsed = buildQuestion(row, q)
        if (!parsed) continue
        stats.questions++

        if (!DRY_RUN) {
          const created = await Question.create({
            quizId,
            type: parsed.type,
            content: parsed.content,
            correctAnswer: parsed.correctAnswer,
            acceptableAnswers: parsed.acceptableAnswers,
            orderIndex: q,
          })

          if (parsed.options.length > 0) {
            const optDocs = parsed.options.map((opt, idx) => ({
              questionId: created._id,
              content: opt.content,
              isCorrect: opt.isCorrect,
              orderIndex: idx,
            }))
            await QuestionOption.insertMany(optDocs)
            stats.questionOptions += optDocs.length
          }
        } else {
          stats.questionOptions += parsed.options.length
        }
      }
    }
  }

  console.log(
    `  ✓ Topics: ${stats.topics}  Sections: ${stats.sections}  Quizzes: ${stats.quizzes}  Questions: ${stats.questions}  Options: ${stats.questionOptions}`,
  )
  return stats
}

// ------------------------------------------------------------ Main

async function main() {
  if (!DRY_RUN && !process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set. Add it to .env or export it.')
    process.exit(1)
  }

  if (!DRY_RUN) {
    await mongoose.connect(process.env.MONGO_URI as string)
    console.log('✓ Connected to MongoDB')

    if (RESET) {
      console.log('--reset: dropping content collections...')
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
  } else {
    console.log('--dry-run: parsing only, NO DB writes\n')
  }

  const totals: SeedStats = {
    topics: 0,
    sections: 0,
    quizzes: 0,
    questions: 0,
    questionOptions: 0,
  }
  for (const job of SEED_JOBS) {
    const s = await seedOne(job)
    for (const k of Object.keys(totals) as (keyof SeedStats)[]) {
      totals[k] += s[k]
    }
  }

  console.log('\n=== GRAND TOTAL across both roadmaps ===')
  console.log(`  Topic rows processed:  ${totals.topics}`)
  console.log(`  Section rows:          ${totals.sections}`)
  console.log(`  Quizzes:               ${totals.quizzes}`)
  console.log(`  Questions:             ${totals.questions}`)
  console.log(`  QuestionOptions (MC):  ${totals.questionOptions}`)

  if (!DRY_RUN) {
    const distinctTopics = await MasterTopic.countDocuments()
    const distinctBranchLinks = await BranchTopic.countDocuments()
    console.log(
      `\n  In DB: ${distinctTopics} distinct MasterTopics, ${distinctBranchLinks} BranchTopic links`,
    )
    console.log(
      `  (Scenario B dedup: shared topics like Git, JS Fundamentals, TypeScript appear once across both roadmaps.)`,
    )
    await mongoose.disconnect()
    console.log('✓ Disconnected')
  }
}

main().catch((err: unknown) => {
  console.error('FATAL:', err)
  process.exit(1)
})
