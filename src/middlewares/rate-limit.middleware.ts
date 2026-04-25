import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

// Stricter limit for Gemini AI (15 RPM free tier)
// ipKeyGenerator normalizes IPv6 to /64 subnet so users can't spam from random IPv6 addresses
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ''),
})
