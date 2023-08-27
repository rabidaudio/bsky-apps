import { InvalidRequestError } from '@atproto/xrpc-server'
import { QueryParams, OutputSchema as AlgoOutput } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'
import { AppContext } from '../config'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

export const createHandler = (listId: number): AlgoHandler => {
  return async (ctx: AppContext, params: QueryParams) => {
    const ownerDid = ctx.requesterDid
    if (!ownerDid) {
      throw new InvalidRequestError('not authenticated')
    }

    // TODO: check if owner has made a list and return a helpful error message instead of an empty
    // timeline

    let builder = ctx.db
      .selectFrom('post')
      .selectAll()
      .innerJoin('membership', 'membership.memberDid', 'post.author')
      .where('membership.listId', '=', listId)
      .where('membership.ownerDid', '=', ownerDid)
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
