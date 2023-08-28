import { AtpAgent, AtpAgentLoginOpts, ComAtprotoRepoDeleteRecord, ComAtprotoRepoPutRecord } from '@atproto/api'

import { HandleCache } from './handle'

export class InvalidHandleError extends Error {}

export interface Atp {
    ownerHandle: string
    ownerDid: string

    resolveHandle(handle: string): Promise<string>
    resolveDid(did: string): Promise<string>
    
    putRepo(data: ComAtprotoRepoPutRecord.InputSchema): Promise<void>
    deleteRepo(data: ComAtprotoRepoDeleteRecord.InputSchema): Promise<void>
}

// A constructor for Atp implementations. Since the login info is unique per-request,
// we need to construct a new one for each request. However, the factory can be in Dependencies.
// Returns null if the credentials are invalid
export type AtpFactory = (loginInfo: AtpAgentLoginOpts) => Promise<Atp | null>

// Real implementation of Atp interface for use in app. Put in `readOnly` for development environments
export class AtpApi implements Atp {
    static async create(
        loginInfo: AtpAgentLoginOpts,
        {
            readOnly = false,
            handleCache = null,
            service = 'https://bsky.social',
        }: { readOnly?: boolean, handleCache?: HandleCache | null, service?: string }
    ): Promise<Atp | null> {
        const agent = new AtpAgent({ service })

        const res = await agent.login(loginInfo)
        if (!res.success) return null
        return new AtpApi(agent, readOnly, handleCache)
    }

    constructor(
        private agent: AtpAgent,
        public readOnly?: boolean,
        private handleCache?: HandleCache | null
    ) { }

    get ownerHandle(): string {
        return this.agent.session!!.handle
    }

    get ownerDid(): string {
        return this.agent.session!!.did
    }

    async putRepo(data: ComAtprotoRepoPutRecord.InputSchema): Promise<void> {
        if (this.readOnly) return
        await this.agent.api.com.atproto.repo.putRecord(data)
    }

    async deleteRepo(data: ComAtprotoRepoDeleteRecord.InputSchema): Promise<void> {
        if (this.readOnly) return
        await this.agent.api.com.atproto.repo.deleteRecord(data)
    }

    async resolveHandle(handle: string): Promise<string> {
        const resolve = async () => {
            try {
                const res = await this.agent.resolveHandle({ handle })
                return res.data.did
            } catch (err) {
                throw new InvalidHandleError(`Unable to resolve handle "${handle}"`, { cause: err })
            }
        }
        if (this.handleCache) {
            return this.handleCache.fetchDid(handle, resolve)
        } else {
            return await resolve()
        }
    }

    async resolveDid(did: string): Promise<string> {
        const resolve = async () => {
            const res = await this.agent.api.app.bsky.actor.getProfile({ actor: did })
            return res.data.handle
        }
        if (this.handleCache) {
            return this.handleCache.fetchHandle(did, resolve)
        } else {
            return await resolve()
        }
    }
}
