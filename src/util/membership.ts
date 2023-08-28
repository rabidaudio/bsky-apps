import crypto from 'crypto'

import { AtUri, AtpAgent, AtpAgentLoginOpts } from '@atproto/api'
import { ids } from '../lexicon/lexicons'

import { Dependencies } from '../config'
import { List } from '../db/schema'
import { ListResponse } from '../api'
import { lookupDid, lookupHandle } from './handle'

export const getUri = (list: { ownerDid: string, id: string }): AtUri =>
    AtUri.make(list.ownerDid, 'app.bsky.feed.generator', list.id)

export class ForbiddenError extends Error {}

const generateUniqueListId = (): string => {
    // list names can be up to 15 lowercase chars. Here we generate random ids for these lists.
    // https://atproto.com/specs/record-key
    // log2(16^15) = 60 bits = 7.5 bytes
    // 50% probability of collision at sqrt(16^15) ~= 1 billion lists
    return crypto.randomBytes(8).toString('hex').toLowerCase().substring(0, 15)
}

const listToListResponse = (list: List, memberHandles: string[]): ListResponse => {
    const { name, isPublic, id } = list
    return {
        id, name, isPublic,
        memberHandles,
        uri: getUri(list).toString(),
    }
}

export class ListManager {
    constructor(public ctx: Dependencies, public agent: AtpAgent) {}

    async getLists(): Promise<ListResponse[]> {
        const rows = await this.ctx.db.selectFrom('list')
            .leftJoin('membership', 'list.id', 'membership.listId')
            .select([
                'list.id',
                'list.isPublic',
                'list.name',
                'list.ownerDid',
                'membership.memberDid'
            ])
            .where('list.ownerDid', '=', this.ownerDid)
            .orderBy('list.id', 'asc')
            .orderBy('membership.id', 'asc')
            .execute()
        // This is the folly of using a low-level ORM: no relations. We have
        // to either to n+1 queries or do a bunch of manual currying to create nested
        // relations. This sucks.
        let lists: { [id: string]: ListResponse } = {}
        for (const row of rows) {
            const handle = row.memberDid ? await lookupHandle(row.memberDid, this.agent, this.ctx.handleCache) : null
            const existing = lists[row.id]
            if (existing && handle) {
                existing.memberHandles.push(handle)
            } else {
                const { id, name, isPublic } = row
                lists[row.id] = {
                    id, name, isPublic,
                    uri: getUri(row).toString(),
                    memberHandles: (handle ? [handle] : [])
                }
            }
        }
        return Object.values(lists)
    }

    // Creates the list in the database and also publishes it to BlueSky
    async createFeed(name: string, isPublic: boolean, memberHandles: string[]): Promise<ListResponse> {    
        const { existingListCount } = await this.ctx.db.selectFrom('list')
            .select([
                qb => qb.fn.count<number>('list.id').as('existingListCount')
            ])
            .where('ownerDid', '=', this.ownerDid)
            .executeTakeFirstOrThrow()
        if (existingListCount >= this.ctx.cfg.maxListsPerUser) {
            throw new ForbiddenError("You've reached the maximum number of lists")
        }

        // run all this in a transaction so if the upstream calls fail the db is rolled back
        return await this.ctx.db.transaction().execute(async (trx) => {
            // create the list in the database
            const list = await trx.insertInto('list')
                .values({ id: generateUniqueListId(), ownerDid: this.ownerDid, name, isPublic })
                .returningAll()
                .executeTakeFirstOrThrow()            
    
            // convert handles to dids and save members
            const memberDids = await this.lookupHandleDids(memberHandles)
            await trx.insertInto('membership')
                .values(memberDids.map(memberDid => ({ listId: list.id, memberDid })))
                .execute()
    
            if (this.isProduction) {
                await this.agent.api.com.atproto.repo.putRecord({
                    repo: this.ownerDid,
                    collection: ids.AppBskyFeedGenerator,
                    rkey: list.id,
                    record: {
                        did: this.ctx.cfg.serviceDid,
                        displayName: list.name,
                        description: `A custom list feed for ${this.ownerHandle}, generated using ${this.ctx.cfg.hostname}`,
                        // avatar: avatarRef, // TODO: add images to feeds
                        createdAt: new Date().toISOString(),
                    },
                })
            }

            return listToListResponse(list, memberHandles)
        })
    }

    async updateFeed(listId: string, name: string | undefined, isPublic: boolean | undefined, memberHandles: string[]): Promise<ListResponse> {
        let list = await this.getList(listId)
        if (list.ownerDid != this.ownerDid) {
            throw new ForbiddenError("Forbidden: this list belongs to someone else")
        }
        return await this.ctx.db.transaction().execute(async (trx) => {
            // update list parameters
            list = await trx.updateTable('list')
                .set({ name, isPublic })
                .where('id', '=', listId)
                .returningAll()
                .executeTakeFirstOrThrow()

            // update membership
            await trx.deleteFrom('membership').where('listId', '=', listId).execute()
            const rows = (await this.lookupHandleDids(memberHandles)).map(memberDid => ({ listId, memberDid }))
            await trx.insertInto('membership').values(rows).execute()
            
            if (name !== undefined && this.isProduction) {
                // update the name on the api
                await this.agent.api.com.atproto.repo.putRecord({
                    repo: this.ownerDid,
                    collection: ids.AppBskyFeedGenerator,
                    rkey: list.id,
                    record: {
                        did: this.ctx.cfg.serviceDid,
                        displayName: list.name,
                        description: `A custom list feed for ${this.ownerHandle}, generated using ${this.ctx.cfg.hostname}`,
                    },
                })
            }

            return listToListResponse(list, memberHandles)
        })
    }

    async deleteFeed(listId: string): Promise<List> {
        const list = await this.getList(listId)
        if (list.ownerDid != this.ownerDid) {
            throw new ForbiddenError("Forbidden: this list belongs to someone else")
        }
        return await this.ctx.db.transaction().execute(async (trx) => {

            await trx.deleteFrom('membership').where('listId', '=', listId).execute()
            await trx.deleteFrom('list').where('id', '=', listId).execute()

            if (this.isProduction) {
                await this.agent.api.com.atproto.repo.deleteRecord({
                    repo: this.ownerDid,
                    collection: ids.AppBskyFeedGenerator,
                    rkey: list.id,
                })
            }
            return list
        })
    }

    async getList(listId: string): Promise<List> {
        const list = await this.ctx.db.selectFrom('list')
            .selectAll()
            .where('id', '=', listId)
            .limit(1)
            .executeTakeFirstOrThrow()

        if (list.ownerDid !== this.ownerDid) {
            throw new ForbiddenError("Forbidden: this list belongs to someone else")
        }
        return list
    }

    get ownerHandle(): string {
        return this.agent.session!!.handle
    }

    get ownerDid(): string {
        return this.agent.session!!.did
    }

    get isProduction() {
        return process.env.NODE_ENV === 'production'
    }

    private async lookupHandleDids(handles: string[]): Promise<string[]> {
        return await Promise.all(
            handles.map(handle => lookupDid(handle, this.agent, this.ctx.handleCache))
        )
    }
}

export default ListManager
