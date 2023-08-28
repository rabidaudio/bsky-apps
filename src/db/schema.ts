import { type Generated } from 'kysely'

export interface DatabaseSchema {
  post: Post
  sub_state: SubState
  membership: Membership
  list: List
}

export interface List {
  id: string
  ownerDid: string
  name: string
  isPublic: boolean
  createdAt: Date
}

export interface Membership {
  id: Generated<number>
  memberDid: string
  listId: string
}

export interface Post {
  uri: string
  cid: string
  author: string
  replyParent: string | null
  replyRoot: string | null
  indexedAt: string
}

export interface SubState {
  service: string
  cursor: number
}
