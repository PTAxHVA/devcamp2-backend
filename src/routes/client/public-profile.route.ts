import { Router } from 'express'
import * as publicProfileController from '../../controllers/public-profile.controller.js'

const router = Router()

// Public Verified Skill Passport (no auth) — read-only, reachable only via an
// opt-in share token, and covered by the app-wide general rate limiter like the
// master-roadmap catalog. Unknown/private tokens both answer 404.
router.get('/:shareToken', publicProfileController.getPublicPassport)

export default router
