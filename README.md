# DevCamp 2 Final Project — Backend

REST API backend cho Personalized Code Learning Platform.

## 🚀 Live Deployment

| Endpoint          | URL                                                 |
| ----------------- | --------------------------------------------------- |
| API base (client) | https://devcamp2-backend.onrender.com/api/v1/client |
| Health check      | https://devcamp2-backend.onrender.com/health        |
| Frontend (Vercel) | https://devcamp2-frontend.vercel.app                |

- **Host**: Render (Singapore, free tier). **Auto-deploy** khi merge vào `main`.
- **Build Command**: `yarn install --production=false && yarn build` (cần `--production=false` để cài devDependencies cho `tsc`). **Start**: `yarn start`.
- **Env** (Render → Environment): `NODE_ENV=production`, `MONGO_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FIREWORKS_API_KEY`, `FIREWORKS_MODEL`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CLIENT_URL`. KHÔNG set `PORT` (Render tự cấp).
- Free tier ngủ sau ~15 phút không request → request đầu mất ~50s (cold start); gọi `/health` để đánh thức.

## Tech Stack

- **Express 5 + TypeScript strict**
- **MongoDB Atlas + Mongoose**
- **Zod** — request validation
- **JWT (jsonwebtoken) + bcrypt** — auth
- **Helmet + CORS + express-rate-limit** — security
- **pino + pino-pretty** — logging
- **Fireworks AI** (openai SDK, OpenAI-compatible) — user-facing AI features; model chọn qua `FIREWORKS_MODEL`
- **tsx** — dev runner
- **ESLint + Prettier + Husky + commitlint + lint-staged**
- **Yarn 1.22 + Node 22 + Corepack**

## Prerequisites

- Node.js 22 LTS
- Yarn (enable qua Corepack: `corepack enable`)
- Git
- MongoDB Atlas account (https://cloud.mongodb.com)
- Fireworks AI account cho LLM (https://app.fireworks.ai)

## Quickstart

```bash
git clone https://github.com/<your-org>/devcamp2-backend.git
cd devcamp2-backend
corepack enable
yarn install
cp .env.example .env
# Sửa .env: MONGO_URI, JWT_SECRET (>=32 chars), FIREWORKS_API_KEY
yarn dev
```

Server chạy tại http://localhost:5000

Test health check:

```bash
curl http://localhost:5000/health
# → {"success":true,"data":{"status":"ok"}}
```

## Scripts

| Command           | Mô tả                            |
| ----------------- | -------------------------------- |
| `yarn dev`        | tsx watch — hot reload           |
| `yarn build`      | tsc → dist/                      |
| `yarn start`      | node dist/server.js (production) |
| `yarn lint`       | ESLint                           |
| `yarn type-check` | tsc --noEmit                     |
| `yarn format`     | Prettier format                  |

## Cấu trúc

```
src/
├── config/       # env, database, logger, ai-model
├── routes/
│   ├── client/   # /api/v1/client/*
│   └── admin/    # /api/v1/admin/* (require role='admin')
├── controllers/  # HTTP handlers (flat, not split)
├── services/     # business logic (flat)
├── models/       # Mongoose schemas
├── schemas/      # Zod validation schemas
├── middlewares/  # auth, validate, error, rate-limit
├── utils/        # jwt, password, api-error, api-response
├── types/        # global types (extend Express.Request)
├── app.ts        # Express config
└── server.ts     # bootstrap
```

## API base URLs

- Client: `/api/v1/client/*` — user-facing endpoints
- Admin: `/api/v1/admin/*` — require `role='admin'`

## Env vars

| Var                 | Mô tả                          | Required                       |
| ------------------- | ------------------------------ | ------------------------------ |
| `NODE_ENV`          | development / production       | default: development           |
| `PORT`              | listen port                    | default: 5000                  |
| `MONGO_URI`         | MongoDB connection string      | ✅                             |
| `JWT_SECRET`        | >=32 chars random string       | ✅                             |
| `JWT_EXPIRES_IN`    | token lifetime                 | default: 7d                    |
| `FIREWORKS_API_KEY` | Fireworks AI API key           | ✅                             |
| `FIREWORKS_MODEL`   | Fireworks model id (swappable) | default: gpt-oss-120b          |
| `CLIENT_URL`        | FE origin cho CORS             | default: http://localhost:5173 |

Generate JWT secret:

```bash
openssl rand -base64 48
```

## Branch strategy

- `main` — production (protected, PR + review bắt buộc)
- `dev` — integration (protected)
- `feat/<name>` — feature branch
- `fix/<name>` — bug fix
- `chore/<name>` — config / tooling

## Commit convention

Conventional Commits (commitlint sẽ reject sai format):

```
feat(auth): implement JWT login + signup
fix(roadmap): handle missing topic in service.findById
chore(deps): bump mongoose to 8.15
```

Type hợp lệ: `feat`, `fix`, `refactor`, `docs`, `style`, `test`, `chore`, `perf`, `ci`.

## Deploy

Render (free tier) — xem thêm section **Live Deployment** ở đầu README:

- Build: `yarn install --production=false && yarn build` (`--production=false` để cài devDependencies cho `tsc`, vì `NODE_ENV=production` khiến yarn bỏ qua chúng)
- Start: `yarn start`
- Env vars: add tất cả trong bảng trên qua Render dashboard (KHÔNG set `PORT` — Render tự cấp)

## License

Internal — GDG on Campus DevCamp 2.
