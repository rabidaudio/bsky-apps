import * as yargs from 'yargs'

import { Dependencies, loadConfig } from './config'
import { createDb, migrateToLatest, rollback } from './db'
import FeedGenerator from './server'
import ListManager, { getUri } from './util/membership'

async function withDeps (callback: (deps: Dependencies) => Promise<void>) {
  const cfg = loadConfig()
  const db = createDb(cfg.databaseUrl)
  try {
    callback({ cfg, db })
  } finally {
    await db.destroy()
  }
}

yargs
  .scriptName("bsky-apps")
  .usage('$0 <cmd> [args]')
  .command('migrate:latest', 'Migrate to the latest version',
    async (argv) => {
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
    async (argv) => {
      await withDeps(async ({ cfg, db }) => {
        const server = FeedGenerator.create(cfg, db)
        await server.start()
        console.log(`🤖 running feed generator at ${server.host}`)
      })
    })
  .command('create <name> [members...]', 'Create a new feed',
    (yargs) =>
      yargs.option('name', {
        demandOption: true,
        type: 'string'
      })
      .option('user', {
        alias: 'u',
        description: 'Your handle on BlueSky',
        demandOption: true,
        type: 'string'
      })
      .option('password', {
        description: 'Your BlueSky password, or better yet an app token',
        alias: 'p',
        demandOption: true,
        type: 'string'
      })
      .option('isPublic', {
        alias: 'public',
        description: 'If the list can be used by anyone or is restricted to only the user who created it',
        type: 'boolean',
        demandOption: true,
        default: false
      })
      .option('members', {
        description: 'A list of handles that should be included in the feed',
        type: 'array',
        demandOption: true,
      }),
    async (argv) => {
      await withDeps(async (deps) => {
        const { name, user, password, isPublic, members } = argv
        const manager = new ListManager(deps, { identifier: user, password })
        const list = await manager.createFeed(name, isPublic, members as string[])
        console.log(`✅ Created list ${list.name} for ${manager.ownerHandle} with ${members.length} members: ${getUri(list)}`)
      })
    })
  // .command('update', 'Change the members of a feed', (yargs) => {}, async (argv) => {})
  .command('delete [listId]', 'Delete a feed',
    (yargs) =>
      yargs.option('listId', {
        demandOption: true,
        type: 'string'
      })
      .option('user', {
        alias: 'u',
        description: 'Your handle on BlueSky',
        demandOption: true,
        type: 'string'
      })
      .option('password', {
        description: 'Your BlueSky password, or better yet an app token',
        alias: 'p',
        demandOption: true,
        type: 'string'
      }),
    async (argv) => {
      await withDeps(async (deps) => {
        const manager = new ListManager(deps, { identifier: argv.user, password: argv.password })
        const list = await manager.deleteFeed(argv.listId)
        console.log(`🗑️ Deleted list ${list.name} for ${manager.ownerHandle}: ${getUri(list)}`)
      })
    })
  .help()
  .argv
