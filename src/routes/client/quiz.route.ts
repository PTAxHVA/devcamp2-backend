import { Router } from 'express'
import { authenticate } from '../../middlewares/auth.middleware.js'
import * as QuizController from '../../controllers/quiz.controller.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { submitAttemptSchema } from '../../schemas/quiz.schema.js'

const router = Router()

router.post('/:id/start', authenticate, QuizController.startQuizAttempt)
router.post(
  '/attempts/:id/submit',
  authenticate,
  validate(submitAttemptSchema),
  QuizController.submitAndGradeQuiz,
)

export default router
