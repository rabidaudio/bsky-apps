import { InvalidRequestError } from '@atproto/xrpc-server'
import { type QueryParams } from '../lexicon/types/app/bsky/feed/getFeedSkeleton'

import { type AppContext } from '../config'
import { type AlgoHandler } from '.'

export const createHandler = (listId: string): AlgoHandler => {
  return async (ctx: AppContext, params: QueryParams, requesterDid: string | null) => {
    const list = await ctx.db.selectFrom('list')
      .selectAll()
      .where('id', '=', listId)
      .limit(1)
      .executeTakeFirst()

    if (list === undefined) {
      throw new InvalidRequestError(`No list found: ${listId}`)
    }

    if (!list.isPublic) {
      if (requesterDid === undefined) {
        throw new InvalidRequestError('This list is private and you are not authenticated')
      }
      if (requesterDid !== list.ownerDid) {
        throw new InvalidRequestError(`This list is private and belongs to someone else. You can ask them to make it public or create your own lists at ${ctx.cfg.hostname}`)
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

    if (!list.includeReplies) {
      // TODO: maybe allow replies if the parent is also in the list?
      // that is, display conversations between 2 members.
      // This works but it's got terrible performance:
      /*
        select post.*
        from post
        left join post as "parentPost" on post."replyParent" = "parentPost".uri
        inner join membership on membership."memberDid" = post.author
            or membership."memberDid" = "parentPost".author
        where membership."listId" = 'ec40775fdadf0a5'
        order by post."indexedAt" desc, post.cid desc
        limit 25
      */
      // IDK if it's possible to build an efficent or-based index here.
      // simply adding indexes to uri and replyParent didn't help.
      builder = builder.where('post.replyParent', 'is', null)
    }

    if (params.cursor !== undefined) {
      const [indexedAt, cid] = params.cursor.split('::')
      if (cid === undefined) {
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
      post: row.uri
    }))

    let cursor: string | undefined
    const last = res.at(-1)
    if (last !== undefined) {
      cursor = `${new Date(last.indexedAt).getTime()}::${last.cid}`
    }

    return {
      cursor,
      feed
    }
  }
}
