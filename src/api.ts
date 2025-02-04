import express, { type Request, type Response, type NextFunction, type Router, type RequestHandler } from 'express'
import bodyParser from 'body-parser'
import * as basicAuth from 'basic-auth'
import { NoResultError } from 'kysely'

import { type AppContext } from './config'
import ListManager, { ForbiddenError } from './util/membership'
import { type Atp, InvalidHandleError } from './util/atp'

class UnauthenticatedError extends Error {}
class BadFormatError extends Error {}

export interface ListResponse {
  id: string
  uri: string
  name: string | null
  description: string | null
  isPublic: boolean
  includeReplies: boolean
  memberHandles: string[]
  createdAt: Date
}

export default function makeRouter (ctx: AppContext): Router {
  const router = express.Router()
  router.use(bodyParser.json())

  // Since ATP decided to use Express instead of Koa, there's some hacky stuff to be able to
  // use async-await
  const authenticate = (handler: (req: Request, res: Response, api: Atp) => Promise<void>): RequestHandler =>
    (req: Request, res: Response, next: NextFunction) => {
      if (!('authorization' in req.headers)) {
        throw new UnauthenticatedError('Credentials required')
      }
      const auth = basicAuth.parse(req.headers.authorization)
      if (auth === undefined) {
        throw new UnauthenticatedError('Credential parse error')
      }
      ctx.atpFactory({ identifier: auth.name, password: auth.pass }).then(async api => {
        if (api === null) {
          throw new UnauthenticatedError('Credentials invalid')
        }
        await handler(req, res, api)
      }).catch(next)
    }

  const listEndpoint = (handler: (req: Request, res: Response, listManager: ListManager) => Promise<void>): RequestHandler =>
    authenticate(async (req, res, api) => { await handler(req, res, new ListManager(ctx, api)) })

  // return the list(s) a user has created and its members
  router.get('/lists', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
    const lists = await manager.getLists()

    res.status(200).json({
      type: 'data',
      status: (lists.length === 0 ? 'NONE_FOUND' : 'FOUND'),
      data: lists
    })
  }))

  router.post('/lists', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
    const { name, description, isPublic, includeReplies, memberHandles } = req.body
    // And this is the practical limitation of typescript. There's no actual runtime checking, so you end
    // up manually writing all this validation logic. This stuff should be declarative.
    if (name === undefined || typeof (name) !== 'string') {
      throw new BadFormatError('Invalid argument: name')
    }
    if (description !== null && typeof description !== 'string') {
      throw new BadFormatError('Invalid argument: description')
    }
    if (isPublic !== true && isPublic !== false) {
      throw new BadFormatError('Invalid argument: isPublic')
    }
    if (includeReplies !== true && includeReplies !== false) {
      throw new BadFormatError('Invalid argument: includeReplies')
    }
    if (!Array.isArray(memberHandles) || memberHandles.length < 1) {
      throw new BadFormatError('Invalid argument: memberHandles')
    }
    if (memberHandles.length > ctx.cfg.listSizeLimit) {
      throw new BadFormatError(`Invalid argument: memberHandles. Lists are limited to ${ctx.cfg.listSizeLimit} members`)
    }
    const list = await manager.createFeed(name, description, isPublic, includeReplies, memberHandles)

    res.status(200).json({
      type: 'data',
      status: 'CREATED',
      data: list
    })
  }))

  router.put('/lists/:id', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
    const { name, description, isPublic, memberHandles } = req.body
    if (name !== undefined && typeof name !== 'string') {
      throw new BadFormatError('Invalid argument: name')
    }
    if (description !== undefined && description !== null && typeof description !== 'string') {
      throw new BadFormatError('Invalid argument: description')
    }
    if (isPublic !== undefined && isPublic !== true && isPublic !== false) {
      throw new BadFormatError('Invalid argument: isPublic')
    }
    if (memberHandles !== undefined) {
      if (!Array.isArray(memberHandles) || memberHandles.length < 1) {
        throw new BadFormatError('Invalid argument: memberHandles')
      }
      if (memberHandles.length > ctx.cfg.listSizeLimit) {
        throw new BadFormatError(`Invalid argument: memberHandles. Lists are limited to ${ctx.cfg.listSizeLimit} members`)
      }
    }

    const list = await manager.updateFeed(req.params.id, { name, description, isPublic, memberHandles })
    res.status(200).json({
      type: 'data',
      status: 'UPDATED',
      data: list
    })
  }))

  router.delete('/lists/:id', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
    const list = await manager.deleteFeed(req.params.id)
    res.status(200).json({
      type: 'data',
      status: 'DELETED',
      data: list
    })
  }))

  const renderErrors = (error: Error, _req: Request, res: Response, _next: NextFunction): void => {
    if (error instanceof UnauthenticatedError) {
      res.status(401)
    } else if (error instanceof BadFormatError) {
      res.status(400)
    } else if (error instanceof NoResultError) {
      res.status(404)
    } else if (error instanceof InvalidHandleError) {
      res.status(404)
    } else if (error instanceof ForbiddenError) {
      res.status(403)
    } else if ('status' in error && typeof error.status === 'number') {
      res.status(error.status)
    } else {
      res.status(500)
    }
    if (ctx.cfg.logErrors) console.warn('API Error', res.statusCode, error)
    res.json({
      type: 'error',
      error: {
        message: error.message
      }
    })
  }
  router.use(renderErrors) // has to go last
  return router
}
