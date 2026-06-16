import { Request, Response, NextFunction } from 'express'
import * as userRoadmapService from '../services/user-roadmap.service.js'
import { ok } from '../utils/api-response.js'

export const createRoadmap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    const result = await userRoadmapService.createUserRoadmap(userId, req.body)
    // 201 for a fresh enrollment, 200 when restoring (reactivating) a prior one.
    res.status(result.reactivated ? 200 : 201).json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const listRoadmaps = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    const result = await userRoadmapService.listActiveRoadmaps(userId)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const getRoadmapDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    const result = await userRoadmapService.getUserRoadmapDetail(userId, req.params.id as string)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const deleteRoadmap = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    const result = await userRoadmapService.softDeleteRoadmap(userId, req.params.id as string)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
