import { Router } from 'express'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { submitAttemptSchema } from '../../schemas/quiz.schema.js'
import * as quizAttemptController from '../../controllers/quiz.controller.js'

const router = Router()

router.get('/:id', authenticate, quizAttemptController.getAttempt)
router.get('/:id/result', authenticate, quizAttemptController.getAttemptResult)
router.post(
  '/:id/submit',
  authenticate,
  validate(submitAttemptSchema),
  quizAttemptController.submitAndGradeQuiz,
)

export default router
