/* eslint-disable no-console */
import 'dotenv/config'
import mongoose from 'mongoose'
import { User } from '../src/models/user.model.js'
import { UserProfile } from '../src/models/user-profile.model.js'
import { UserRoadmap } from '../src/models/user-roadmap.model.js'
import { UserTopic } from '../src/models/user-topic.model.js'
import { UserSectionProgress } from '../src/models/user-section-progress.model.js'
import { QuizAttempt } from '../src/models/quiz-attempt.model.js'
import { QuizAttemptAnswer } from '../src/models/quiz-attempt-answer.model.js'
import { OnboardingQuestionnaire } from '../src/models/onboarding-questionnaire.model.js'
import { RoadmapEditLog } from '../src/models/roadmap-edit-log.model.js'
import { PasswordResetToken } from '../src/models/password-reset-token.model.js'

const DRY_RUN = process.argv.includes('--dry-run')
const FORCE = process.argv.includes('--force')

async function main() {
  if (process.env.NODE_ENV === 'production' && !DRY_RUN && !FORCE) {
    console.error(
      'FATAL: Running in production without --dry-run or --force. Aborting to prevent accidental deletion.',
    )
    process.exit(1)
  }
  if (!process.env.MONGO_URI) {
    console.error('FATAL: MONGO_URI is not set. Add it to .env or export it.')
    process.exit(1)
  }

  console.log(`=== Clean QA Users Script ${DRY_RUN ? '(DRY RUN)' : ''} ===`)
  await mongoose.connect(process.env.MONGO_URI)
  console.log(`  ✓ Connected to MongoDB (DB: ${mongoose.connection.db?.databaseName})`)

  const totalUsers = await User.countDocuments()
  console.log(`  Total users in DB: ${totalUsers}`)

  const qaEmailRegex = /^qa\.vora\..*@example\.com$/i

  const qaUsers = await User.find({ email: qaEmailRegex }).select('_id email').lean()

  if (qaUsers.length === 0) {
    console.log('\nNo QA users found matching mock patterns')
    await mongoose.disconnect()
    return
  }

  console.log(`\nFound ${qaUsers.length} QA users:`)
  qaUsers.forEach((u: any) => console.log(`  - ${u.email} (${u._id})`))

  const userIds = qaUsers.map((u: any) => u._id)

  // Find related data
  const userRoadmaps = await UserRoadmap.find({ userId: { $in: userIds } })
    .select('_id')
    .lean()
  const userRoadmapIds = userRoadmaps.map((ur: any) => ur._id)

  const userTopics = await UserTopic.find({ userRoadmapId: { $in: userRoadmapIds } })
    .select('_id')
    .lean()
  const userTopicIds = userTopics.map((ut: any) => ut._id)

  const quizAttempts = await QuizAttempt.find({ userId: { $in: userIds } })
    .select('_id')
    .lean()
  const quizAttemptIds = quizAttempts.map((qa: any) => qa._id)

  console.log('\n--- Data to delete ---')
  console.log(`  Users: ${userIds.length}`)
  console.log(`  UserProfiles: (up to ${userIds.length})`)
  console.log(`  UserRoadmaps: ${userRoadmapIds.length}`)
  console.log(`  UserTopics: ${userTopicIds.length}`)
  console.log(`  UserSectionProgress (estimated based on topics): (dependent on topics)`)
  console.log(`  QuizAttempts: ${quizAttemptIds.length}`)
  console.log(`  QuizAttemptAnswers (estimated based on attempts): (dependent on attempts)`)
  console.log(`  OnboardingQuestionnaires: (up to ${userIds.length})`)
  console.log(`  RoadmapEditLogs: (up to ${userRoadmapIds.length} + orphan logs)`)
  console.log(`  PasswordResetTokens: (up to ${userIds.length})`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would delete the above data. Re-run without --dry-run to execute.')
    await mongoose.disconnect()
    return
  }

  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const userResult = await User.deleteMany({ _id: { $in: userIds } }).session(session)
    const profileResult = await UserProfile.deleteMany({ userId: { $in: userIds } }).session(
      session,
    )
    const roadmapResult = await UserRoadmap.deleteMany({ userId: { $in: userIds } }).session(
      session,
    )
    const topicResult = await UserTopic.deleteMany({
      userRoadmapId: { $in: userRoadmapIds },
    }).session(session)
    const progressResult = await UserSectionProgress.deleteMany({
      userTopicId: { $in: userTopicIds },
    }).session(session)
    const attemptResult = await QuizAttempt.deleteMany({ userId: { $in: userIds } }).session(
      session,
    )
    const attemptAnswerResult = await QuizAttemptAnswer.deleteMany({
      quizAttemptId: { $in: quizAttemptIds },
    }).session(session)
    const onboardingResult = await OnboardingQuestionnaire.deleteMany({
      userId: { $in: userIds },
    }).session(session)
    const editLogResult = await RoadmapEditLog.deleteMany({
      $or: [{ userRoadmapId: { $in: userRoadmapIds } }, { userId: { $in: userIds } }],
    }).session(session)
    const passwordResetResult = await PasswordResetToken.deleteMany({
      userId: { $in: userIds },
    }).session(session)

    await session.commitTransaction()

    console.log('\n--- Deletion Results ---')
    console.log(`  Users deleted: ${userResult.deletedCount}`)
    console.log(`  UserProfiles deleted: ${profileResult.deletedCount}`)
    console.log(`  UserRoadmaps deleted: ${roadmapResult.deletedCount}`)
    console.log(`  UserTopics deleted: ${topicResult.deletedCount}`)
    console.log(`  UserSectionProgress deleted: ${progressResult.deletedCount}`)
    console.log(`  QuizAttempts deleted: ${attemptResult.deletedCount}`)
    console.log(`  QuizAttemptAnswers deleted: ${attemptAnswerResult.deletedCount}`)
    console.log(`  OnboardingQuestionnaires deleted: ${onboardingResult.deletedCount}`)
    console.log(`  RoadmapEditLogs deleted: ${editLogResult.deletedCount}`)
    console.log(`  PasswordResetTokens deleted: ${passwordResetResult.deletedCount}`)

    console.log('\n✓ Cleanup complete')
  } catch (err) {
    await session.abortTransaction()
    console.error('\nFATAL: Transaction aborted due to error:')
    console.error(err)
    process.exitCode = 1
  } finally {
    session.endSession()
    await mongoose.disconnect()
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
