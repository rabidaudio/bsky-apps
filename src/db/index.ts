import { Kysely, Migrator, PostgresDialect } from 'kysely'
import { Pool } from 'pg'

import { type DatabaseSchema } from './schema'
import { migrationProvider } from './migrations'

export const createDb = (connectionString: string): Database => {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 10,
        // Heroku settings, see
        // https://devcenter.heroku.com/articles/connecting-heroku-postgres#connecting-in-node-js
        ssl: process.env.NODE_ENV === 'production'
          ? {
              rejectUnauthorized: false
            }
          : false
      })
    })
  })
}

export const migrateToLatest = async (db: Database): Promise<void> => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateToLatest()
  if (error !== undefined) throw error as Error
}

export const rollback = async (db: Database): Promise<void> => {
  const migrator = new Migrator({ db, provider: migrationProvider })
  const { error } = await migrator.migrateDown()
  if (error !== undefined) throw error as Error
}

export type Database = Kysely<DatabaseSchema>
