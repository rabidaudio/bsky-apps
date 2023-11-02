import dotenv from 'dotenv'

import { type DidResolver } from '@atproto/identity'

import { type Database, createDb } from './db'
import { HandleCache } from './util/handle'
import { AtpApi, type AtpFactory } from './util/atp'

export interface Dependencies {
  cfg: Config
  db: Database
  handleCache: HandleCache | null
  atpFactory: AtpFactory
}

export type AppContext = Dependencies & {
  didResolver: DidResolver
}

export interface Config {
  port: number
  listenHost: string
  hostname: string
  databaseUrl: string
  subscriptionEndpoint: string
  serviceDid: string
  subscriptionReconnectDelay: number
  retainHistoryHours: number
  listSizeLimit: number
  maxListsPerUser: number
  maxTotalLists: number
  logErrors: boolean
  handleCache: {
    max: number
    ttl: number
  }
}

export const loadConfig = (): Config => {
  dotenv.config()
  const hostname = maybeStr(process.env.FEEDGEN_HOSTNAME) ?? 'example.com'
  const serviceDid =
    maybeStr(process.env.FEEDGEN_SERVICE_DID) ?? `did:web:${hostname}`
  return {
    port: maybeInt(process.env.PORT) ?? 3000,
    listenHost: maybeStr(process.env.FEEDGEN_LISTENHOST) ?? 'localhost',
    databaseUrl: maybeStr(process.env.DATABASE_URL) ?? 'postgresql://localhost:5432/bsky-apps',
    subscriptionEndpoint:
      maybeStr(process.env.FEEDGEN_SUBSCRIPTION_ENDPOINT) ??
      'wss://bsky.social',
    // NOTE: removed as feeds belong to their creators
    // publisherDid:
    //   maybeStr(process.env.FEEDGEN_PUBLISHER_DID) ?? 'did:example:alice',
    subscriptionReconnectDelay:
      maybeInt(process.env.FEEDGEN_SUBSCRIPTION_RECONNECT_DELAY) ?? 3000,
    hostname,
    serviceDid,
    retainHistoryHours: maybeInt(process.env.FEEDGEN_RETAIN_HISTORY_HOURS) ?? (7 * 24),
    listSizeLimit: 50, // maximum number of members of a list
    maxListsPerUser: 5, // maximum number of lists a user can have
    maxTotalLists: 1000, // total number of lists across all users
    logErrors: true,
    handleCache: {
      max: 50_000,
      ttl: (7 * 24 * 60 * 60 * 1000) // make sure to re-resolve handles every week since people can update them
    }
  }
}

export const createDependencies = async (): Promise<Dependencies> => {
  const cfg = loadConfig()
  const db = createDb(cfg.databaseUrl)
  const handleCache = await HandleCache.create(cfg.handleCache)
  const atpFactory: AtpFactory = async (loginInfo) => await AtpApi.create(loginInfo, {
    readOnly: process.env.NODE_ENV !== 'production',
    handleCache
  })
  return { cfg, db, handleCache, atpFactory }
}

const maybeStr = (val?: string): string | undefined => {
  if (val === undefined || val.length === 0) return undefined
  return val
}

const maybeInt = (val?: string): number | undefined => {
  if (val === undefined || val.length === 0) return undefined
  const int = parseInt(val, 10)
  if (isNaN(int)) return undefined
  return int
}
