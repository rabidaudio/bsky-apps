const { expect } = require('chai')
const sinon = require("sinon")
const request = require("supertest")

const { FeedGenerator } = require('../src/server')
const { loadConfig } = require("../src/config")
const { createDb, migrateToLatest } = require('../src/db')
const { InvalidHandleError } = require('../src/util/atp')

const cfg = { ...loadConfig(), logErrors: false }

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
    } finally {
        await db.destroy()
    }
}

const ownerHandle = "rabid.audio"
const ownerDid = "did:plc:deoph4eyrdzjl7fxh6z6gbqg"
const resolveDid = async (handle) => ({
    "did:plc:o4wdtqgal63rsxiufwkuajzf": "kathebooks.bsky.social",
    [ownerDid]: ownerHandle,
}[handle])
const resolveHandle = async (handle) => ({
    "kathebooks.bsky.social": "did:plc:o4wdtqgal63rsxiufwkuajzf",
    [ownerHandle]: ownerDid
}[handle])


async function createList(db, id, name, isPublic, memberDids, owner = ownerDid) {
    const list = await db.insertInto('list')
        .values({ id, ownerDid: owner, name, isPublic })
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
                    resolveDid
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

    describe("POST /lists", () => {
        it('should create a new list', async () => {
            await withDb(async (db) => {
                const putRepo = sinon.spy(() => Promise.resolve())
                const app = createServer(db, {
                    ownerHandle,
                    ownerDid,
                    putRepo,
                    resolveHandle
                })

                const response = await request(app)
                    .post("/api/lists")
                    .set('Content-Type', 'application/json')
                    .set('Accept', 'application/json')
                    .send({
                        identifier: ownerHandle,
                        password: 'fake-password',
                        name: "My List",
                        isPublic: false,
                        memberHandles: ["kathebooks.bsky.social"],
                    })
                
                expect(response.status).to.eq(200)
                expect(response.body.type).to.eq('data')
                expect(response.body.status).to.eq('CREATED')
                expect(response.body.data.id).to.match(/^[a-f0-9]{15}$/)
                expect(response.body.data.name).to.eq('My List')
                expect(response.body.data.isPublic).to.eq(false)
                expect(response.body.data.memberHandles[0]).to.eq("kathebooks.bsky.social")

                const row = await db.selectFrom('list').selectAll()
                    .where('id', '=', response.body.data.id)
                    .executeTakeFirstOrThrow()

                expect(row.name).to.eq('My List')
                expect(row.isPublic).to.eq(false)
                expect(row.ownerDid).to.eq(ownerDid)

                expect(putRepo.calledOnce).to.be.true
            })
        })

        context("empty members", () => {
            it("should return bad format", async () => {
                await withDb(async (db) => {
                    const app = createServer(db, {})

                    const response = await request(app)
                        .post("/api/lists")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send({
                            identifier: ownerHandle,
                            password: 'fake-password',
                            name: "My List",
                            isPublic: false,
                            memberHandles: [],
                        })
                    expect(response.status).to.eq(400)
                    expect(response.body.type).to.eq('error')
                    expect(response.body.error.message).to.contain("Invalid argument: memberHandles")
                })
            })
        })

        context("too many members", () => {
            it("should return bad format", async () => {
                await withDb(async (db) => {
                    const app = createServer(db, {})

                    const response = await request(app)
                        .post("/api/lists")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send({
                            identifier: ownerHandle,
                            password: 'fake-password',
                            name: "My List",
                            isPublic: false,
                            memberHandles: new Array(200).map((_, i) => `user-${i}.bsky.social`),
                        })
                    expect(response.status).to.eq(400)
                    expect(response.body.type).to.eq('error')
                    expect(response.body.error.message).to.contain("Invalid argument: memberHandles. Lists are limited to 50 members")
                })
            })
        })

        context('invalid member handle', () => {
            it("should return not found", async () => {
                await withDb(async (db) => {
                    const putRepo = sinon.spy(() => Promise.resolve())
                    const app = createServer(db, {
                        ownerHandle,
                        ownerDid,
                        putRepo,
                        resolveHandle: (handle) => { throw new InvalidHandleError(`Unable to resolve handle "${handle}"`) }
                    })

                    const response = await request(app)
                        .post("/api/lists")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send({
                            identifier: ownerHandle,
                            password: 'fake-password',
                            name: "My List",
                            isPublic: false,
                            memberHandles: ["not-a-real-user.bsky.social"],
                        })
                    expect(response.status).to.eq(404)
                    expect(response.body.type).to.eq('error')
                    expect(response.body.error.message).to.contain("Unable to resolve handle")

                    expect(putRepo.called).to.be.false
                })
            })
        })      
    })

    describe("PUT /lists/:id", () => {
        it("should replace the list members", async () => {
            await withDb(async (db) => {
                await createList(db, "14b5b3df0b00e4c", "Public List", true, ["did:plc:o4wdtqgal63rsxiufwkuajzf"])
                const app = createServer(db, { ownerDid, ownerHandle, resolveDid, resolveHandle })

                const response = await request(app)
                    .put("/api/lists/14b5b3df0b00e4c")
                    .set('Content-Type', 'application/json')
                    .set('Accept', 'application/json')
                    .send({
                        identifier: ownerHandle,
                        password: 'fake-password',
                        memberHandles: ["rabid.audio"],
                    })
                
                expect(response.status).to.eq(200)
                expect(response.body.type).to.eq('data')
                expect(response.body.status).to.eq('UPDATED')
                expect(response.body.data.id).to.eq('14b5b3df0b00e4c')
                expect(response.body.data.memberHandles).to.include("rabid.audio")
                expect(response.body.data.memberHandles).not.to.include("kathebooks.bsky.social")

                const rows = await db.selectFrom('membership')
                    .select('memberDid')
                    .where('listId', '=', "14b5b3df0b00e4c")
                    .execute()
                expect(rows.length).to.eq(1)
                expect(rows[0].memberDid).to.eq(ownerDid)
            })
        })

        context("update name", () => {
            it("should save the new name", async () => {
                await withDb(async (db) => {
                    const putRepo = sinon.spy(() => Promise.resolve())
                    await createList(db, "14b5b3df0b00e4c", "Public List", true, ["did:plc:o4wdtqgal63rsxiufwkuajzf"])
                    const app = createServer(db, { ownerDid, ownerHandle, resolveDid, resolveHandle, putRepo })
    
                    const response = await request(app)
                        .put("/api/lists/14b5b3df0b00e4c")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send({
                            identifier: ownerHandle,
                            password: 'fake-password',
                            name: 'New Name',
                            isPublic: false
                        })
                    
                    expect(response.status).to.eq(200)
                    expect(response.body.type).to.eq('data')
                    expect(response.body.status).to.eq('UPDATED')
                    expect(response.body.data.id).to.eq('14b5b3df0b00e4c')
                    expect(response.body.data.name).to.eq('New Name')
                    expect(response.body.data.isPublic).to.eq(false)

                    expect(putRepo.calledOnce).to.be.true
                })
            })
        })

        // describe("belonging to someone else", () => {
        //     it("should raise forbidden", async () => {

        //     })
        // })
    })


    describe("DELETE /lists/:id", () => {

        it("should delete the list", async () => {
            await withDb(async (db) => {
                // setup
                await createList(db, "14b5b3df0b00e4c", "Public List", true, ["did:plc:o4wdtqgal63rsxiufwkuajzf"])
                const deleteRepo = sinon.spy(() => Promise.resolve())
                const app = createServer(db, {
                    ownerHandle,
                    ownerDid,
                    deleteRepo,
                    resolveDid,
                })

                const response = await request(app)
                    .delete("/api/lists/14b5b3df0b00e4c")
                    .set('Content-Type', 'application/json')
                    .set('Accept', 'application/json')
                    .send({ identifier: ownerHandle, password: 'fake-password' })

                expect(response.status).to.eq(200)
                expect(response.body.type).to.eq('data')
                expect(response.body.status).to.eq('DELETED')
                expect(response.body.data.id).to.eq('14b5b3df0b00e4c')

                const row = await db.selectFrom('list').selectAll()
                    .where('id', '=', '14b5b3df0b00e4c')
                    .executeTakeFirst()
                expect(row).to.be.undefined
                expect(deleteRepo.calledOnce).to.be.true
            })
        })

        describe("unknown id", () => {
            it('should return not found', async () => {
                await withDb(async (db) => {
                    const app = createServer(db, {})

                    const response = await request(app)
                        .delete("/api/lists/14b5b3df0b00e4c")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send({ identifier: ownerHandle, password: 'fake-password' })
                    expect(response.status).to.eq(404)
                    expect(response.body.type).to.eq('error')
                })
            })
        })

        describe("belonging to someone else", () => {
            it("should raise forbidden", async () => {
                await withDb(async (db) => {
                    await createList(db, "14b5b3df0b00e4c", "Public List", true, [ownerDid], "did:plc:o4wdtqgal63rsxiufwkuajzf")
                    const deleteRepo = sinon.spy(() => Promise.resolve())
                    const app = createServer(db, {
                        ownerHandle,
                        ownerDid,
                        deleteRepo,
                        resolveHandle,
                        resolveDid,
                    })

                    const response = await request(app)
                        .delete("/api/lists/14b5b3df0b00e4c")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send({ identifier: ownerHandle, password: 'fake-password' })
                    expect(response.status).to.eq(403)
                    expect(response.body.type).to.eq('error')
                    expect(response.body.error.message).to.contain("this list belongs to someone else")
                    
                    expect(deleteRepo.called).to.be.false
                })
            })
        })

        context("not authenticated", () => {
            it('should raise authenticated', async () => {
                await withDb(async (db) => {
                    // setup
                    await createList(db, "14b5b3df0b00e4c", "Public List", true, ["did:plc:o4wdtqgal63rsxiufwkuajzf"])
                    const deleteRepo = sinon.spy(() => Promise.resolve())
                    const app = createServer(db, {
                        ownerHandle,
                        ownerDid,
                        deleteRepo,
                        resolveDid,
                    })

                    const response = await request(app)
                        .delete("/api/lists/14b5b3df0b00e4c")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send()
                    expect(response.status).to.eq(401)
                    expect(response.body.type).to.eq('error')
                    expect(response.body.error.message).to.contain("Credentials required")
                    
                    expect(deleteRepo.called).to.be.false
                })
            })
        })
        
        context("invalid credentials", () => {
            it('should raise authenticated', async () => {
                await withDb(async (db) => {
                    // setup
                    await createList(db, "14b5b3df0b00e4c", "Public List", true, ["did:plc:o4wdtqgal63rsxiufwkuajzf"])
                    const app = createServer(db, null /* AtpFactory returns null, representing an auth failure */)

                    const response = await request(app)
                        .delete("/api/lists/14b5b3df0b00e4c")
                        .set('Content-Type', 'application/json')
                        .set('Accept', 'application/json')
                        .send({ identifier: ownerHandle, password: 'wrong-password' })
                    expect(response.status).to.eq(401)
                    expect(response.body.type).to.eq('error')
                    expect(response.body.error.message).to.contain("Credentials invalid")
                })
            })
        })
    })
})
