/* eslint-disable no-console -- CLI tool: console output is the user-facing UI */
/**
 * DEMO helper: mark a demo account's active roadmap(s) 100% complete so the roadmap-complete
 * certificate renders and its verified-skill badges are earned (for a demo video). Optional
 * polish for a "show" account: `--streak-days=N` fabricates a nice N-day daily streak (tile +
 * activity charts) and `--quiz-scores` fills the Quiz Average / passport mastery.
 * NOT for real learners — a recording/QA convenience only.
 *
 * Additive + idempotent (see src/services/complete-roadmap-for-demo.service.ts): inserts/upgrades
 * UserSectionProgress; with `--streak-days` it also spreads completedAt across the last N UTC+7
 * days and sets the stored streak counters; with `--quiz-scores` it writes one passed QuizAttempt
 * per completed section's quiz. Nothing else is touched (attempt history/quizAvg untouched unless
 * `--quiz-scores` is given).
 *
 * SAFE BY DEFAULT: runs as a DRY RUN unless you pass BOTH `--apply` and a matching
 * `--confirm-email=<email>` (double-entry so you can't fabricate progress on the wrong
 * account). To --apply, the target must ALSO be listed in the DEMO_ACCOUNT_EMAILS env
 * (comma-separated allowlist) — a hard backstop against ever touching a real learner.
 * Writing while NODE_ENV=production additionally requires `--force`.
 *
 * Usage:
 *   # 1) preview a full "show" account (no writes, no allowlist needed):
 *   yarn complete-demo --email=demo@vora.dev --streak-days=60 --quiz-scores
 *   # 2) apply (double-confirm the exact email + allowlist it):
 *   DEMO_ACCOUNT_EMAILS=demo@vora.dev yarn complete-demo --email=demo@vora.dev --streak-days=60 --quiz-scores --apply --confirm-email=demo@vora.dev
 *
 * ALWAYS run `yarn backup` first when pointing at prod. Use a throwaway demo account —
 * this inflates progress to 100% and must never touch a real learner's account.
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import {
  completeRoadmapForDemo,
  type CompleteDemoStats,
} from '../src/services/complete-roadmap-for-demo.service.js'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const QUIZ_SCORES = process.argv.includes('--quiz-scores')
const DRY_RUN = !APPLY

// The "View full" activity chart shows at most 90 days, so a longer streak can't fully render.
const MAX_STREAK_DAYS = 90

const getArg = (name: string): string | undefined => {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : undefined
}

const norm = (v: string): string => v.trim().toLowerCase()

/** Human-readable reason an account is not (or would not be) 100%. */
const incompleteReason = (stats: CompleteDemoStats): string => {
  if (stats.roadmapsProcessed === 0)
    return 'the account has no active roadmap — enroll one on the site first'
  if (stats.topicsProcessed === 0) return 'the active roadmap has no topics'
  if (stats.topicsWithoutSections > 0)
    return `${stats.topicsWithoutSections} topic(s) have no published sections and cannot be completed`
  return 'unknown reason'
}

async function main() {
  const email = getArg('email')
  if (!email) {
    console.error('FATAL: pass the target account with --email=<address>.')
    console.error('  preview: yarn complete-demo --email=demo@vora.dev')
    process.exit(1)
  }

  const streakArg = getArg('streak-days')
  const streakDays = streakArg === undefined ? undefined : Number(streakArg)
  if (
    streakArg !== undefined &&
    (!Number.isInteger(streakDays) ||
      (streakDays as number) < 1 ||
      (streakDays as number) > MAX_STREAK_DAYS)
  ) {
    console.error(
      `FATAL: --streak-days must be an integer 1–${MAX_STREAK_DAYS} (the activity chart shows at most ${MAX_STREAK_DAYS} days). Try --streak-days=60.`,
    )
    process.exit(1)
  }
  // Suggested rerun commands below must carry the same shaping flags.
  const flagSuffix = `${streakDays ? ` --streak-days=${streakDays}` : ''}${QUIZ_SCORES ? ' --quiz-scores' : ''}`

  if (!process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set. Add it to .env or export it.')
    process.exit(1)
  }
  if (APPLY) {
    const confirm = getArg('confirm-email')
    if (!confirm || norm(confirm) !== norm(email)) {
      console.error('FATAL: to APPLY, pass --confirm-email=<email> matching --email exactly.')
      console.error(
        `  yarn complete-demo --email=${email}${flagSuffix} --apply --confirm-email=${email}`,
      )
      process.exit(1)
    }
    // Hard allowlist: --apply may only touch an account explicitly named in
    // DEMO_ACCOUNT_EMAILS (comma-separated). This is the backstop that stops a
    // fat-fingered real learner's email — even with a matching --confirm-email — from
    // having its progress/certificates fabricated. Dry-run stays unrestricted (read-only).
    const allowlist = (process.env.DEMO_ACCOUNT_EMAILS ?? '').split(',').map(norm).filter(Boolean)
    if (!allowlist.includes(norm(email))) {
      console.error(`FATAL: "${email}" is not in DEMO_ACCOUNT_EMAILS — refusing to --apply.`)
      console.error('  This tool must only ever touch a throwaway demo account. Allowlist it,')
      console.error('  then re-run:')
      console.error(
        `    DEMO_ACCOUNT_EMAILS=${email} yarn complete-demo --email=${email}${flagSuffix} --apply --confirm-email=${email}`,
      )
      process.exit(1)
    }
    if (process.env.NODE_ENV === 'production' && !FORCE) {
      console.error('FATAL: refusing to write with NODE_ENV=production without --force.')
      process.exit(1)
    }
  }

  console.log(`=== Complete roadmap for demo account ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'} ===`)
  console.log(`  Target email: ${email}`)
  if (streakDays) console.log(`  Streak days:  ${streakDays}`)
  if (QUIZ_SCORES) console.log('  Quiz scores:  on')
  await mongoose.connect(process.env.MONGO_URI)
  console.log(`  ✓ Connected to MongoDB (DB: ${mongoose.connection.db?.databaseName})`)

  const stats = await completeRoadmapForDemo({
    email,
    dryRun: DRY_RUN,
    streakDays,
    quizScores: QUIZ_SCORES,
  })

  if (!stats.userFound) {
    console.error(`\n✗ No user found with email "${stats.email}". Nothing changed.`)
    await mongoose.disconnect()
    process.exit(1)
  }

  console.log('\n--- Results ---')
  console.log(`  Active roadmaps:        ${stats.roadmapsProcessed}`)
  console.log(`  Topics processed:       ${stats.topicsProcessed}`)
  console.log(`  Sections targeted:      ${stats.sectionsTargeted}`)
  console.log(`  Rows ${DRY_RUN ? 'to insert ' : 'inserted  '}:        ${stats.rowsInserted}`)
  console.log(`  Rows ${DRY_RUN ? 'to upgrade' : 'upgraded  '}:        ${stats.rowsUpgraded}`)
  console.log(`  Rows already complete:  ${stats.rowsAlreadyComplete}`)
  if (stats.rowsRestamped > 0) {
    console.log(`  Rows re-dated (streak): ${stats.rowsRestamped}`)
  }
  if (stats.streakDaysApplied > 0) {
    console.log(`  Streak spread across:   ${stats.streakDaysApplied} day(s) ending today`)
    console.log(
      `  Streak counter ${DRY_RUN ? 'to set  ' : stats.profileUpdated ? 'set     ' : 'NOT set '}: ${stats.streakDaysApplied}-day`,
    )
  }
  if (QUIZ_SCORES) {
    console.log(
      `  Quiz attempts ${DRY_RUN ? 'to write' : 'written '}:  ${stats.quizAttemptsWritten}`,
    )
  }
  if (stats.topicsWithoutSections > 0) {
    console.log(
      `  ⚠ Topics with NO published sections (can't complete): ${stats.topicsWithoutSections}`,
    )
  }
  if (!stats.userActive) {
    console.log(
      '  ⚠ This account is DEACTIVATED — reactivate it (or use a different one) for the public Passport to render.',
    )
  }

  if (DRY_RUN) {
    if (stats.fullyComplete) {
      console.log(
        `\n[DRY RUN] Would bring this account to 100%. Apply with:\n  DEMO_ACCOUNT_EMAILS=${email} yarn complete-demo --email=${email}${flagSuffix} --apply --confirm-email=${email}`,
      )
    } else {
      console.log(
        `\n[DRY RUN] Would NOT reach 100% — ${incompleteReason(stats)}. No writes performed.`,
      )
    }
  } else if (stats.fullyComplete) {
    console.log(
      '\n✓ Done. The account now reads 100% — the roadmap-complete certificate renders and its verified-skill badges are earned.\n  To show the public Passport, turn ON public sharing in Settings (the /p/<token> page only renders for a public passport).',
    )
  } else {
    console.log(`\n⚠ Applied, but the account is NOT 100% — ${incompleteReason(stats)}.`)
    process.exitCode = 1
  }

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
