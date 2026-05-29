import { ApiError } from '../utils/api-error.js'
import { isValidObjectId } from 'mongoose'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { QuizAttemptAnswer } from '../models/quiz-attempt-answer.model.js'

export const getAttempt = async (attemptId: string) => {
  if (!isValidObjectId(attemptId))
    throw new ApiError(400, 'Invalid attempt id', 'INVALID_OBJECT_ID')

  const attempt = await QuizAttempt.findById({ _id: attemptId }, 'userId').lean()

  if (!attempt) throw new ApiError(404, 'Attempt not found', 'ATTEMPT_NOT_FOUND')

  // Gets attempt for user to resume the quiz, not for results
  const attemptAnswers = await QuizAttemptAnswer.find({ quizAttemptId: attemptId })
    .select('_id quizAttemptId questionId selectedOptionId userInput createdAt updatedAt')
    .lean()

  return {
    attempt,
    attemptAnswers,
  }
}

export const getAttemptResult = async (attemptId: string, userId: string) => {
  if (!isValidObjectId(attemptId))
    throw new ApiError(400, 'Invalid attempt id', 'INVALID_OBJECT_ID')

  const attempt = await QuizAttempt.findOne({ _id: attemptId, userId }).lean()

  if (!attempt) throw new ApiError(404, 'Attempt not found', 'ATTEMPT_NOT_FOUND')

  // Gets attempt result for user to review their answers
  const attemptAnswers = await QuizAttemptAnswer.find({ quizAttemptId: attemptId }).lean()

  return {
    attempt,
    attemptAnswers,
  }
}
