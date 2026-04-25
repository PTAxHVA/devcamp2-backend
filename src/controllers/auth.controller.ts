import type { Request, Response } from 'express'
import * as authService from '../services/auth.service.js'
import { ok } from '../utils/api-response.js'

export const login = async (req: Request, res: Response) => {
  const result = await authService.login(req.body)
  res.json(ok(result))
}

export const signup = async (req: Request, res: Response) => {
  const result = await authService.signup(req.body)
  res.status(201).json(ok(result))
}
