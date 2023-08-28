import { AtUri } from '@atproto/uri'
import {
  QueryParams,
  OutputSchema as AlgoOutput,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'

import { AppContext } from '../config'
import { createHandler } from './list-feed'
import { getUri } from '../util/membership'

export type AlgoHandler = (ctx: AppContext, params: QueryParams, requesterDid: string | null) => Promise<AlgoOutput>

export const getFeedHandler = async (ctx: AppContext, rkey: string): Promise<AlgoHandler | undefined> => {
  return createHandler(rkey)
}

export const getAllFeedUris = async (ctx: AppContext): Promise<AtUri[]> => {
  const res = await ctx.db.selectFrom('list').select(['id', 'ownerDid']).limit(ctx.cfg.maxTotalLists).execute()
  return res.map(list => getUri(list))
}
