import type http from 'http'
import events from 'events'
import express from 'express'
import path from 'path'

import { DidResolver, MemoryCache } from '@atproto/identity'
import { createServer } from './lexicon'
import feedGeneration from './methods/feed-generation'
import describeGenerator from './methods/describe-generator'

import { type Database, migrateToLatest } from './db'
import { FirehoseSubscription } from './subscription'
import { type AppContext, type Config, type Dependencies } from './config'
import wellKnown from './well-known'
import apiEndpoints from './api'

export class FeedGenerator {
  public app: express.Application
  public server?: http.Server
  public db: Database
  public firehose: FirehoseSubscription
  public cfg: Config

  constructor (
    app: express.Application,
    db: Database,
    firehose: FirehoseSubscription,
    cfg: Config
  ) {
    this.app = app
    this.db = db
    this.firehose = firehose
    this.cfg = cfg
  }

  static create (deps: Dependencies): FeedGenerator {
    const app = express()
    const firehose = new FirehoseSubscription(deps.db, deps.cfg.subscriptionEndpoint, deps.cfg.retainHistoryHours)

    const didCache = new MemoryCache()
    const didResolver = new DidResolver({
      plcUrl: 'https://plc.directory',
      didCache
    })

    const server = createServer({
      validateResponse: true,
      payload: {
        jsonLimit: 100 * 1024, // 100kb
        textLimit: 100 * 1024, // 100kb
        blobLimit: 5 * 1024 * 1024 // 5mb
      }
    })
    const ctx: AppContext = {
      ...deps,
      didResolver
    }
    feedGeneration(server, ctx)
    describeGenerator(server, ctx)
    app.use(server.xrpc.router)
    app.use('/api', apiEndpoints(ctx))
    app.use(wellKnown(ctx))
    app.use(express.static(path.join(__dirname, 'frontend')))
    // Log errors
    app.use((err, req, res, next) => {
      console.error(err.stack)
      next(err)
    })

    return new FeedGenerator(app, deps.db, firehose, deps.cfg)
  }

  get host (): string {
    return `http://${this.cfg.listenHost}:${this.cfg.port}`
  }

  async start (): Promise<http.Server> {
    await migrateToLatest(this.db)
    this.firehose.run(this.cfg.subscriptionReconnectDelay).catch((err) => {
      console.error('Firehose crashed', err)
      process.exit(1)
    })
    this.server = this.app.listen(this.cfg.port)
    await events.once(this.server, 'listening')
    return this.server
  }
}

export default FeedGenerator
