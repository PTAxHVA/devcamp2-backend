import { NextFunction, Request, Response } from 'express'
import * as dashboardService from '../services/dashboard.service.js'
import { ok } from '../utils/api-response.js'

export const getDashboardAnalytics = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const result = await dashboardService.getDashboardAnalytics(userId)

    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
