import type { Request, Response, NextFunction } from 'express'
import * as authService from '../services/auth.service.js'
import { ok } from '../utils/api-response.js'

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.login(req.body)
    res.json(ok(result))
  } catch (err) {
    next(err)
  }
}

export const signup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await authService.signup(req.body)
    res.status(201).json(ok(result))
  } catch (err) {
    next(err)
  }
}
