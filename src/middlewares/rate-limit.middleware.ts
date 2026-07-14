import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { Request } from 'express'
import { env } from '../config/env.js'

// Helper to extract real IP behind Cloudflare and Render, with IPv6 /64 normalization
const getRealIp = (req: Request) => {
  const ip = req.ip || ''
  return ipKeyGenerator(ip) || 'unknown'
}

// Disable rate limiting under automated tests so integration suites that fire
// many requests from one IP don't trip the limiter. Never true in dev/prod.
const skipInTest = (): boolean => env.NODE_ENV === 'test'

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Behind Cloudflare/Render several clients can share one proxy-IP bucket, so keep
  // this generous for demo-day traffic. The health/ready probes are exempt (see
  // app.ts), so a high ceiling carries no flap risk. Auth (5/min) and AI (5/min +
  // 14/min global) have their own stricter limiters, so this doesn't weaken them.
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  keyGenerator: (req) => getRealIp(req),
})

// Stricter per-user limit for the AI endpoints
// Keys by user ID (since this is authenticated) or IP as fallback
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  skip: skipInTest,
  keyGenerator: (req) => req.user?.id || getRealIp(req),
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'You have exceeded the rate limit for AI requests. Please try again later.',
      },
    }),
})

// Global limiter across all AI endpoints (protects the shared provider quota)
export const globalAiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 14,
  skip: skipInTest,
  keyGenerator: () => 'global-ai',
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          'The AI system is currently experiencing heavy load. Please try again in a minute.',
      },
    }),
})

// Rate limit login attempts: 5 attempts per 1 minute per IP
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  skip: skipInTest,
  keyGenerator: (req) => getRealIp(req),
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message:
          'You have exceeded the rate limit for authentication requests. Please try again later.',
      },
    }),
})
