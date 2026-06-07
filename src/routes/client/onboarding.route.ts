import { Router } from 'express'
import * as onboardingController from '../../controllers/onboarding.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { submitOnboardingSchema } from '../../schemas/onboarding.schema.js'

const router = Router()

router.post(
  '/questionnaire',
  authenticate,
  validate(submitOnboardingSchema),
  onboardingController.submitOnboarding,
)
router.get('/status', authenticate, onboardingController.getOnboardingStatus)

export default router
