import { Router } from 'express'
import * as sampleController from '../../controllers/sample.controller.js'

const router = Router()

router.get('/', sampleController.list)

export default router
