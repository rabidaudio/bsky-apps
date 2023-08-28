import * as yargs from 'yargs'

import { Dependencies, createDependencies } from './config'
import { migrateToLatest, rollback } from './db'
import FeedGenerator from './server'

async function withDeps (callback: (deps: Dependencies) => Promise<void>) {
  const deps = createDependencies()
  try {
    await callback(deps)
  } finally {
    await deps.db.destroy()
  }
}

yargs
  .scriptName("bsky-apps")
  .usage('$0 <cmd> [args]')
  .command('migrate:latest', 'Migrate to the latest version',
    async (_argv) => {
      await withDeps(async ({ db }) => {
        console.log(`Migrating database`)
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
      const server = FeedGenerator.create(createDependencies())
      await server.start()
      console.log(`🤖 running feed generator at ${server.host}`)
    })
  .help()
  .argv
