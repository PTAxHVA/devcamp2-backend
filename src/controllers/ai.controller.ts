import { Request, Response, NextFunction } from 'express'
import * as aiService from '../services/ai.service.js'
import { ok } from '../utils/api-response.js'

export const suggestRoadmap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { masterRoadmapId, branchSelections } = req.body as {
      masterRoadmapId: string
      branchSelections: string[]
    }
    const userId = req.user?.id as string

    const result = await aiService.generateSuggestedRoadmap(
      masterRoadmapId,
      branchSelections,
      userId,
    )
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const feedbackRoadmap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const result = await aiService.feedbackRoadmap(userId, req.body)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const analyzeJobReadiness = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role } = req.body as { role: string }
    const userId = req.user?.id as string

    const result = await aiService.analyzeJobReadiness(userId, role)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const listJobReadinessRoles = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(ok(aiService.getJobReadinessRoles()))
  } catch (error) {
    next(error)
  }
}

export const explainMistakes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { attemptId } = req.body as { attemptId: string }
    const userId = req.user?.id as string

    const result = await aiService.explainMistakes(userId, attemptId)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
