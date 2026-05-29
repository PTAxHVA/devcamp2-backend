import { ApiError } from '../utils/api-error.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { QuizAttemptAnswer } from '../models/quiz-attempt-answer.model.js'
import { Question } from '../models/question.model.js'
import { QuestionOption } from '../models/question-option.model.js'

export const getAttempt = async (attemptId: string, userId: string) => {
  const attempt = await QuizAttempt.findOne({ _id: attemptId, userId, submittedAt: null }).lean()

  if (!attempt) throw new ApiError(404, 'Attempt not found', 'ATTEMPT_NOT_FOUND')

  // Gets attempt for user to resume the quiz, not for results
  const attemptAnswers = await QuizAttemptAnswer.find({ quizAttemptId: attemptId })
    .select('_id quizAttemptId questionId selectedOptionId userInput createdAt updatedAt')
    .lean()

  const questions = await Question.find({ quizId: attempt.quizId })
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

  const questionOptions = await QuestionOption.find({
    questionId: { $in: questions.map((q) => q._id) },
  })
    .select({ isCorrect: 0 })
    .sort({ orderIndex: 1 })
    .lean()
  const questionsWithOptions = questions.map((question) => ({
    ...question,
    options: questionOptions.filter(
      (option) => option.questionId.toString() === question._id.toString(),
    ),
    userAnswer: attemptAnswers.find(
      (answer) => answer.questionId.toString() === question._id.toString(),
    ),
  }))

  const quizDetails = {
    quizAttempt: {
      attemptId: attempt._id,
      quizId: attempt.quizId,
      startedAt: attempt.startedAt,
    },
    questions: questionsWithOptions,
  }

  return quizDetails
}

export const getAttemptResult = async (attemptId: string, userId: string) => {
  const attempt = await QuizAttempt.findOne({
    _id: attemptId,
    userId,
    submittedAt: { $ne: null },
  }).lean()

  if (!attempt) throw new ApiError(404, 'Attempt not found', 'ATTEMPT_NOT_FOUND')

  const attemptAnswers = await QuizAttemptAnswer.find({ quizAttemptId: attemptId }).lean()

  const questions = await Question.find({ quizId: attempt.quizId })
    .sort({ orderIndex: 1, _id: 1 })
    .lean()

  const questionOptions = await QuestionOption.find({
    questionId: { $in: questions.map((q) => q._id) },
  })
    .sort({ orderIndex: 1 })
    .lean()

  const questionsWithOptions = questions.map((question) => ({
    ...question,
    options: questionOptions.filter(
      (option) => option.questionId.toString() === question._id.toString(),
    ),
    userAnswer: attemptAnswers.find(
      (answer) => answer.questionId.toString() === question._id.toString(),
    ),
  }))

  const resultDetails = {
    quizAttempt: {
      attemptId: attempt._id,
      quizId: attempt.quizId,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      score: attempt.score,
      isPassed: attempt.isPassed,
    },
    questions: questionsWithOptions,
  }

  return resultDetails
}
