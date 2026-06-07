import { Request, Response, NextFunction } from 'express'
import * as masterRoadmapService from '../services/master-roadmap.service.js'
import { ok } from '../utils/api-response.js'

export const listMasterRoadmaps = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await masterRoadmapService.listMasterRoadmaps()
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const getDemoRoadmap = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await masterRoadmapService.getDemoRoadmap()
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const getMasterRoadmapById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await masterRoadmapService.getMasterRoadmapById(req.params.id as string)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const getMasterRoadmapBranches = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await masterRoadmapService.getMasterRoadmapBranches(req.params.id as string)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
