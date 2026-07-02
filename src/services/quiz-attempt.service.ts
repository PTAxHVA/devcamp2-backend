import { ApiError } from '../utils/api-error.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { IQuizAttemptAnswer, QuizAttemptAnswer } from '../models/quiz-attempt-answer.model.js'
import { Question } from '../models/question.model.js'
import { QuestionOption } from '../models/question-option.model.js'

// Helper to reduce code duplication
const findOwnedAttempt = async (attemptId: string, userId: string, requireSubmitted: boolean) => {
  const attempt = await QuizAttempt.findOne({
    _id: attemptId,
    userId,
    submittedAt: requireSubmitted ? { $ne: null } : null,
  }).lean()

  if (!attempt) throw new ApiError(404, 'Attempt not found', 'ATTEMPT_NOT_FOUND')

  return attempt
}

const loadQuestionsWithOptions = async (
  quizId: string,
  attemptAnswers: IQuizAttemptAnswer[],
  isResultMode: boolean,
) => {
  let questionsQuery = Question.find({ quizId }).sort({ orderIndex: 1, _id: 1 })
  if (!isResultMode) {
    questionsQuery = questionsQuery.select({
      _id: 1,
      type: 1,
      content: 1,
      orderIndex: 1,
      createdAt: 1,
      updatedAt: 1,
    })
  }
  const questions = await questionsQuery.lean()

  let optionsQuery = QuestionOption.find({
    questionId: { $in: questions.map((q) => q._id) },
  }).sort({ orderIndex: 1 })
  if (!isResultMode) {
    optionsQuery = optionsQuery.select({ isCorrect: 0 })
  }
  const questionOptions = await optionsQuery.lean()
  const questionsWithOptions = questions.map((question) => ({
    ...question,
    options: questionOptions.filter(
      (option) => option.questionId.toString() === question._id.toString(),
    ),
    // userAnswer is currently empty. MVP dictates that resuming does not fetch previous answers.
    userAnswer: attemptAnswers.find(
      (answer) => answer.questionId.toString() === question._id.toString(),
    ),
  }))

  return questionsWithOptions
}

export const getAttempt = async (attemptId: string, userId: string) => {
  const attempt = await findOwnedAttempt(attemptId, userId, false)

  // Gets attempt for user to resume the quiz, not for results
  const attemptAnswers = await QuizAttemptAnswer.find({ quizAttemptId: attemptId })
    .select('_id quizAttemptId questionId selectedOptionId userInput createdAt updatedAt')
    .lean()

  const questionsWithOptions = await loadQuestionsWithOptions(
    attempt.quizId.toString(),
    attemptAnswers,
    false,
  )
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
  const attempt = await findOwnedAttempt(attemptId, userId, true)

  const attemptAnswers = await QuizAttemptAnswer.find({ quizAttemptId: attemptId }).lean()

  const questionsWithOptions = await loadQuestionsWithOptions(
    attempt.quizId.toString(),
    attemptAnswers,
    true,
  )

  const resultDetails = {
    quizAttempt: {
      attemptId: attempt._id,
      quizId: attempt.quizId,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      score: attempt.score,
      isPassed: attempt.isPassed,
      cooldownUntil: attempt.cooldownUntil,
    },
    questions: questionsWithOptions,
  }

  return resultDetails
}
