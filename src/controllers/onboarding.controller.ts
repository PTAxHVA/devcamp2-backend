import { Request, Response, NextFunction } from 'express'
import * as onboardingService from '../services/onboarding.service.js'
import { ok } from '../utils/api-response.js'

export const submitOnboarding = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    const result = await onboardingService.submitOnboarding(userId, req.body)
    res.status(201).json(ok(result))
  } catch (error) {
    next(error)
  }
}

export const getOnboardingStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.id as string
    const result = await onboardingService.getOnboardingStatus(userId)
    res.json(ok(result))
  } catch (error) {
    next(error)
  }
}
