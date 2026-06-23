/* eslint-disable no-console -- CLI script: console output is the user-facing UI */
/**
 * Safety backup (T41 / QA H1) — snapshot the MongoDB database BEFORE any
 * destructive op (index migration `yarn fix-indexes`, or a content re-seed).
 *
 * Thin wrapper around `mongodump` (MongoDB Database Tools). Writes a timestamped
 * dump under ./backups/. Restore with:
 *     mongorestore --uri "$MONGO_URI" --drop ./backups/<timestamp>
 *
 * Requires the `mongodump` binary on PATH:
 *     macOS:  brew install mongodb-database-tools
 *     (Atlas paid tiers also provide automated cloud snapshots — prefer those when available.)
 *
 * Usage:  yarn backup        (requires MONGO_URI in .env)
 */
import 'dotenv/config'
import { spawnSync } from 'node:child_process'

function main() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('FATAL: MONGO_URI is not set. Add it to .env or export it.')
    process.exit(1)
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = `./backups/${stamp}`
  console.log(`Backing up to ${outDir} (this can take a minute)...`)

  const result = spawnSync('mongodump', ['--uri', uri, '--out', outDir], { stdio: 'inherit' })

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      console.error(
        'FATAL: `mongodump` not found on PATH. Install MongoDB Database Tools:\n' +
          '  macOS: brew install mongodb-database-tools',
      )
    } else {
      console.error('FATAL: mongodump failed:', result.error.message)
    }
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`FATAL: mongodump exited with code ${result.status}`)
    process.exit(result.status ?? 1)
  }

  console.log(`✓ Backup complete: ${outDir}`)
  console.log(`  Restore with: mongorestore --uri "$MONGO_URI" --drop ${outDir}`)
}

main()
