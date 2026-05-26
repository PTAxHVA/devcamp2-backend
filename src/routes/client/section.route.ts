import { Router } from 'express'
import * as sectionController from '../../controllers/section.controller.js'

const router = Router()

router.get('/:sectionId', sectionController.getSectionById)

export default router
