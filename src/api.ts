import express, { Request, Response, NextFunction, Router, RequestHandler } from 'express'
import { NoResultError } from 'kysely'

import { AtpAgent } from '@atproto/api'

import { AppContext } from './config'
import ListManager, { ForbiddenError } from './util/membership'
import { InvalidHandleError } from './util/handle'


class UnauthenticatedError extends Error {}
class BadFormatError extends Error {}

type StatusError = Error & { status: number }

const renderErrors = (error: Error, req: Request, res: Response, next: NextFunction) => {
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
    } else if ((error as StatusError).status) {
        res.status((error as StatusError).status)
    } else {
        res.status(500)
    }
    res.json({
        type: 'error',
        error: {
            message: error.message
        }
    })
}

// Since ATP decided to use Express instead of Koa, there's some hacky stuff to be able to
// use async-await
const wrapAsync = (handler: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    (req: Request, res: Response, next: NextFunction) => handler(req, res).then(next).catch(next)

export type ListResponse = {
    id: string
    uri: string
    name: string
    isPublic: boolean
    memberHandles: string[]
}

export default function makeRouter (ctx: AppContext): Router {
    var router = express.Router()

    const authenticate = (req: Request, res: Response, next: NextFunction) => {
        const { identifier, password } = req.body
        if (!identifier || !password) {
            throw new UnauthenticatedError('Credentials required')
        }
        const agent = new AtpAgent({ service: 'https://bsky.social' })
        agent.login({ identifier, password }).then(res => {
            if (!res.success) {
                throw new UnauthenticatedError('Credentials invalid')
            }
            (res as any).agent = agent
            next()
        }).catch(next)
    }

    const listEndpoint = (handler: (req: Request, res: Response, listManager: ListManager) => Promise<void>): RequestHandler =>
        wrapAsync((req, res) => {
            const agent: AtpAgent = (req as any).agent
            const manager = new ListManager(ctx, agent)
            return handler(req, res, manager)
        })
        
    router.use(renderErrors, authenticate)
    
    // return the list(s) a user has created and its members
    router.get('/lists', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
        const lists = await manager.getLists()

        res.status(200).json({
            type: 'data',
            status: 'FOUND',
            data: lists,
        })
    }))

    router.post('/lists', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
        const { name, isPublic, memberHandles } = req.body
        // And this is the practical limitation of typescript. There's no actual runtime checking, so you end
        // up manually writing all this validation logic. This stuff should be declarative.
        if (!name || typeof(name) !== 'string') {
            throw new BadFormatError("Invalid argument: name")
        }
        if (isPublic !== true && isPublic !== false) {
            throw new BadFormatError("Invalid argument: isPublic")
        }
        if (!Array.isArray(memberHandles) || memberHandles.length < 1) {
            throw new BadFormatError("Invalid argument: memberHandles")
        }
        if (memberHandles.length > ctx.cfg.listSizeLimit) {
            throw new BadFormatError(`Invalid argument: memberHandles. Lists are limited to ${this.sizeLimit} members`)
        }
        
        const list = await manager.createFeed(name, isPublic, memberHandles)

        res.status(200).json({
            type: 'data',
            status: 'CREATED',
            data: list,
        })
    }))

    router.put('/lists/:id', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
        const { name, isPublic, memberHandles } = req.body
        if (name !== undefined && typeof name !== "string") {
            throw new BadFormatError("Invalid argument: name")
        }
        if (isPublic !== undefined && isPublic !== true && isPublic !== false) {
            throw new BadFormatError("Invalid argument: isPublic")
        }
        if (!Array.isArray(memberHandles) || memberHandles.length < 1) {
            throw new BadFormatError("Invalid argument: memberHandles")
        }
        if (memberHandles.length > ctx.cfg.listSizeLimit) {
            throw new BadFormatError(`Invalid argument: memberHandles. Lists are limited to ${this.sizeLimit} members`)
        }

        const list = await manager.updateFeed(req.params.id, name, isPublic, memberHandles)
        res.status(200).json({
            type: 'data',
            status: 'UPDATED',
            data: list,
        })
    }))

    router.delete('/lists/:id', listEndpoint(async (req: Request, res: Response, manager: ListManager) => {
        const list = await manager.deleteFeed(req.params.id)
        res.status(200).json({
            type: 'data',
            status: 'DELETED',
            data: list,
        })
    }))

    return router
}
