import { AtUri } from '@atproto/uri'
import {
  QueryParams,
  OutputSchema as AlgoOutput,
} from '../lexicon/types/app/bsky/feed/getFeedSkeleton'

import { AppContext } from '../config'
import { createHandler } from './list-feed'
import { getUri } from '../util/membership'

type AlgoHandler = (ctx: AppContext, params: QueryParams) => Promise<AlgoOutput>

export const getFeedHandler = async (ctx: AppContext, rkey: string): Promise<AlgoHandler | undefined> => {
  return createHandler(rkey)
}

export const getAllFeedUris = async (ctx: AppContext): Promise<AtUri[]> => {
  const res = await ctx.db.selectFrom('list').select(['id', 'ownerDid']).limit(1000).execute()
  return res.map(list => getUri(list))
}
