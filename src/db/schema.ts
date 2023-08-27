export type DatabaseSchema = {
  post: Post
  sub_state: SubState
  membership: Membership
  list: List
}

export type List = {
  id: string
  ownerDid: string
  name: string
  isPublic: boolean
}

export type Membership = {
  memberDid: string
  listId: string
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
