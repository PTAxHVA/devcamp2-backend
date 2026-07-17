import { Types } from 'mongoose'
import { User } from '../models/user.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { Section } from '../models/section.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { UserProfile } from '../models/user-profile.model.js'
import { Quiz } from '../models/quiz.model.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { getDayNumberUTC7 } from '../utils/streak.util.js'

export interface CompleteDemoStats {
  email: string
  userFound: boolean
  /** false when the account is deactivated — the public Passport won't render for it. */
  userActive: boolean
  roadmapsProcessed: number
  topicsProcessed: number
  topicsWithoutSections: number
  sectionsTargeted: number
  rowsInserted: number
  rowsUpgraded: number
  rowsAlreadyComplete: number
  /**
   * Rows that were ALREADY completed but had completedAt re-stamped by the streak spread
   * (only in streak mode; 0 otherwise). Streak mode is intentionally NOT a no-op so a
   * re-run with a different streakDays re-spreads the dates.
   */
  rowsRestamped: number
  /** Trailing UTC+7 days the completions were spread across (0 = streakDays not used). */
  streakDaysApplied: number
  /** true when the stored UserProfile streak counters were written (apply + streak mode). */
  profileUpdated: boolean
  /** Passed quiz attempts written to fill Quiz Average / passport mastery (0 = none). */
  quizAttemptsWritten: number
  /**
   * true only when EVERY active roadmap is now 100% (has topics, and every topic has
   * published sections that are all completed). false when there is no active roadmap,
   * a roadmap has no topics, or a topic has no published sections — the caller must not
   * claim "100%" otherwise (the FE certificate gate requires a non-empty, all-completed
   * topic list).
   */
  fullyComplete: boolean
}

export interface CompleteDemoOptions {
  email: string
  dryRun: boolean
  /** Completion timestamp stamped on rows in NON-streak mode. Defaults to now. */
  completedAt?: Date
  /**
   * When >0, spread completions across the last N UTC+7 days ending today AND set the stored
   * streak counters, so BOTH the streak tile and the activity charts read an N-day streak.
   * Capped to the number of unique sections available.
   */
  streakDays?: number
  /**
   * When true, also write one passed QuizAttempt per completed section's quiz, so the
   * dashboard "Quiz Average" tile and passport mastery read real scores instead of "--".
   */
  quizScores?: boolean
}

const emptyStats = (email: string): CompleteDemoStats => ({
  email,
  userFound: false,
  userActive: false,
  roadmapsProcessed: 0,
  topicsProcessed: 0,
  topicsWithoutSections: 0,
  sectionsTargeted: 0,
  rowsInserted: 0,
  rowsUpgraded: 0,
  rowsAlreadyComplete: 0,
  rowsRestamped: 0,
  streakDaysApplied: 0,
  profileUpdated: false,
  quizAttemptsWritten: 0,
  fullyComplete: false,
})

const DAY_MS = 86_400_000
/**
 * UTC instant at ~noon Asia/Saigon for a UTC+7 day number — a safe bucket center that can't
 * drift into an adjacent calendar day. getDayNumberUTC7(d) = floor((d + 7h) / day), so the
 * Saigon midnight of a bucket is bucket*day - 7h UTC; +12h lands at noon = bucket*day + 5h.
 */
const noonSaigonForDayNum = (dayNum: number): Date => new Date(dayNum * DAY_MS + 5 * 3_600_000)

/**
 * Realistic-but-strong demo scores (all >= the 80 pass mark), cycled per section so the Quiz
 * Average / passport mastery read like a real high performer instead of a flat 100.
 */
const DEMO_SCORES = [85, 90, 95, 100]

type SectionPair = { userTopicId: Types.ObjectId; sectionId: Types.ObjectId }

/**
 * DEMO helper (not for real learners): mark EVERY published section of EVERY topic in a demo
 * account's active roadmap(s) as completed so the account reads 100% — the roadmap-complete
 * certificate + celebration render (topic status = "all published sections completed",
 * derived only from UserSectionProgress) and the Verified Skill Passport fills with badges.
 *
 * Optional demo polish (additive; only the extra collections named are touched):
 *  - streakDays: spread completions across the last N UTC+7 days ending today AND set the
 *    stored UserProfile streak counters — the streak tile reads those, the activity charts
 *    read the spread completedAt values. Bounded by the count of unique sections. Streak mode
 *    re-stamps completedAt on a re-run (so a different N re-spreads); plain mode stays a no-op.
 *  - quizScores: write one passed QuizAttempt per completed section's quiz so the dashboard
 *    "Quiz Average" tile and passport mastery read real scores instead of "--".
 *
 * Never fabricates quiz attempts unless quizScores is set, and never overwrites an
 * already-completed row in plain mode. A topic with no published sections can never be
 * "completed" and is reported via topicsWithoutSections rather than silently skipped.
 */
export const completeRoadmapForDemo = async ({
  email,
  dryRun,
  completedAt,
  streakDays,
  quizScores,
}: CompleteDemoOptions): Promise<CompleteDemoStats> => {
  const normalizedEmail = email.trim().toLowerCase()
  const stats = emptyStats(normalizedEmail)
  const now = completedAt ?? new Date()

  const user = await User.findOne({ email: normalizedEmail }).select('_id isActive').lean()
  if (!user) return stats
  stats.userFound = true
  stats.userActive = user.isActive !== false

  const roadmaps = await UserRoadmap.find({ userId: user._id, isActive: true }).select('_id').lean()
  stats.roadmapsProcessed = roadmaps.length
  if (roadmaps.length === 0) return stats

  const userTopics = await UserTopic.find({
    userRoadmapId: { $in: roadmaps.map((r) => r._id) },
  })
    .select('_id topicId userRoadmapId')
    .lean()
  stats.topicsProcessed = userTopics.length
  if (userTopics.length === 0) return stats

  // Published sections per master topic — same basis the FE uses to mark a topic
  // "completed" (dashboard/passport/roadmap-graph: all published sections done).
  const masterTopicIds = [...new Set(userTopics.map((t) => t.topicId.toString()))]
  const sections = await Section.find({ topicId: { $in: masterTopicIds }, isPublished: true })
    .select('_id topicId')
    .lean()
  const sectionsByTopic = new Map<string, string[]>()
  for (const s of sections) {
    const key = s.topicId.toString()
    const arr = sectionsByTopic.get(key) ?? []
    arr.push(s._id.toString())
    sectionsByTopic.set(key, arr)
  }

  // Flatten to (userTopic, section) targets. A topic with no published sections can never
  // read "completed" → surface it via topicsWithoutSections, don't hide it.
  const targets: SectionPair[] = []
  for (const ut of userTopics) {
    const sectionKeys = sectionsByTopic.get(ut.topicId.toString()) ?? []
    if (sectionKeys.length === 0) {
      stats.topicsWithoutSections += 1
      continue
    }
    for (const sectionKey of sectionKeys) {
      targets.push({ userTopicId: ut._id, sectionId: new Types.ObjectId(sectionKey) })
    }
  }
  stats.sectionsTargeted = targets.length

  // Group by UNIQUE sectionId: the activity charts dedupe by sectionId keeping the earliest
  // completedAt, so every roadmap-specific row of a shared section must get the SAME date,
  // and streak length is bounded by the count of unique sections (not raw rows).
  const pairsBySection = new Map<string, SectionPair[]>()
  for (const t of targets) {
    const k = t.sectionId.toString()
    const arr = pairsBySection.get(k) ?? []
    arr.push(t)
    pairsBySection.set(k, arr)
  }
  const uniqueSectionKeys = [...pairsBySection.keys()]

  const wantStreak = Number.isInteger(streakDays) && (streakDays as number) >= 1
  const spread = wantStreak && uniqueSectionKeys.length > 0
  const effectiveDays = spread ? Math.min(streakDays as number, uniqueSectionKeys.length) : 0
  const todayNum = getDayNumberUTC7(now)

  const wantQuiz = quizScores === true
  const quizIdBySection = new Map<string, Types.ObjectId>()
  if (wantQuiz && uniqueSectionKeys.length > 0) {
    const quizzes = await Quiz.find({
      sectionId: { $in: uniqueSectionKeys.map((k) => new Types.ObjectId(k)) },
    })
      .select('_id sectionId')
      .lean()
    for (const q of quizzes) quizIdBySection.set(q.sectionId.toString(), q._id)
  }

  // One bulk read of existing progress rows for these userTopics (stats + skip-if-complete).
  const existingRows = await UserSectionProgress.find({
    userTopicId: { $in: userTopics.map((t) => t._id) },
  })
    .select('userTopicId sectionId isCompleted')
    .lean()
  const stateByPair = new Map<string, boolean>()
  for (const p of existingRows) {
    stateByPair.set(`${p.userTopicId.toString()}:${p.sectionId.toString()}`, p.isCompleted)
  }

  for (let i = 0; i < uniqueSectionKeys.length; i++) {
    const secKey = uniqueSectionKeys[i]!
    // Older sections on older days; offset 0 (today) uses the real `now` instant so
    // completedAt is never in the future; past days use noon Saigon (safe bucket center).
    const dayOffset = spread ? effectiveDays - 1 - (i % effectiveDays) : 0
    const rowDate = !spread
      ? now
      : dayOffset === 0
        ? now
        : noonSaigonForDayNum(todayNum - dayOffset)

    for (const { userTopicId, sectionId } of pairsBySection.get(secKey)!) {
      const state = stateByPair.get(`${userTopicId.toString()}:${sectionId.toString()}`)
      if (spread) {
        // Streak mode re-stamps completedAt on EVERY target (even already-complete) so a
        // re-run with a different streakDays re-spreads. Benign for a demo tool.
        if (state === undefined) stats.rowsInserted += 1
        else if (state === false) stats.rowsUpgraded += 1
        else stats.rowsRestamped += 1
        if (!dryRun) {
          await UserSectionProgress.updateOne(
            { userTopicId, sectionId },
            // Streak mode fabricates the row's whole timeline, so stamp startedAt too:
            // an EXISTING row would otherwise keep a newer startedAt and end up with a
            // completedAt that predates it.
            { $set: { isCompleted: true, completedAt: rowDate, startedAt: rowDate } },
            { upsert: true },
          )
        }
      } else if (state === undefined) {
        stats.rowsInserted += 1
        if (!dryRun) {
          await UserSectionProgress.updateOne(
            { userTopicId, sectionId },
            { $set: { isCompleted: true, completedAt: now }, $setOnInsert: { startedAt: now } },
            { upsert: true },
          )
        }
      } else if (state === false) {
        stats.rowsUpgraded += 1
        if (!dryRun) {
          await UserSectionProgress.updateOne(
            { userTopicId, sectionId, isCompleted: false },
            { $set: { isCompleted: true, completedAt: now } },
          )
        }
      } else {
        stats.rowsAlreadyComplete += 1
      }
    }

    // Fill Quiz Average / passport mastery: one passed attempt per completed section's quiz.
    const quizId = quizIdBySection.get(secKey)
    if (wantQuiz && quizId) {
      stats.quizAttemptsWritten += 1
      if (!dryRun) {
        const score = DEMO_SCORES[i % DEMO_SCORES.length]!
        await QuizAttempt.updateOne(
          { userId: user._id, quizId },
          // Same reasoning as the progress row: stamp the whole attempt timeline so
          // submittedAt can never predate startedAt on a re-run or over a real attempt.
          {
            $set: {
              score,
              isPassed: true,
              submittedAt: rowDate,
              startedAt: rowDate,
              cooldownUntil: null,
            },
          },
          { upsert: true },
        )
      }
    }
  }

  // Fully complete only when EVERY active roadmap has topics AND no topic lacked published
  // sections. Checked per-roadmap, not on the aggregate topic count: a second *empty* active
  // roadmap must not read as 100% off the back of a completed one.
  const topicCountByRoadmap = new Map<string, number>()
  for (const ut of userTopics) {
    const key = ut.userRoadmapId.toString()
    topicCountByRoadmap.set(key, (topicCountByRoadmap.get(key) ?? 0) + 1)
  }
  const everyRoadmapHasTopics = roadmaps.every(
    (r) => (topicCountByRoadmap.get(r._id.toString()) ?? 0) > 0,
  )
  stats.fullyComplete = everyRoadmapHasTopics && stats.topicsWithoutSections === 0

  // Streak counters: the tile reads UserProfile.streak (only zeroed on read when
  // lastActivityDate is >1 UTC+7 day stale); it is otherwise advanced only on a quiz pass.
  // Set it directly for the demo. $max never lowers an existing longestStreak; upsert so an
  // account that somehow lacks a profile still gets one.
  if (spread) {
    stats.streakDaysApplied = effectiveDays
    if (!dryRun) {
      const res = await UserProfile.updateOne(
        { userId: user._id },
        {
          $set: { streak: effectiveDays, lastActivityDate: now },
          $max: { longestStreak: effectiveDays },
        },
        { upsert: true },
      )
      stats.profileUpdated = (res.matchedCount ?? 0) > 0 || (res.upsertedCount ?? 0) > 0
    }
  }

  return stats
}
