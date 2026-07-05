/* eslint-disable no-console -- CLI migration: console output is the user-facing UI */
/**
 * One-time migration: retroactively sync completed shared-topic section progress
 * across a learner's active roadmaps for passes that predate the write-time mirror
 * (BE #50). See src/services/backfill-shared-topic-progress.service.ts for the rules.
 *
 * Safe by design: additive only (inserts missing rows / upgrades not-completed rows),
 * copies each source row's original completedAt (never now), idempotent, touches only
 * UserSectionProgress. Re-running is a no-op.
 *
 * Usage:
 *   yarn backfill:shared-progress:dry     # report what WOULD change, no writes
 *   yarn backfill:shared-progress         # apply
 * ALWAYS run `yarn backup` first (see ops-runbook.md).
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { backfillAllSharedTopicProgress } from '../src/services/backfill-shared-topic-progress.service.js'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set. Add it to .env or export it.')
    process.exit(1)
  }

  console.log(`=== Backfill shared-topic progress ${DRY_RUN ? '(DRY RUN)' : ''} ===`)
  await mongoose.connect(process.env.MONGO_URI)
  console.log(`  ✓ Connected to MongoDB (DB: ${mongoose.connection.db?.databaseName})`)

  const stats = await backfillAllSharedTopicProgress({ dryRun: DRY_RUN })

  console.log('\n--- Results ---')
  console.log(`  Users scanned:            ${stats.usersScanned}`)
  console.log(`  Users with shared topics: ${stats.usersWithSharedTopics}`)
  console.log(`  Shared-topic groups:      ${stats.sharedTopicGroups}`)
  console.log(`  Rows ${DRY_RUN ? 'to insert' : 'inserted '}:        ${stats.rowsInserted}`)
  console.log(`  Rows ${DRY_RUN ? 'to update' : 'updated  '}:        ${stats.rowsUpdated}`)
  console.log(`  Rows already in sync:     ${stats.rowsAlreadyInSync}`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No writes performed. Re-run without --dry-run to apply.')
  } else {
    console.log('\n✓ Backfill complete')
  }

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
