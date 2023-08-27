#!/usr/bin/env node
import * as yargs from 'yargs'

import { createDb, migrateToLatest, rollback } from '../src/db'
import { loadConfig } from '../src/index'


const { databaseUrl } = loadConfig()
const db = createDb(databaseUrl)

yargs
  .scriptName("migrate")
  .usage('$0 <cmd> [args]')
  .command('latest', 'Migrate to the latest version',
    async function (argv) {
      console.log(`Migrating database`)
      await migrateToLatest(db)
    })
  .command('rollback', 'Downgrade database',
    (yargs) => yargs.option('s', {
      alias: 'steps',
      demandOption: true,
      default: 1,
      type: 'number'
    }),
    async function (argv: { s: number }) {
      console.log(`Rolling back ${argv.s} steps`)
      for (let i = 0; i < argv.s; i++) {
        await rollback(db)
      }
    })
  .help()
  .argv
