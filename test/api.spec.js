const { expect } = require('chai')
const sinon = require("sinon")
const request = require("supertest")

const { FeedGenerator } = require('../src/server')
const { loadConfig } = require("../src/config")
const { createDb, migrateToLatest } = require('../src/db')

/*
    ownerHandle: string
    ownerDid: string

    resolveHandle(handle: string): Promise<string>
    resolveDid(did: string): Promise<string>
    
    putRepo(data: ComAtprotoRepoPutRecord.InputSchema): Promise<void>
    deleteRepo(data: ComAtprotoRepoDeleteRecord.InputSchema): Promise<void>
*/

const cfg = loadConfig()

// Create a database which cleans up at the end of the test by running the test in a transaction and rolling back
async function withDb(handler) {
    const db = createDb("postgres://localhost:5432/bsky-apps-test")
    await migrateToLatest(db)
    try {
        await db.transaction().execute(async (trx) => {
            let errored = false
            try {
                await handler(trx)
            } catch (err) {
                errored = true
                throw err
            } finally {
                if (!errored) throw new Error("rollback")
            }
        })
    } catch (err) {
        if (err.message !== 'rollback') throw err
    }
}

const ownerHandle = "rabid.audio"
const ownerDid = "did:plc:deoph4eyrdzjl7fxh6z6gbqg"

async function createList(db, id, name, isPublic, memberDids) {
    const list = await db.insertInto('list')
        .values({ id, ownerDid, name, isPublic })
        .returningAll()
        .executeTakeFirstOrThrow()
    
    await db.insertInto('membership')
        .values(memberDids.map(memberDid => ({ listId: list.id, memberDid })))
        .execute()
}

function createServer(db, mockAtp) {
    return FeedGenerator.create({
        cfg, db,
        handleCache: null,
        atpFactory: async (loginOpts) => mockAtp
    }).app
}

describe("API", () => {
    describe("GET /api/lists", () => {
        it("should return all the lists a user has", async () => {
            await withDb(async (db) => {
                // setup
                await createList(db, "14b5b3df0b00e4c", "Public List", true, ["did:plc:o4wdtqgal63rsxiufwkuajzf"])
                await createList(db, "99cfc30eec998e7", "Private List", false, ["did:plc:o4wdtqgal63rsxiufwkuajzf", ownerDid])
                const app = createServer(db, {
                    ownerHandle,
                    ownerDid,
                    resolveHandle: async (handle) => ({
                        "did:plc:o4wdtqgal63rsxiufwkuajzf": "kathebooks.bsky.social",
                        [ownerDid]: ownerHandle
                    }[handle])
                })
                
                const response = await request(app)
                    .get("/api/lists")
                    .set('Content-Type', 'application/json')
                    .set('Accept', 'application/json')
                    .send({ identifier: ownerHandle, password: 'fake-password' })
                
                expect(response.status).to.eq(200)
                expect(response.body.type).to.eq('data')
                expect(response.body.status).to.eq('FOUND')

                expect(response.body.data[0].id).to.match(/^[a-f0-9]{15}$/)
                expect(response.body.data[0].name).to.eq('Public List')
                expect(response.body.data[0].isPublic).to.eq(true)
                expect(response.body.data[0].uri).not.to.be.empty
                expect(response.body.data[0].createdAt).not.to.be.empty
                expect(response.body.data[0].memberHandles).to.contain("kathebooks.bsky.social")

                expect(response.body.data[1].id).to.match(/^[a-f0-9]{15}$/)
                expect(response.body.data[1].name).to.eq('Private List')
                expect(response.body.data[1].isPublic).to.eq(false)
                expect(response.body.data[1].uri).not.to.be.empty
                expect(response.body.data[1].createdAt).not.to.be.empty
                expect(response.body.data[1].memberHandles).to.contain("kathebooks.bsky.social")
                expect(response.body.data[1].memberHandles).to.contain("rabid.audio")
            })
        })
    })
    // describe("POST /lists")
    // describe("PUT /lists/:id")
    // describe("DELETE /lists/:id")

    // context("not authenticated")
    // context("invalid credentials")
})
