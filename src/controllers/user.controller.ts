import { NextFunction, Request, Response } from 'express'
import * as streakService from '../services/streak.service.js'
import * as progressService from '../services/progress.service.js'
import { ok } from '../utils/api-response.js'

export const getUserStreak = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const streak = await streakService.getStreak(userId)

    res.json(ok(streak))
  } catch (error) {
    next(error)
  }
}

export const getUserProgress = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const progress = await progressService.getProgress(userId)

    res.json(ok(progress))
  } catch (error) {
    next(error)
  }
}
