import type { Request, Response } from 'express'
import * as sampleService from '../services/sample.service.js'
import { ok } from '../utils/api-response.js'

export const list = async (_req: Request, res: Response) => {
  const samples = await sampleService.findAll()
  res.json(ok(samples))
}
