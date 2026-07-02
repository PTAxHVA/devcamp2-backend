import { SubmitAttemptSchema } from '../schemas/quiz.schema.js'
import { QuestionOption } from '../models/question-option.model.js'
import { Question } from '../models/question.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { QuizAttemptAnswer } from '../models/quiz-attempt-answer.model.js'
import { Quiz } from '../models/quiz.model.js'
import { Section } from '../models/section.model.js'
import { ApiError } from '../utils/api-error.js'
import { verifyTopicEnrollment } from './section.service.js'
import { startSession } from 'mongoose'
import { UserProfile } from '../models/user-profile.model.js'

// Cooldown after a failed section quiz before the learner may retry.
// Deliberately short for DemoDay so the fail → retry flow is demonstrable;
// revisit (e.g. move to config) for production.
const FAILED_QUIZ_COOLDOWN_MS = 1 * 60 * 1000

// Two concurrent submits of the same attempt can trip MongoDB's write conflict
// (a transient transaction error) or the unique (quizAttemptId, questionId)
// answer index. Translate both into a clean 409 instead of leaking a raw 500.
const isWriteConflictError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const err = error as { code?: number; hasErrorLabel?: (label: string) => boolean }
  if (err.code === 112 || err.code === 11000) return true
  return typeof err.hasErrorLabel === 'function' && err.hasErrorLabel('TransientTransactionError')
}

export const submitAndGradeQuiz = async (
  attemptId: string,
  answers: SubmitAttemptSchema['answers'],
  userId: string,
) => {
  if (!answers || answers.length === 0) {
    throw new ApiError(400, 'Answers array cannot be empty', 'EMPTY_ANSWERS')
  }
  const session = await startSession()
  session.startTransaction()
  try {
    const quizAttempt = await QuizAttempt.findOne({
      _id: attemptId,
      userId,
      submittedAt: null,
    }).session(session)
    if (!quizAttempt) {
      throw new ApiError(400, 'Active quiz attempt not found', 'QUIZ_ATTEMPT_NOT_FOUND')
    }

    const quiz = await Quiz.findById(quizAttempt.quizId).lean()
    if (!quiz) {
      throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND')
    }

    const questions = await Question.find({ quizId: quiz._id }).lean()
    if (questions.length === 0) {
      throw new ApiError(404, 'Questions not found', 'QUESTIONS_NOT_FOUND')
    }

    let totalCorrect = 0
    const attemptAnswers = []

    for (const question of questions) {
      const answer = answers.find((a) => String(a.questionId) === String(question._id))

      let isCorrect = false
      let selectedOptionId = null
      let userInput = null

      if (answer) {
        if (question.type === 'MULTIPLE_CHOICE') {
          if (answer.selectedOptionId) {
            selectedOptionId = answer.selectedOptionId
            const correctOption = await QuestionOption.findOne({
              questionId: question._id,
              isCorrect: true,
            }).lean()

            if (correctOption && String(selectedOptionId) === String(correctOption._id)) {
              isCorrect = true
            }
          }
        } else {
          // FILL_IN_BLANK
          if (answer.userInput !== undefined && answer.userInput !== null) {
            userInput = answer.userInput
            const norm = (s: string) => s.trim()

            const accepted = [question.correctAnswer, ...(question.acceptableAnswers ?? [])]
              .map(String)
              .map((ans) => norm(ans))

            if (accepted.includes(norm(userInput))) {
              isCorrect = true
            }
          }
        }

        if (isCorrect) {
          totalCorrect++
        }

        attemptAnswers.push({
          quizAttemptId: quizAttempt._id,
          questionId: question._id,
          selectedOptionId,
          userInput,
          isCorrect,
        })
      }
    }

    if (attemptAnswers.length > 0) {
      await QuizAttemptAnswer.insertMany(attemptAnswers, { session })
    }

    const totalQuestions = questions.length
    const score = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0
    const isPassed = score >= quiz.minPassScore

    quizAttempt.score = score
    quizAttempt.isPassed = isPassed
    quizAttempt.submittedAt = new Date()

    if (!isPassed) {
      quizAttempt.cooldownUntil = new Date(Date.now() + FAILED_QUIZ_COOLDOWN_MS)
    } else {
      quizAttempt.cooldownUntil = null
    }
    await quizAttempt.save({ session })

    const section = await Section.findOne({ _id: quiz.sectionId }).select('topicId').lean()
    if (!section) {
      throw new ApiError(404, 'Section not found', 'SECTION_NOT_FOUND')
    }

    const userTopic = await verifyTopicEnrollment(section.topicId.toString(), userId)

    const currentProgress = await UserSectionProgress.findOne({
      userTopicId: userTopic._id,
      sectionId: quiz.sectionId,
    }).session(session)
    if (currentProgress) {
      if (isPassed && !currentProgress.isCompleted) {
        currentProgress.isCompleted = true
        currentProgress.completedAt = new Date()
        await currentProgress.save({ session })
      }
    } else {
      await UserSectionProgress.create(
        [
          {
            userTopicId: userTopic._id,
            sectionId: quiz.sectionId,
            isCompleted: isPassed,
            startedAt: quizAttempt.startedAt,
            completedAt: isPassed ? new Date() : null,
          },
        ],
        { session },
      )
    }

    if (isPassed) {
      let userProfile = await UserProfile.findOne({ userId }).session(session)
      if (!userProfile) {
        userProfile = new UserProfile({ userId, streak: 0, longestStreak: 0 })
      }

      const now = new Date()
      const lastActivity = userProfile.lastActivityDate

      if (!lastActivity) {
        userProfile.streak = 1
      } else {
        const getDayNumberUTC7 = (d: Date) =>
          Math.floor((d.getTime() + 7 * 60 * 60 * 1000) / 86400000)

        const diffDays = getDayNumberUTC7(now) - getDayNumberUTC7(lastActivity)

        if (diffDays === 1) {
          userProfile.streak += 1
        } else if (diffDays > 1) {
          userProfile.streak = 1
        }
      }

      userProfile.lastActivityDate = now
      userProfile.longestStreak = Math.max(userProfile.longestStreak, userProfile.streak)
      await userProfile.save({ session })
    }

    await session.commitTransaction()
    return {
      quizAttemptId: quizAttempt._id,
      score,
      isPassed,
      cooldownUntil: quizAttempt.cooldownUntil,
    }
  } catch (error) {
    await session.abortTransaction().catch(() => {})
    if (isWriteConflictError(error)) {
      throw new ApiError(
        409,
        'This quiz is already being submitted. Please try again.',
        'QUIZ_SUBMIT_CONFLICT',
      )
    }
    throw error
  } finally {
    await session.endSession()
  }
}
