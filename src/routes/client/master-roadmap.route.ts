import { Router } from 'express'
import * as masterRoadmapController from '../../controllers/master-roadmap.controller.js'

const router = Router()

// Public catalog (no auth) — curated, non-sensitive data. Still behind the app-wide
// general rate limiter. `/demo` powers the no-login landing preview (mentor #1).
// NOTE: `/demo` must be registered BEFORE `/:id`, otherwise it matches `:id = "demo"`.
router.get('/', masterRoadmapController.listMasterRoadmaps)
router.get('/demo', masterRoadmapController.getDemoRoadmap)
router.get('/:id', masterRoadmapController.getMasterRoadmapById)
router.get('/:id/branches', masterRoadmapController.getMasterRoadmapBranches)

export default router
