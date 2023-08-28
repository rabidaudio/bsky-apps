import { AtpAgent } from '@atproto/api'
import SqliteDb from 'better-sqlite3'
import { Kysely, Generated, SqliteDialect } from 'kysely'
import { From } from 'kysely/dist/cjs/parser/table-parser'

type HandleDid = {
    id: Generated<number>
    handle: string
    did: string
    cachedAt: number
}

type Schema = {
    handle_lookup: HandleDid
}

type DB = Kysely<Schema> 

export class InvalidHandleError extends Error {}

// This creates an in-memory cache of handle-did conversions.
// Rather than an LRU cache, it creates an in-memory sqlite table,
// so that lookups can happen in either direction. This takes a slight
// performance hit for a lower memory footprint
export class HandleCache {
    private db: DB
    private prepared: boolean

    // max number of records to retain, max amount of time to retain
    constructor(public max: number, public ttl: number) {
        this.prepared = false
        this.db = new Kysely<Schema>({
            dialect: new SqliteDialect({
                database: new SqliteDb(":memory:"),
            }),
        })
    }

    fetchDid(handle: string, onCacheMiss: () => Promise<string>): Promise<string> {
        return this.fetch('handle', handle, onCacheMiss)
    }

    fetchHandle(did: string, onCacheMiss: () => Promise<string>): Promise<string> {
        return this.fetch('did', did, onCacheMiss)
    }

    private async prepare() {
        if (this.prepared) return
        
        const tables = await this.db.introspection.getTables()
        const existingTable = tables.find(t => t.name === 'handle_lookup')
        if (existingTable) return

        await this.db.schema.createTable('handle_lookup')
            .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
            .addColumn('handle', 'varchar', (col) => col.notNull())
            .addColumn('did', 'varchar', (col) => col.notNull())
            .addColumn('cachedAt', 'integer', (col) => col.notNull())
            .execute()
        await this.db.schema.createIndex('idx_handle')
            .on('handle_lookup').column('handle').unique().execute()
        await this.db.schema.createIndex('idx_did')
            .on('handle_lookup').column('did').unique().execute()
        this.prepared = true
    }

    private async fetch(lookupColumn: 'did' | 'handle', value: string, onCacheMiss: () => Promise<string>): Promise<string> {
        const otherColumn = lookupColumn === 'handle' ? 'did' : 'handle'
        await this.prepare()
        const row = await this.db.selectFrom('handle_lookup')
            .selectAll()
            .where(lookupColumn, '=', value)
            .limit(1)
            .executeTakeFirst()
        if (row) {
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
            .where('id', '<', idCutoff)
            .where('cachedAt', '<', ageCutoff)
            .execute()
        return otherValue
    }
}

export const lookupHandle = async (did: string, agent: AtpAgent, handleCache: HandleCache): Promise<string> => {
    return handleCache.fetchHandle(did, async () => {
        const res = await agent.api.app.bsky.actor.getProfile({ actor: did })
        return res.data.handle
    })
}

export const lookupDid = async (handle: string, agent: AtpAgent, handleCache: HandleCache): Promise<string> => {
    return handleCache.fetchDid(handle, async() => {
        try {
            const res = await agent.resolveHandle({ handle })
            return res.data.did
        } catch (err) {
            throw new InvalidHandleError(`Unable to resolve handle "${handle}"`, { cause: err })
        }
    })
}
