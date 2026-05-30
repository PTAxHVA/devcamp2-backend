import rateLimit from 'express-rate-limit'

export const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

// Stricter limit for Gemini AI (15 RPM free tier)
// Keys by user ID (since this is authenticated) or IP as fallback
export const aiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'You have exceeded the rate limit for AI requests. Please try again later.',
      },
    }),
})
