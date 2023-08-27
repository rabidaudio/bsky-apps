export type DatabaseSchema = {
  post: Post
  sub_state: SubState
  membership: Membership
}

export type Membership = {
  // id: number
  ownerDid: string
  memberDid: string
  listId: number
}

export type Post = {
  uri: string
  cid: string
  author: string
  replyParent: string | null
  replyRoot: string | null
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}
