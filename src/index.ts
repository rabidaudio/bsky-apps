import * as yargs from 'yargs'

import { type Dependencies, createDependencies } from './config'
import { migrateToLatest, rollback } from './db'
import FeedGenerator from './server'

async function withDeps (callback: (deps: Dependencies) => Promise<void>): Promise<void> {
  const deps = await createDependencies()
  try {
    await callback(deps)
  } finally {
    await deps.db.destroy()
  }
}

/* eslint-disable @typescript-eslint/no-unused-expressions, @typescript-eslint/no-floating-promises */
yargs
  .scriptName('bsky-apps')
  .usage('$0 <cmd> [args]')
  .command('migrate:latest', 'Migrate to the latest version',
    async (_argv) => {
      await withDeps(async ({ db }) => {
        console.log('Migrating database')
        await migrateToLatest(db)
      })
    })
  .command('migrate:rollback', 'Downgrade database',
    (yargs) => yargs.option('steps', {
      demandOption: true,
      default: 1,
      type: 'number'
    }),
    async function (argv) {
      await withDeps(async ({ db }) => {
        console.log(`Rolling back ${argv.steps} steps`)
        for (let i = 0; i < argv.steps; i++) {
          await rollback(db)
        }
      })
    })
  .command('start', 'Run the web server',
    async (_argv) => {
      const deps = await createDependencies()
      const server = FeedGenerator.create(deps)
      await server.start()
      console.log(`🤖 running feed generator at ${server.host}`)
    })
  .help()
  .argv
