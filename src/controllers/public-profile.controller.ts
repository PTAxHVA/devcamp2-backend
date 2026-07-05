import { NextFunction, Request, Response } from 'express'
import * as publicProfileService from '../services/public-profile.service.js'
import { ok } from '../utils/api-response.js'

export const getPublicPassport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Express 5 types params as string | string[] | undefined — normalize to a
    // plain string; anything malformed simply won't match a stored token (404).
    const shareToken = typeof req.params.shareToken === 'string' ? req.params.shareToken : ''

    const passport = await publicProfileService.getPublicPassport(shareToken)

    res.json(ok(passport))
  } catch (error) {
    next(error)
  }
}
