import { Request, Response, NextFunction } from 'express'
import * as topicService from '../services/topic.service.js'
import { ok } from '../utils/api-response.js'

export const getTopicById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const topicId = req.params.topicId as string
    const userId = req.user?.id as string
    const result = await topicService.getTopicById(topicId, userId)
    res.json(ok(result))
  } catch (err) {
    next(err)
  }
}
