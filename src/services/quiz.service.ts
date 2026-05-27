import { ApiError } from '../utils/api-error.js'
import { isValidObjectId } from 'mongoose'
import { Quiz } from '../models/quiz.model.js'
import { Question } from '../models/question.model.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { QuestionOption } from '../models/question-option.model.js'

export const getQuizBySectionId = async (sectionId: string) => {
  if (!isValidObjectId(sectionId))
    throw new ApiError(400, 'Invalid section id', 'INVALID_SECTION_ID')
  const quiz = await Quiz.findOne({ sectionId }).lean()
  if (!quiz) throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND')
  const questionCount = await Question.countDocuments({ quizId: quiz._id })
  const quizDetails = {
    quizId: quiz._id,
    minPassScore: quiz.minPassScore,
    questionCount,
  }
  return quizDetails
}

export const startQuizAttempt = async (quizId: string, userId: string) => {
  if (!isValidObjectId(quizId)) throw new ApiError(400, 'Invalid quiz id', 'INVALID_QUIZ_ID')
  const quiz = await Quiz.findOne({ _id: quizId }).lean()
  if (!quiz) throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND')

  const questions = await Question.find({ quizId: quiz._id })
    .select({
      _id: 1,
      type: 1,
      content: 1,
      orderIndex: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .sort({ _id: 1, orderIndex: 1 })
    .lean()

  if (questions.length === 0) throw new ApiError(404, 'Questions not found', 'QUESTIONS_NOT_FOUND')

  const attemptExists = await QuizAttempt.findOne({ quizId, userId }).lean()
  if (attemptExists && !attemptExists.submittedAt)
    throw new ApiError(400, 'Quiz already started', 'QUIZ_ALREADY_STARTED')

  const quizAttempt = new QuizAttempt({
    userId,
    quizId,
    startedAt: new Date(),
  })

  await quizAttempt.save()

  const questionOptions = await QuestionOption.find({
    questionId: { $in: questions.map((question) => question._id) },
  })
    .sort({ orderIndex: 1 })
    .select({ content: 1, orderIndex: 1 })
    .lean()

  const quizDetails = {
    quizAttempt,
    questions,
    options: questionOptions,
  }

  return quizDetails
}
