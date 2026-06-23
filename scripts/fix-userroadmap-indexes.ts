/* eslint-disable no-console -- CLI migration: console output is the user-facing UI */
/**
 * One-off migration (T01 / QA H1): drop the STALE index on the `userroadmaps`
 * collection that blocks F18 multi-roadmap enroll, then rebuild the correct
 * model-declared indexes.
 *
 * Background: an earlier schema declared a UNIQUE index on { userId, isActive }
 * (and/or a non-partial unique on { userId, roadmapId }). The current model
 * (src/models/user-roadmap.model.ts) declares:
 *   - { userId: 1, isActive: 1 }                         (non-unique, lookup)
 *   - { userId: 1, roadmapId: 1 } partial UNIQUE where isActive:true
 * The model is already correct; only the LIVE cluster still carries the stale
 * index. Mongoose does not drop pre-existing indexes on its own, so we do it here.
 *
 * Surgical by design: we drop ONLY indexes that match the known-stale shapes by
 * name, then call createIndexes() (NOT syncIndexes(), which could drop unrelated
 * indexes). Idempotent — safe to re-run; a no-op once the cluster is clean.
 *
 * Usage:  yarn fix-indexes        (requires MONGO_URI in .env)
 * ALWAYS run `yarn backup` first (see ops-runbook.md).
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { UserRoadmap } from '../src/models/user-roadmap.model.js'

interface IndexInfo {
  name?: string
  key: Record<string, number>
  unique?: boolean
  partialFilterExpression?: Record<string, unknown>
}

function describe(idx: IndexInfo): string {
  return `${idx.name} keys=${JSON.stringify(idx.key)} unique=${!!idx.unique} partial=${
    idx.partialFilterExpression ? JSON.stringify(idx.partialFilterExpression) : 'no'
  }`
}

/** A stale index = a UNIQUE index on one of the old shapes WITHOUT the current partial filter. */
function isStale(idx: IndexInfo): boolean {
  if (idx.name === '_id_' || !idx.unique) return false
  const keys = Object.keys(idx.key)
  const isUserIsActive = keys.length === 2 && idx.key.userId === 1 && idx.key.isActive === 1
  const isUserRoadmapNonPartial =
    keys.length === 2 &&
    idx.key.userId === 1 &&
    idx.key.roadmapId === 1 &&
    !idx.partialFilterExpression
  return isUserIsActive || isUserRoadmapNonPartial
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set. Add it to .env or export it.')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGO_URI)
  console.log('✓ Connected to MongoDB')

  const coll = UserRoadmap.collection
  const before = (await coll.indexes()) as IndexInfo[]
  console.log('\nCurrent indexes on userroadmaps:')
  before.forEach((idx) => console.log(`  - ${describe(idx)}`))

  const stale = before.filter(isStale)
  if (stale.length === 0) {
    console.log('\n✓ No stale index found — nothing to drop.')
  } else {
    for (const idx of stale) {
      if (!idx.name) continue
      console.log(`\nDropping stale index: ${describe(idx)}`)
      await coll.dropIndex(idx.name)
      console.log(`  ✓ dropped ${idx.name}`)
    }
  }

  console.log('\nRebuilding model-declared indexes (createIndexes)...')
  await UserRoadmap.createIndexes()

  const after = (await coll.indexes()) as IndexInfo[]
  console.log('\nFinal indexes on userroadmaps:')
  after.forEach((idx) => console.log(`  - ${describe(idx)}`))

  await mongoose.disconnect()
  console.log('\n✓ Done. Verify: enroll two DIFFERENT roadmaps succeeds; same role twice → 409.')
}

main().catch((err: unknown) => {
  console.error('FATAL:', err)
  process.exit(1)
})
