import crypto from 'crypto'
import { Transaction } from 'kysely'

import { AtUri } from '@atproto/api'
import { ids } from '../lexicon/lexicons'

import { Dependencies } from '../config'
import { DatabaseSchema, List } from '../db/schema'
import { ListResponse } from '../api'
import { Atp } from './atp'

export const getUri = (list: { ownerDid: string, id: string }): AtUri =>
    AtUri.make(list.ownerDid, 'app.bsky.feed.generator', list.id)

export class ForbiddenError extends Error {}

export const generateUniqueListId = (): string => {
    // list names can be up to 15 lowercase chars. Here we generate random ids for these lists.
    // https://atproto.com/specs/record-key
    // log2(16^15) = 60 bits = 7.5 bytes
    // 50% probability of collision at sqrt(16^15) ~= 1 billion lists
    return crypto.randomBytes(8).toString('hex').toLowerCase().substring(0, 15)
}

const listToListResponse = (list: List, memberHandles: string[]): ListResponse => {
    const { name, isPublic, id, createdAt } = list
    return {
        id, name, isPublic, createdAt,
        memberHandles,
        uri: getUri(list).toString(),
    }
}

export class ListManager {
    constructor(private ctx: Dependencies, private api: Atp) {}

    async getLists(): Promise<ListResponse[]> {
        const rows = await this.ctx.db.selectFrom('list')
            .leftJoin('membership', 'list.id', 'membership.listId')
            .select([
                'list.id',
                'list.isPublic',
                'list.name',
                'list.ownerDid',
                'list.createdAt',
                'membership.memberDid'
            ])
            .where('list.ownerDid', '=', this.api.ownerDid)
            .orderBy('list.createdAt', 'desc')
            .orderBy('membership.id', 'asc')
            .execute()
        // This is the folly of using a low-level ORM: no relations. We have
        // to either to n+1 queries or do a bunch of manual currying to create nested
        // relations. This sucks.
        let lists: { [id: string]: ListResponse } = {}
        for (const row of rows) {
            const handle = row.memberDid ? await this.api.resolveDid(row.memberDid) : null
            const existing = lists[row.id]
            if (existing && handle) {
                existing.memberHandles.push(handle)
            } else {
                const { id, name, isPublic, createdAt } = row
                lists[row.id] = {
                    id, name, isPublic, createdAt,
                    uri: getUri(row).toString(),
                    memberHandles: (handle ? [handle] : [])
                }
            }
        }
        return Object.values(lists)
    }

    // It seems like Kysely doesn't support nested transactions
    private inTransaction<T>(handler: (trx: Transaction<DatabaseSchema>) => Promise<T>): Promise<T> {
        if (this.ctx.db instanceof Transaction) {
            return handler(this.ctx.db)
        }
        return this.ctx.db.transaction().execute(handler)
    }

    // Creates the list in the database and also publishes it to BlueSky
    async createFeed(name: string, isPublic: boolean, memberHandles: string[]): Promise<ListResponse> {    
        const { existingListCount } = await this.ctx.db.selectFrom('list')
            .select([
                qb => qb.fn.count<number>('list.id').as('existingListCount')
            ])
            .where('ownerDid', '=', this.api.ownerDid)
            .executeTakeFirstOrThrow()
        if (existingListCount >= this.ctx.cfg.maxListsPerUser) {
            throw new ForbiddenError("You've reached the maximum number of lists")
        }

        // run all this in a transaction so if the upstream calls fail the db is rolled back
        return await this.inTransaction(async (trx) => {
            // create the list in the database
            const list = await trx.insertInto('list')
                .values({ id: generateUniqueListId(), ownerDid: this.api.ownerDid, name, isPublic, createdAt: new Date() })
                .returningAll()
                .executeTakeFirstOrThrow()            

            // convert handles to dids and save members
            const memberDids = await this.resolveHandles(memberHandles)
            await trx.insertInto('membership')
                .values(memberDids.map(memberDid => ({ listId: list.id, memberDid })))
                .execute()

            await this.api.putRepo({
                repo: this.api.ownerDid,
                collection: ids.AppBskyFeedGenerator,
                rkey: list.id,
                record: {
                    did: this.ctx.cfg.serviceDid,
                    displayName: list.name,
                    description: `A custom list feed for ${this.api.ownerHandle}, generated using ${this.ctx.cfg.hostname}`,
                    // avatar: avatarRef, // TODO: add images to feeds
                    createdAt: new Date().toISOString(),
                },
            })
            return listToListResponse(list, memberHandles)
        })
    }

    async updateFeed(listId: string, args: { name?: string, isPublic?: boolean, memberHandles?: string[] }): Promise<ListResponse> {
        const { name, isPublic, memberHandles } = args
        let list = await this.getList(listId)
        if (list.ownerDid != this.api.ownerDid) {
            throw new ForbiddenError("Forbidden: this list belongs to someone else")
        }
        return await this.inTransaction(async (trx) => {
            // update list parameters
            if (name !== undefined || isPublic !== undefined) {
                list = await trx.updateTable('list')
                    .set({ name, isPublic })
                    .where('id', '=', listId)
                    .returningAll()
                    .executeTakeFirstOrThrow()
            }

            // update membership
            if (memberHandles !== undefined) {
                await trx.deleteFrom('membership').where('listId', '=', listId).execute()
                const rows = (await this.resolveHandles(memberHandles)).map(memberDid => ({ listId, memberDid }))
                await trx.insertInto('membership').values(rows).execute()
            }
            
            if (name !== undefined) {
                // update the name on the api
                await this.api.putRepo({
                    repo: this.api.ownerDid,
                    collection: ids.AppBskyFeedGenerator,
                    rkey: list.id,
                    record: {
                        did: this.ctx.cfg.serviceDid,
                        displayName: list.name,
                        description: `A custom list feed for ${this.api.ownerHandle}, generated using ${this.ctx.cfg.hostname}`,
                    },
                })
            }

            return listToListResponse(list, memberHandles || [])
        })
    }

    async deleteFeed(listId: string): Promise<List> {
        const list = await this.getList(listId)
        if (list.ownerDid != this.api.ownerDid) {
            throw new ForbiddenError("Forbidden: this list belongs to someone else")
        }
        return await this.inTransaction(async (trx) => {

            await trx.deleteFrom('membership').where('listId', '=', listId).execute()
            await trx.deleteFrom('list').where('id', '=', listId).execute()

            await this.api.deleteRepo({
                repo: this.api.ownerDid,
                collection: ids.AppBskyFeedGenerator,
                rkey: list.id,
            })
            return list
        })
    }

    async getList(listId: string): Promise<List> {
        const list = await this.ctx.db.selectFrom('list')
            .selectAll()
            .where('id', '=', listId)
            .limit(1)
            .executeTakeFirstOrThrow()

        if (list.ownerDid !== this.api.ownerDid) {
            throw new ForbiddenError("Forbidden: this list belongs to someone else")
        }
        return list
    }

    private resolveHandles(handles: string[]): Promise<string[]> {
        return Promise.all(handles.map(handle => this.api.resolveHandle(handle)))
    }
}

export default ListManager
