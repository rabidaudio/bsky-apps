import { InvalidRequestError } from '@atproto/xrpc-server'
import { Server } from '../lexicon'
import { AppContext } from '../config'
import { getFeedHandler } from '../algos'
import { validateAuth } from '../auth'
import { AtUri } from '@atproto/uri'

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
    if (req.headers.authorization) {
      ctx.requesterDid = await validateAuth(req, ctx.cfg.serviceDid, ctx.didResolver)
    }
    const body = await algo(ctx, params)
    return {
      encoding: 'application/json',
      body: body,
    }
  })
}
