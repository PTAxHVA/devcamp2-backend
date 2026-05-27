import { SubmitAttemptSchema } from '../schemas/quiz.schema.js'
import { QuestionOption } from '../models/question-option.model.js'
import { Question } from '../models/question.model.js'
import { UserSectionProgress } from '../models/user-section-progress.model.js'
import { QuizAttempt } from '../models/quiz-attempt.model.js'
import { QuizAttemptAnswer } from '../models/quiz-attempt-answer.model.js'
import { Quiz } from '../models/quiz.model.js'
import { UserRoadmap } from '../models/user-roadmap.model.js'
import { UserTopic } from '../models/user-topic.model.js'
import { TopicStatus } from '../types/enums.js'
import { ApiError } from '../utils/api-error.js'

export const submitAndGradeQuiz = async (
  answers: SubmitAttemptSchema['answers'],
  userId: string,
) => {
  if (!answers || answers.length === 0) {
    throw new ApiError(400, 'Answers array cannot be empty', 'EMPTY_ANSWERS')
  }

  const getQuizIdFromQuestion = await Question.findOne({ _id: answers[0]?.questionId })
    .select('quizId')
    .lean()
  if (!getQuizIdFromQuestion) {
    throw new ApiError(404, 'Question not found', 'QUESTION_NOT_FOUND')
  }

  const quiz = await Quiz.findById(getQuizIdFromQuestion.quizId).lean()
  if (!quiz) {
    throw new ApiError(404, 'Quiz not found', 'QUIZ_NOT_FOUND')
  }

  const quizAttempt = await QuizAttempt.findOne({ userId, quizId: quiz._id, submittedAt: null })
  if (!quizAttempt) {
    throw new ApiError(400, 'Active quiz attempt not found', 'QUIZ_ATTEMPT_NOT_FOUND')
  }

  let totalCorrect = 0
  const attemptAnswers = []

  for (const answer of answers) {
    if (answer.selectedOptionId) {
      const correctOption = await QuestionOption.findOne({
        questionId: answer.questionId,
        isCorrect: true,
      }).lean()

      const isCorrectMCQ = String(answer.selectedOptionId) === String(correctOption?._id)
      if (isCorrectMCQ) {
        totalCorrect++
      }

      attemptAnswers.push({
        quizAttemptId: quizAttempt._id,
        questionId: answer.questionId,
        selectedOptionId: answer.selectedOptionId,
        userInput: null,
        isCorrect: isCorrectMCQ,
      })
    } else if (answer.userInput !== undefined && answer.userInput !== null) {
      const norm = (s: string) => s.trim().toLowerCase()

      const question = await Question.findById(answer.questionId).lean()
      const accepted = [question?.correctAnswer, ...(question?.acceptableAnswers ?? [])]
        .map(String)
        .map((ans) => norm(ans))

      const isAccepted = accepted.includes(norm(answer.userInput ?? ''))
      if (isAccepted) {
        totalCorrect++
      }

      attemptAnswers.push({
        quizAttemptId: quizAttempt._id,
        questionId: answer.questionId,
        selectedOptionId: null,
        userInput: answer.userInput,
        isCorrect: isAccepted,
      })
    }
  }

  if (attemptAnswers.length > 0) {
    await QuizAttemptAnswer.insertMany(attemptAnswers)
  }

  const totalQuestions = await Question.countDocuments({ quizId: quiz._id })
  const score = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0
  const isPassed = score >= quiz.minPassScore

  quizAttempt.score = score
  quizAttempt.isPassed = isPassed
  quizAttempt.submittedAt = new Date()

  if (!isPassed) {
    quizAttempt.cooldownUntil = new Date(Date.now() + 2 * 60 * 60 * 1000)
  } else {
    quizAttempt.cooldownUntil = null
  }
  await quizAttempt.save()

  const userRoadmap = await UserRoadmap.findOne({ userId, isActive: true }).select('_id').lean()
  if (!userRoadmap) {
    throw new ApiError(404, 'User roadmap not found', 'USER_ROADMAP_NOT_FOUND')
  }
  const userTopic = await UserTopic.findOne({
    userRoadmapId: userRoadmap._id,
    status: TopicStatus.IN_PROGRESS,
  })
    .select('_id topicId')
    .lean()
  if (!userTopic) {
    throw new ApiError(404, 'User topic not found', 'USER_TOPIC_NOT_FOUND')
  }

  const currentProgress = await UserSectionProgress.findOne({
    userTopicId: userTopic._id,
    sectionId: quiz.sectionId,
  })
  if (currentProgress) {
    if (isPassed && !currentProgress.isCompleted) {
      currentProgress.isCompleted = true
      currentProgress.completedAt = new Date()
      await currentProgress.save()
    }
  } else {
    await UserSectionProgress.create({
      userTopicId: userTopic._id,
      sectionId: quiz.sectionId,
      isCompleted: isPassed,
      startedAt: quizAttempt.startedAt,
      completedAt: isPassed ? new Date() : null,
    })
  }
}
