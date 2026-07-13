import { NextFunction, Request, Response } from 'express'
import * as streakService from '../services/streak.service.js'
import * as progressService from '../services/progress.service.js'
import { ok } from '../utils/api-response.js'
import * as userService from '../services/user.service.js'
import * as activityService from '../services/activity.service.js'

// View-full activity chart window bounds (days).
const ACTIVITY_MIN_DAYS = 7
const ACTIVITY_MAX_DAYS = 90
const ACTIVITY_DEFAULT_DAYS = 30

export const getUserDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const user = await userService.getUser(userId)

    res.json(ok(user))
  } catch (error) {
    next(error)
  }
}

export const getProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const profile = await userService.getProfile(userId)

    res.json(ok(profile))
  } catch (error) {
    next(error)
  }
}

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const profile = await userService.updateProfile(req.body, userId)

    res.json(ok(profile))
  } catch (error) {
    next(error)
  }
}

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

export const getUserActivity = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    // Coerce to a finite integer BEFORE clamping: a fractional value would reach
    // `new Array(days)` in buildDailyActivity and throw a RangeError (500), and
    // `Number(x) || DEFAULT` wrongly turns days=0 into 30 instead of clamping to 7.
    const parsed = Number(req.query.days)
    const requested = Number.isFinite(parsed) ? Math.trunc(parsed) : ACTIVITY_DEFAULT_DAYS
    const days = Math.min(ACTIVITY_MAX_DAYS, Math.max(ACTIVITY_MIN_DAYS, requested))

    const activity = await activityService.getActivitySeries(userId, days)

    res.json(ok(activity))
  } catch (error) {
    next(error)
  }
}

export const updateAccountCredentials = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const updatedUser = await userService.updateAccountCredentials(req.body, userId)

    res.json(ok(updatedUser))
  } catch (error) {
    next(error)
  }
}

export const deactivateAccount = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const deactivatedUser = await userService.deactivateAccount(userId, req.body)

    res.json(ok(deactivatedUser))
  } catch (error) {
    next(error)
  }
}

export const getPassportSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const passportSettings = await userService.getPassportSettings(userId)

    res.json(ok(passportSettings))
  } catch (error) {
    next(error)
  }
}

export const updatePassportSettings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string

    const passportSettings = await userService.updatePassportSettings(req.body, userId)

    res.json(ok(passportSettings))
  } catch (error) {
    next(error)
  }
}
