import { NextFunction, Request, Response } from 'express'
import { ok } from '../utils/api-response.js'
import * as QuizService from '../services/quiz.service.js'
import * as QuizGradingService from '../services/quiz-grading.service.js'
import { SubmitAttemptSchema, objectIdSchema } from '../schemas/quiz.schema.js'

export const getQuizBySectionId = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sectionId = req.params.sectionId as string
    const userId = req.user?.id as string

    const result = await QuizService.getQuizBySectionId(sectionId, userId)

    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const startQuizAttempt = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const quizId = req.params.id as string
    const userId = req.user?.id as string

    const result = await QuizService.startQuizAttempt(quizId, userId)

    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const submitAndGradeQuiz = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    const attemptId = objectIdSchema.parse(req.params.id)
    const answers = req.body.answers as SubmitAttemptSchema['answers']

    const result = await QuizGradingService.submitAndGradeQuiz(attemptId, answers, userId)

    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
