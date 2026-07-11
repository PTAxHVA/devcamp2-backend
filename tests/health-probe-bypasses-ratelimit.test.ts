import { describe, it, expect } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { generalRateLimiter } from '../src/middlewares/rate-limit.middleware.js'

// Express 5 exposes the router layer stack on app.router. Each layer is either a
// middleware (`handle` = the function passed to app.use) or a route (`route.path`
// set). The liveness/readiness probes MUST be registered BEFORE generalRateLimiter
// so a probe request resolves without ever reaching the limiter. This is what keeps
// Render's frequent /health polls from sharing the limit bucket and 429-ing, which
// had put the deployed instance into a fail -> restart flap. This spec locks the
// ordering in so a future middleware reshuffle can't silently re-introduce it.
type StackLayer = { handle?: unknown; route?: { path?: string } }

const getRouterStack = (): StackLayer[] => {
  const internals = app as unknown as {
    router?: { stack?: StackLayer[] }
    _router?: { stack?: StackLayer[] }
  }
  return internals.router?.stack ?? internals._router?.stack ?? []
}

describe('health/ready probes are exempt from the rate limiter', () => {
  it('registers /health and /ready before generalRateLimiter in the middleware stack', () => {
    const stack = getRouterStack()
    expect(stack.length).toBeGreaterThan(0)

    const limiterIndex = stack.findIndex((layer) => layer.handle === generalRateLimiter)
    const healthIndex = stack.findIndex((layer) => layer.route?.path === '/health')
    const readyIndex = stack.findIndex((layer) => layer.route?.path === '/ready')

    expect(limiterIndex, 'generalRateLimiter is registered').toBeGreaterThanOrEqual(0)
    expect(healthIndex, '/health route is registered').toBeGreaterThanOrEqual(0)
    expect(readyIndex, '/ready route is registered').toBeGreaterThanOrEqual(0)

    // Probes come first -> the limiter middleware never runs for them.
    expect(healthIndex).toBeLessThan(limiterIndex)
    expect(readyIndex).toBeLessThan(limiterIndex)
  })

  it('serves /health with 200 and the static ok payload (no DB dependency)', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, data: { status: 'ok' } })
  })
})
