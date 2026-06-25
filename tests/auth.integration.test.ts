import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'

const base = '/api/v1/client'
const user = { email: 'alice@example.com', password: 'Sup3rPass!', username: 'Alice' }

describe('auth (integration)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('signs up a new user and returns a token + user', async () => {
    const res = await request(app).post(`${base}/auth/signup`).send(user)
    expect([200, 201]).toContain(res.status)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.data.token).toBe('string')
    expect(res.body.data.user.email).toBe('alice@example.com')
  })

  it('logs in with correct credentials', async () => {
    await request(app).post(`${base}/auth/signup`).send(user)
    const res = await request(app)
      .post(`${base}/auth/login`)
      .send({ email: user.email, password: user.password })
    expect(res.status).toBe(200)
    expect(typeof res.body.data.token).toBe('string')
  })

  it('returns the same 401 for a wrong password and an unknown email (no enumeration)', async () => {
    await request(app).post(`${base}/auth/signup`).send(user)
    const wrong = await request(app)
      .post(`${base}/auth/login`)
      .send({ email: user.email, password: 'WrongPass1!' })
    const unknown = await request(app)
      .post(`${base}/auth/login`)
      .send({ email: 'nobody@example.com', password: 'WhateverPass1' })

    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it('rejects a duplicate signup with 409 EMAIL_TAKEN', async () => {
    await request(app).post(`${base}/auth/signup`).send(user)
    const dup = await request(app).post(`${base}/auth/signup`).send(user)
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('blocks /me without a token and allows it with a valid token', async () => {
    const noToken = await request(app).get(`${base}/me`)
    expect(noToken.status).toBe(401)

    const signup = await request(app).post(`${base}/auth/signup`).send(user)
    const token = signup.body.data.token as string
    const me = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${token}`)
    expect(me.status).toBe(200)
    expect(me.body.success).toBe(true)
  })
})
