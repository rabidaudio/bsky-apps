import dayjs from 'dayjs'

import { Subscription } from '@atproto/xrpc-server'
import { cborToLexRecord, readCar } from '@atproto/repo'
import { BlobRef } from '@atproto/lexicon'
import { ids, lexicons } from '../lexicon/lexicons'
import { type Record as PostRecord } from '../lexicon/types/app/bsky/feed/post'
import { type Record as RepostRecord } from '../lexicon/types/app/bsky/feed/repost'
import { type Record as LikeRecord } from '../lexicon/types/app/bsky/feed/like'
import { type Record as FollowRecord } from '../lexicon/types/app/bsky/graph/follow'
import {
  type Commit,
  type OutputSchema as RepoEvent,
  isCommit
} from '../lexicon/types/com/atproto/sync/subscribeRepos'

import { type Database } from '../db'

const delay = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export abstract class FirehoseSubscriptionBase {
  public sub: Subscription<RepoEvent>

  constructor (public db: Database, public service: string, public retainHours: number) {
    this.sub = new Subscription({
      service,
      method: ids.ComAtprotoSyncSubscribeRepos,
      getParams: async () => await this.getCursor(),
      validate: (value: unknown) => {
        try {
          return lexicons.assertValidXrpcMessage<RepoEvent>(
            ids.ComAtprotoSyncSubscribeRepos,
            value
          )
        } catch (err) {
          console.error('repo subscription skipped invalid message', err)
        }
      }
    })
  }

  abstract handleEvent (evt: RepoEvent): Promise<void>

  async run (subscriptionReconnectDelay: number): Promise<void> {
    try {
      for await (const evt of this.sub) {
        try {
          await this.handleEvent(evt)
        } catch (err) {
          console.error('repo subscription could not handle message', err)
        }
        // update stored cursor every 20 events or so
        if (isCommit(evt) && evt.seq % 20 === 0) {
          await this.updateCursor(evt.seq)

          // also wipe old posts
          await this.truncateToMostRecent()
        }
      }
    } catch (err) {
      console.error('repo subscription errored', err)
      await delay(subscriptionReconnectDelay)
      await this.run(subscriptionReconnectDelay)
    }
  }

  async truncateToMostRecent (): Promise<void> {
    const retainSince = dayjs().subtract(this.retainHours, 'hours')
    await this.db.deleteFrom('post')
      .where('indexedAt', '<', retainSince.toISOString())
      .execute()
  }

  async updateCursor (cursor: number): Promise<void> {
    await this.db
      .updateTable('sub_state')
      .set({ cursor })
      .where('service', '=', this.service)
      .execute()
  }

  async getCursor (): Promise<{ cursor?: number }> {
    const res = await this.db
      .selectFrom('sub_state')
      .selectAll()
      .where('service', '=', this.service)
      .executeTakeFirst()
    return res !== undefined ? { cursor: res.cursor } : {}
  }
}

export const getOpsByType = async (evt: Commit): Promise<OperationsByType> => {
  const car = await readCar(evt.blocks)
  const opsByType: OperationsByType = {
    posts: { creates: [], deletes: [] },
    reposts: { creates: [], deletes: [] },
    likes: { creates: [], deletes: [] },
    follows: { creates: [], deletes: [] }
  }

  for (const op of evt.ops) {
    const uri = `at://${evt.repo}/${op.path}`
    const [collection] = op.path.split('/')

    if (op.action === 'update') continue // updates not supported yet

    if (op.action === 'create') {
      if (op.cid === null) continue
      const recordBytes = car.blocks.get(op.cid)
      if (recordBytes === undefined) continue
      const record = cborToLexRecord(recordBytes)
      const create = { uri, cid: op.cid.toString(), author: evt.repo }
      if (collection === ids.AppBskyFeedPost && isPost(record)) {
        opsByType.posts.creates.push({ record, ...create })
      } else if (collection === ids.AppBskyFeedRepost && isRepost(record)) {
        opsByType.reposts.creates.push({ record, ...create })
      } else if (collection === ids.AppBskyFeedLike && isLike(record)) {
        opsByType.likes.creates.push({ record, ...create })
      } else if (collection === ids.AppBskyGraphFollow && isFollow(record)) {
        opsByType.follows.creates.push({ record, ...create })
      }
    }

    if (op.action === 'delete') {
      if (collection === ids.AppBskyFeedPost) {
        opsByType.posts.deletes.push({ uri })
      } else if (collection === ids.AppBskyFeedRepost) {
        opsByType.reposts.deletes.push({ uri })
      } else if (collection === ids.AppBskyFeedLike) {
        opsByType.likes.deletes.push({ uri })
      } else if (collection === ids.AppBskyGraphFollow) {
        opsByType.follows.deletes.push({ uri })
      }
    }
  }

  return opsByType
}

interface OperationsByType {
  posts: Operations<PostRecord>
  reposts: Operations<RepostRecord>
  likes: Operations<LikeRecord>
  follows: Operations<FollowRecord>
}

interface Operations<T = Record<string, unknown>> {
  creates: Array<CreateOp<T>>
  deletes: DeleteOp[]
}

interface CreateOp<T> {
  uri: string
  cid: string
  author: string
  record: T
}

interface DeleteOp {
  uri: string
}

export const isPost = (obj: unknown): obj is PostRecord => {
  return isType(obj, ids.AppBskyFeedPost)
}

export const isRepost = (obj: unknown): obj is RepostRecord => {
  return isType(obj, ids.AppBskyFeedRepost)
}

export const isLike = (obj: unknown): obj is LikeRecord => {
  return isType(obj, ids.AppBskyFeedLike)
}

export const isFollow = (obj: unknown): obj is FollowRecord => {
  return isType(obj, ids.AppBskyGraphFollow)
}

const isType = (obj: unknown, nsid: string): boolean => {
  try {
    lexicons.assertValidRecord(nsid, fixBlobRefs(obj))
    return true
  } catch (err) {
    return false
  }
}

// @TODO right now record validation fails on BlobRefs
// simply because multiple packages have their own copy
// of the BlobRef class, causing instanceof checks to fail.
// This is a temporary solution.
const fixBlobRefs = (obj: unknown): unknown => {
  if (Array.isArray(obj)) {
    return obj.map(fixBlobRefs)
  }
  if (obj !== undefined && obj !== null && typeof obj === 'object') {
    if (obj.constructor.name === 'BlobRef') {
      const blob = obj as BlobRef
      return new BlobRef(blob.ref, blob.mimeType, blob.size, blob.original)
    }
    return Object.entries(obj).reduce<Record<string, unknown>>((acc, [key, val]) => {
      return Object.assign(acc, { [key]: fixBlobRefs(val) })
    }, {})
  }
  return obj
}
