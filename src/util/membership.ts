import crypto from 'crypto'

import { AtUri, AtpAgent, AtpAgentLoginOpts } from '@atproto/api'
import { ids } from '../lexicon/lexicons'

import { Dependencies } from '../config'
import { List } from '../db/schema'

export function getUri(list: { ownerDid: string, id: string }): AtUri {
    return AtUri.make(list.ownerDid, 'app.bsky.feed.generator', list.id)
}

function generateUniqueListId(): string {
    // list names can be up to 15 lowercase chars. Here we generate random ids for these lists.
    // https://atproto.com/specs/record-key
    // log2(16^15) = 60 bits = 7.5 bytes
    // 50% probability of collision at sqrt(16^15) ~= 1 billion lists
    return crypto.randomBytes(8).toString('hex').toLowerCase().substring(0, 15)
}

export class ListManager {
    public agent: AtpAgent

    constructor(public ctx: Dependencies, public loginCreds: AtpAgentLoginOpts) {
        this.agent = new AtpAgent({ service: 'https://bsky.social' })
    }

    // Creates the list in the database and also publishes it to BlueSky
    async createFeed(name: string, isPublic: boolean, memberHandles: string[]): Promise<List> {
        await this.ensureLoggedIn()
    
        // run all this in a transaction so if the upstream calls fail the db is rolled back
        return await this.ctx.db.transaction().execute(async (trx) => {
            // create the list in the database
            const list = await trx.insertInto('list')
                .values({ id: generateUniqueListId(), ownerDid: this.ownerDid!!, name, isPublic })
                .returningAll()
                .executeTakeFirstOrThrow()            
    
            // convert handles to dids and save members
            const memberDids = await this.lookupHandleDids(memberHandles)
            await trx.insertInto('membership')
                .values(memberDids.map(memberDid => ({ listId: list.id, memberDid })))
                .execute()
    
            // try {
            //     await this.agent.api.app.bsky.feed.describeFeedGenerator()
            // } catch (err) {
            //     throw new Error('The bluesky server is not ready to accept published custom feeds yet')
            // }
    
            if (process.env.NODE_ENV === 'production') {
                await this.agent.api.com.atproto.repo.putRecord({
                    repo: this.ownerDid ?? '',
                    collection: ids.AppBskyFeedGenerator,
                    rkey: list.id,
                    record: {
                        did: this.ctx.cfg.serviceDid,
                        displayName: list.name,
                        description: `A custom list feed for ${this.loginCreds.identifier}, generated using ${this.ctx.cfg.hostname}`,
                        // avatar: avatarRef, // TODO: add images to feeds
                        createdAt: new Date().toISOString(),
                    },
                })
            }
            
            return list
        })
    }

    async updateFeed(listId: string, name: string | undefined, isPublic: boolean | undefined, memberHandles: string[]): Promise<List> {
        let list = await this.getList(listId)
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
            
            if (name !== undefined && process.env.NODE_ENV === 'production') {
                // update the name on the api
                await this.agent.api.com.atproto.repo.putRecord({
                    repo: this.agent.session?.did ?? '',
                    collection: ids.AppBskyFeedGenerator,
                    rkey: list.id,
                    record: {
                        did: this.ctx.cfg.serviceDid,
                        displayName: list.name,
                    },
                })
            }

            return list
        })
    }

    async deleteFeed(listId: string): Promise<List> {
        const list = await this.getList(listId)
        return await this.ctx.db.transaction().execute(async (trx) => {

            await trx.deleteFrom('membership').where('listId', '=', listId).execute()
            await trx.deleteFrom('list').where('id', '=', listId).execute()

            if (process.env.NODE_ENV === 'production') {
                await this.agent.api.com.atproto.repo.deleteRecord({
                    repo: this.ownerDid ?? '',
                    collection: ids.AppBskyFeedGenerator,
                    rkey: list.id,
                })
            }
            return list
        })
    }

    async getList(listId: string): Promise<List> {
        await this.ensureLoggedIn()
        const list = await this.ctx.db.selectFrom('list')
            .selectAll()
            .where('id', '=', listId)
            .limit(1)
            .executeTakeFirstOrThrow()

        if (list.ownerDid !== this.ownerDid) {
            throw new Error("Permission denied")
        }
        return list
    }

    async ensureLoggedIn() {
        if (!this.agent.hasSession) {
            await this.agent.login(this.loginCreds)
        }
    }

    get ownerHandle(): string {
        return this.loginCreds.identifier
    }

    get ownerDid(): string | undefined {
        return this.agent.session?.did
    }

    get sizeLimit() {
        return this.ctx.cfg.listSizeLimit
    }

    // TODO: should we cache these lookups?
    async lookupHandleDids(handles: string[]): Promise<string[]> {
        if (handles.length === 0) throw new Error("Lists cannot be empty")
        if (handles.length > this.sizeLimit) throw new Error(`Lists are limited to ${this.sizeLimit} members`)

        await this.ensureLoggedIn()
        const responses = await Promise.all(handles.map(handle => {
            return this.agent.resolveHandle({ handle }).catch(err => {
                throw new Error(`Unable to resolve handle "${handle}"`, { cause: err })
            })
        }))
        return responses.map(res => res.data.did)
    }
}

export default ListManager
