import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import request from 'supertest'
import app from '../src/app.js'
import { connectTestDb, disconnectTestDb, clearCollections } from './helpers/test-db.js'

const base = '/api/v1/client'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='

const register = async (email: string): Promise<string> => {
  const res = await request(app)
    .post(`${base}/auth/signup`)
    .send({ email, password: 'Sup3rPass!', username: email.split('@')[0] })
  return res.body.data.token as string
}

describe('profile avatar (PATCH /me/profile avatarUrl)', () => {
  beforeAll(connectTestDb)
  afterAll(disconnectTestDb)
  afterEach(clearCollections)

  it('saves a valid data-URL and returns it from /me and /me/profile', async () => {
    const token = await register('avatar1@example.com')

    const patch = await request(app)
      .patch(`${base}/me/profile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: PNG })
    expect(patch.status).toBe(200)
    expect(patch.body.data.avatarUrl).toBe(PNG)

    const me = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${token}`)
    expect(me.body.data.avatarUrl).toBe(PNG)

    const profile = await request(app)
      .get(`${base}/me/profile`)
      .set('Authorization', `Bearer ${token}`)
    expect(profile.body.data.avatarUrl).toBe(PNG)
  })

  it('defaults avatarUrl to null before any upload', async () => {
    const token = await register('avatar2@example.com')
    const me = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${token}`)
    expect(me.body.data.avatarUrl).toBeNull()
  })

  it('clears the avatar when sent null', async () => {
    const token = await register('avatar3@example.com')
    await request(app)
      .patch(`${base}/me/profile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: PNG })

    const cleared = await request(app)
      .patch(`${base}/me/profile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: null })
    expect(cleared.status).toBe(200)
    expect(cleared.body.data.avatarUrl).toBeNull()

    const me = await request(app).get(`${base}/me`).set('Authorization', `Bearer ${token}`)
    expect(me.body.data.avatarUrl).toBeNull()
  })

  it('rejects a non-image data-URL (400)', async () => {
    const token = await register('avatar4@example.com')
    const res = await request(app)
      .patch(`${base}/me/profile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: 'data:text/html;base64,QUJD' })
    expect(res.status).toBe(400)
  })

  it('rejects an oversized image (400)', async () => {
    const token = await register('avatar5@example.com')
    const huge = 'data:image/png;base64,' + 'A'.repeat(280_001)
    const res = await request(app)
      .patch(`${base}/me/profile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ avatarUrl: huge })
    expect(res.status).toBe(400)
  })

  it('requires auth (401)', async () => {
    const res = await request(app).patch(`${base}/me/profile`).send({ avatarUrl: PNG })
    expect(res.status).toBe(401)
  })
})
