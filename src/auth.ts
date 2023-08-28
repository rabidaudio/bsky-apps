import type express from 'express'

import { verifyJwt, AuthRequiredError } from '@atproto/xrpc-server'
import { type DidResolver } from '@atproto/did-resolver'

export const validateAuth = async (
  req: express.Request,
  serviceDid: string,
  didResolver: DidResolver
): Promise<string> => {
  const { authorization = '' } = req.headers
  if (!authorization.startsWith('Bearer ')) {
    throw new AuthRequiredError()
  }
  const jwt = authorization.replace('Bearer ', '').trim()
  return await verifyJwt(jwt, serviceDid, async (did: string) => {
    return await didResolver.resolveAtprotoKey(did)
  })
}
