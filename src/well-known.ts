import express, { type Router } from 'express'

import { type AppContext } from './config'

const makeRouter = (ctx: AppContext): Router => {
  const router = express.Router()

  router.get('/.well-known/did.json', (_req, res) => {
    if (!ctx.cfg.serviceDid.endsWith(ctx.cfg.hostname)) {
      return res.sendStatus(404)
    }
    res.json({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: ctx.cfg.serviceDid,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${ctx.cfg.hostname}`
        }
      ]
    })
  })

  return router
}
export default makeRouter
