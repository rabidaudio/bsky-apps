import { Database } from './db'
import { DidResolver } from '@atproto/did-resolver'

export type AppContext = {
  db: Database
  didResolver: DidResolver
  cfg: Config
  requesterDid?: string
}

export type Config = {
  port: number
  listenHost: string
  hostname: string
  databaseUrl: string
  subscriptionEndpoint: string
  serviceDid: string
  publisherDid: string
  subscriptionReconnectDelay: number
  retainHistoryHours: number
}
