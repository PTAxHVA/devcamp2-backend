import type { Request, Response, NextFunction } from 'express'
import * as passwordRestService from '../services/password-reset.service.js'
import { ok } from '../utils/api-response.js'

export const requestPasswordReset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await passwordRestService.requestPasswordReset(req.body)
    res.json(ok(result))
  } catch (err) {
    next(err)
  }
}

export const resetPassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await passwordRestService.resetPassword(req.body)
    res.json(ok(result))
  } catch (err) {
    next(err)
  }
}
