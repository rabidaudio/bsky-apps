import { type Server } from '../lexicon'
import { type AppContext } from '../config'
import { getAllFeedUris } from '../algos'

export default function (server: Server, ctx: AppContext): void {
  server.app.bsky.feed.describeFeedGenerator(async () => {
    const feeds = (await getAllFeedUris(ctx)).map(uri => ({ uri: uri.toString() }))
    return {
      encoding: 'application/json',
      body: {
        did: ctx.cfg.serviceDid,
        feeds
      }
    }
  })
}
