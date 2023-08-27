import { InvalidRequestError } from '@atproto/xrpc-server'
import { QueryParams, OutputSchema as AlgoOutput } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

export const createHandler = (listId: string): AlgoHandler => {
  return async (ctx: AppContext, params: QueryParams) => {
    const list = await ctx.db.selectFrom('list')
      .selectAll()
      .where('id', '=', listId)
      .limit(1)
      .executeTakeFirst()

    if (!list) {
      throw new InvalidRequestError(`No list found: ${listId}`)
    }

    if (!list.isPublic) {
      const ownerDid = ctx.requesterDid
      if (!ownerDid) {
        throw new InvalidRequestError('Not authenticated')
      }
      if (ownerDid != list.ownerDid) {
        throw new InvalidRequestError('Permission denied')
      }
    }

    let builder = ctx.db
      .selectFrom('post')
      .selectAll()
      .innerJoin('membership', 'membership.memberDid', 'post.author')
      .where('membership.listId', '=', listId)
      .orderBy('indexedAt', 'desc')
      .orderBy('cid', 'desc')
      .limit(params.limit)
  
    if (params.cursor) {
      const [indexedAt, cid] = params.cursor.split('::')
      if (!indexedAt || !cid) {
        throw new InvalidRequestError('malformed cursor')
      }
      const timeStr = new Date(parseInt(indexedAt, 10)).toISOString()
      builder = builder
        .where('post.indexedAt', '<', timeStr)
        .orWhere((qb) => qb.where('post.indexedAt', '=', timeStr))
        .where('post.cid', '<', cid)
    }
    const res = await builder.execute()
  
    const feed = res.map((row) => ({
      post: row.uri,
    }))
  
    let cursor: string | undefined
    const last = res.at(-1)
    if (last) {
      cursor = `${new Date(last.indexedAt).getTime()}::${last.cid}`
    }
  
    return {
      cursor,
      feed,
    }
  }
}
