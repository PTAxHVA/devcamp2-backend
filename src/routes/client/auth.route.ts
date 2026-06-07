import { Router } from 'express'
import * as authController from '../../controllers/auth.controller.js'
import * as passwordResetController from '../../controllers/password-reset.controller.js'
import { validate } from '../../middlewares/validate.middleware.js'
import { loginSchema, signupSchema } from '../../schemas/auth.schema.js'
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '../../schemas/password-reset.schema.js'
import { authRateLimiter } from '../../middlewares/rate-limit.middleware.js'

const router = Router()

router.post('/login', authRateLimiter, validate(loginSchema), authController.login)
router.post('/signup', authRateLimiter, validate(signupSchema), authController.signup)

router.post(
  '/request-password-reset',
  authRateLimiter,
  validate(requestPasswordResetSchema),
  passwordResetController.requestPasswordReset,
)
router.post(
  '/reset-password',
  authRateLimiter,
  validate(resetPasswordSchema),
  passwordResetController.resetPassword,
)

export default router
