import { NextFunction, Request, Response } from 'express'
import * as SectionService from '../services/section.service.js'
import { ok } from '../utils/api-response.js'

export const getSectionById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sectionId = req.params.sectionId as string
    const userId = req.user?.id as string

    const result = await SectionService.getSectionById(sectionId, userId)

    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
