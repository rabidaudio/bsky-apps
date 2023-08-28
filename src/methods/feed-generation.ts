import { InvalidRequestError } from '@atproto/xrpc-server'
import { AtUri } from '@atproto/uri'

import { Server } from '../lexicon'
import { validateAuth } from '../auth'

import { AppContext } from '../config'
import { getFeedHandler } from '../algos'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.getFeedSkeleton(async ({ params, req }) => {
    const feedUri = new AtUri(params.feed)
    const algo = await getFeedHandler(ctx, feedUri.rkey)
    if (
      // feedUri.hostname !== ctx.cfg.publisherDid ||
      feedUri.collection !== 'app.bsky.feed.generator' ||
      !algo
    ) {
      throw new InvalidRequestError(
        'Unsupported algorithm',
        'UnsupportedAlgorithm',
      )
    }
    const requesterDid = req.headers.authorization ? (await validateAuth(req, ctx.cfg.serviceDid, ctx.didResolver)) : null
    const body = await algo(ctx, params, requesterDid)
    return {
      encoding: 'application/json',
      body: body,
    }
  })
}
