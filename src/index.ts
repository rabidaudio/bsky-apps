import dotenv from 'dotenv'
import FeedGenerator from './server'
import { Config } from './config'

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
    publisherDid:
      maybeStr(process.env.FEEDGEN_PUBLISHER_DID) ?? 'did:example:alice',
    subscriptionReconnectDelay:
      maybeInt(process.env.FEEDGEN_SUBSCRIPTION_RECONNECT_DELAY) ?? 3000,
    hostname,
    serviceDid,
    retainHistoryHours: maybeInt(process.env.FEEDGEN_RETAIN_HISTORY_HOURS) ?? 48,
  }
}

const run = async () => {
  const server = FeedGenerator.create(loadConfig())
  await server.start()
  console.log(
    `🤖 running feed generator at http://${server.cfg.listenHost}:${server.cfg.port}`,
  )
}

const maybeStr = (val?: string) => {
  if (!val) return undefined
  return val
}

const maybeInt = (val?: string) => {
  if (!val) return undefined
  const int = parseInt(val, 10)
  if (isNaN(int)) return undefined
  return int
}

run()
