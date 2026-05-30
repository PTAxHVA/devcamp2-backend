import { Request, Response, NextFunction } from 'express'
import { generateSuggestedRoadmap } from '../services/ai.service.js'
import { ok } from '../utils/api-response.js'

export const suggestRoadmap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { masterRoadmapId, branchSelections } = req.body as {
      masterRoadmapId: string
      branchSelections: string[]
    }
    const userId = req.user?.id as string

    const result = await generateSuggestedRoadmap(masterRoadmapId, branchSelections, userId)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
