import { Server } from '../lexicon'
import { AppContext } from '../config'
import { getAllFeedUris } from '../algos'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.describeFeedGenerator(async () => {
    const feeds = (await getAllFeedUris(ctx)).map(uri => ({ uri: uri.toString() }))
    return {
      encoding: 'application/json',
      body: {
        did: ctx.cfg.serviceDid,
        feeds,
      },
    }
  })
}
