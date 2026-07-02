import { ApiError } from '../utils/api-error.js'
import { isValidObjectId, startSession } from 'mongoose'
import { Quiz } from '../models/quiz.model.js'
import { Question } from '../models/question.model.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { QuestionOption } from '../models/question-option.model.js'
import { Section } from '../models/section.model.js'
import { verifyTopicEnrollment } from './section.service.js'
import { QuizAttemptAnswer } from '../models/quiz-attempt-answer.model.js'

export const getQuizBySectionId = async (sectionId: string, userId: string) => {
  if (!isValidObjectId(sectionId))
    throw new ApiError(400, 'Invalid section id', 'INVALID_SECTION_ID')

  const section = await Section.findById(sectionId).lean()
  if (!section) throw new ApiError(404, 'Section not found', 'SECTION_NOT_FOUND')
  await verifyTopicEnrollment(section.topicId.toString(), userId)

  const quiz = await Quiz.findOne({ sectionId }).lean()
  if (!quiz) throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND')
  const questionCount = await Question.countDocuments({ quizId: quiz._id })
  const lastAttempt = await QuizAttempt.findOne({ quizId: quiz._id, userId })
    .sort({ createdAt: -1 })
    .lean()
  const quizDetails = {
    quizId: quiz._id,
    minPassScore: quiz.minPassScore,
    questionCount,
    lastAttemptId: lastAttempt?._id ?? null,
    lastAttemptPassed: lastAttempt?.isPassed ?? false,
  }
  return quizDetails
}

export const startQuizAttempt = async (quizId: string, userId: string) => {
  const session = await startSession()
  session.startTransaction()
  try {
    if (!isValidObjectId(quizId)) throw new ApiError(400, 'Invalid quiz id', 'INVALID_QUIZ_ID')
    const quiz = await Quiz.findOne({ _id: quizId }).lean()
    if (!quiz) throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND')

    const section = await Section.findById(quiz.sectionId).lean()
    if (!section) throw new ApiError(404, 'Section not found', 'SECTION_NOT_FOUND')
    await verifyTopicEnrollment(section.topicId.toString(), userId)

    const questions = await Question.find({ quizId: quiz._id })
      .select({
        _id: 1,
        type: 1,
        content: 1,
        orderIndex: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ orderIndex: 1, _id: 1 })
      .lean()

    if (questions.length === 0)
      throw new ApiError(404, 'Questions not found', 'QUESTIONS_NOT_FOUND')

    const attemptExists = await QuizAttempt.findOne({ quizId, userId }).session(session)
    let quizAttempt

    if (attemptExists) {
      if (!attemptExists.submittedAt) {
        // Surface the existing attempt id so the client can resume it (GET /attempts/:id).
        throw new ApiError(409, 'Quiz already started', 'QUIZ_ALREADY_STARTED', {
          attemptId: attemptExists._id,
        })
      }
      if (attemptExists.cooldownUntil && attemptExists.cooldownUntil > new Date()) {
        // Surface the attempt id so the client can show its result/cooldown screen.
        throw new ApiError(409, 'Cooldown period is still active', 'COOLDOWN_ACTIVE', {
          attemptId: attemptExists._id,
        })
      }
      attemptExists.startedAt = new Date()
      attemptExists.submittedAt = null
      attemptExists.score = null
      attemptExists.isPassed = false
      attemptExists.cooldownUntil = null

      await QuizAttemptAnswer.deleteMany({ quizAttemptId: attemptExists._id }).session(session)
      await attemptExists.save({ session })
      quizAttempt = attemptExists
    } else {
      quizAttempt = new QuizAttempt({
        userId,
        quizId,
        startedAt: new Date(),
      })
      try {
        await quizAttempt.save({ session })
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 11000
        ) {
          throw new ApiError(409, 'Quiz already started', 'QUIZ_ALREADY_STARTED')
        }
        throw error
      }
    }

    const questionOptions = await QuestionOption.find({
      questionId: { $in: questions.map((question) => question._id) },
    })
      .sort({ orderIndex: 1 })
      .select({ questionId: 1, content: 1, orderIndex: 1 })
      .lean()

    const questionsWithOptions = questions.map((question) => ({
      ...question,
      options: questionOptions.filter(
        (option) => option.questionId.toString() === question._id.toString(),
      ),
    }))

    const quizDetails = {
      quizAttempt: {
        attemptId: quizAttempt._id,
        quizId: quizAttempt.quizId,
        startedAt: quizAttempt.startedAt,
      },
      questions: questionsWithOptions,
    }
    await session.commitTransaction()
    session.endSession()
    return quizDetails
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    throw error
  }
}
