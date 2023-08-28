import SqliteDb from 'better-sqlite3'
import { Kysely, type Generated, SqliteDialect } from 'kysely'

export interface HandleDid {
  handle: string
  did: string
  cachedAt: number
}

interface Schema {
  handle_lookup: HandleDid & { id: Generated<number> }
}

type DB = Kysely<Schema>

// This creates an in-memory cache of handle-did conversions.
// Rather than an LRU cache, it creates an in-memory sqlite table,
// so that lookups can happen in either direction. This takes a slight
// performance hit for a lower memory footprint
export class HandleCache {
  // max number of records to retain, max amount of time to retain
  static async create ({ max, ttl }: { max: number, ttl: number }): Promise<HandleCache> {
    const db = new Kysely<Schema>({
      dialect: new SqliteDialect({
        database: new SqliteDb(':memory:')
      })
    })

    await db.schema.createTable('handle_lookup')
      .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
      .addColumn('handle', 'varchar', (col) => col.notNull())
      .addColumn('did', 'varchar', (col) => col.notNull())
      .addColumn('cachedAt', 'integer', (col) => col.notNull())
      .execute()

    await db.schema.createIndex('idx_handle')
      .on('handle_lookup').column('handle').unique().execute()
    await db.schema.createIndex('idx_did')
      .on('handle_lookup').column('did').unique().execute()

    return new HandleCache(max, ttl, db)
  }

  constructor (public max: number, public ttl: number, private readonly db: DB) {}

  async getCacheSize (): Promise<number> {
    const { rowCount } = await this.db.selectFrom('handle_lookup')
      .select([qb => qb.fn.count<number>('id').as('rowCount')])
      .executeTakeFirstOrThrow()
    return rowCount
  }

  async peek (args: { handle: string } | { did: string }): Promise<HandleDid | undefined> {
    let qb = this.db.selectFrom('handle_lookup').selectAll()
    if ('handle' in args) {
      qb = qb.where('handle', '=', args.handle)
    } else {
      qb = qb.where('did', '=', args.did)
    }
    return await qb.limit(1).executeTakeFirst()
  }

  async fetchDid (handle: string, onCacheMiss: () => Promise<string>): Promise<string> {
    return await this.fetch('handle', handle, onCacheMiss)
  }

  async fetchHandle (did: string, onCacheMiss: () => Promise<string>): Promise<string> {
    return await this.fetch('did', did, onCacheMiss)
  }

  private async fetch (lookupColumn: 'did' | 'handle', value: string, onCacheMiss: () => Promise<string>): Promise<string> {
    const otherColumn = lookupColumn === 'handle' ? 'did' : 'handle'
    const row = await this.db.selectFrom('handle_lookup')
      .selectAll()
      .where(lookupColumn, '=', value)
      .limit(1)
      .executeTakeFirst()
    if (row !== undefined) {
      return row[otherColumn]
    }
    const otherValue = await onCacheMiss()
    const handle = lookupColumn === 'handle' ? value : otherValue
    const did = lookupColumn === 'did' ? value : otherValue
    const cachedAt = new Date().getTime()
    // insert the value
    const { id } = await this.db.insertInto('handle_lookup')
      .values({ handle, did, cachedAt })
      .returning('id')
      .executeTakeFirstOrThrow()
    // compact the cache
    const idCutoff = id - this.max
    const ageCutoff = cachedAt - this.ttl
    await this.db.deleteFrom('handle_lookup')
      .where('id', '<=', idCutoff)
      .orWhere('cachedAt', '<', ageCutoff)
      .execute()
    return otherValue
  }
}
