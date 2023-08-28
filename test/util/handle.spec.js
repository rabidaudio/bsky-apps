const { expect } = require('chai')
const { HandleCache } = require('../../src/util/handle')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe("HandleCache", () => {
    describe("fetchDid", () => {
        context("cache miss", () => {
            it('should return the value from the handler', async () => {
                const cache = new HandleCache({ max: 10, ttl: 5*60*60*1000 })

                const did = await cache.fetchDid("rabid.audio", async () => "did:plc:deoph4eyrdzjl7fxh6z6gbqg")
                expect(did).to.eq("did:plc:deoph4eyrdzjl7fxh6z6gbqg")
            })

            it('should save the value in the db', async () => {
                const cache = new HandleCache({ max: 10, ttl: 5*60*60*1000 })
                const preCount = await cache.getCacheSize()
                expect(preCount).to.eq(0)
                await cache.fetchDid("rabid.audio", async () => "did:plc:deoph4eyrdzjl7fxh6z6gbqg")

                const postCount = await cache.getCacheSize()
                expect(postCount).to.eq(1)
                expect((await cache.peek({ handle: 'rabid.audio' })).did).to.eq("did:plc:deoph4eyrdzjl7fxh6z6gbqg")
            })
        })

        context("cache hit", () => {
            it('should not call the handler', async () => {
                const cache = new HandleCache({ max: 10, ttl: 5*60*60*1000 })
                await cache.fetchDid("rabid.audio", async () => "did:plc:deoph4eyrdzjl7fxh6z6gbqg")

                const did = await cache.fetchDid("rabid.audio", async () => {
                    throw new Error("Handler called")
                })
                expect(did).to.eq("did:plc:deoph4eyrdzjl7fxh6z6gbqg")
            })
        })

        context("error", () => {
            it("should propagate errors", async () => {
                const cache = new HandleCache({ max: 10, ttl: 5*60*60*1000 })
                try {
                    await cache.fetchDid("rabid.audio", async () => {
                        throw new Error("oops")
                    })
                    fail("should not pass")
                } catch (err) {
                    expect(err.message).to.eq("oops")
                }
            })
        })

        describe("ttl purge on write", () => {
            it("should remove records that are older than ttl", async () => {
                const cache = new HandleCache({ max: 10, ttl: 10 /*ms*/ })
                
                await cache.fetchDid("rabid.audio", async () => "did:plc:deoph4eyrdzjl7fxh6z6gbqg")
                expect((await cache.getCacheSize())).to.eq(1)

                await delay(50) // wait 50ms, well past the ttl

                expect((await cache.getCacheSize())).to.eq(1) // should still be one item

                await cache.fetchDid("kathebooks.bsky.social", async () => "did:plc:o4wdtqgal63rsxiufwkuajzf")
                // should have added the new one but removed the old one
                expect((await cache.getCacheSize())).to.eq(1)
                expect((await cache.peek({ handle: 'kathebooks.bsky.social' }))).not.to.be.undefined
                expect((await cache.peek({ handle: 'rabid.audio' }))).to.be.undefined
            })
        })

        describe("max records purge", () => {

            it("should remove the oldest records", async () => {
                const cache = new HandleCache({ max: 1, ttl: 5*60*60*1000 })

                await cache.fetchDid("rabid.audio", async () => "did:plc:deoph4eyrdzjl7fxh6z6gbqg")
                expect((await cache.getCacheSize())).to.eq(1)

                await cache.fetchDid("kathebooks.bsky.social", async () => "did:plc:o4wdtqgal63rsxiufwkuajzf")
                // should have added the new one but removed the old one
                expect((await cache.getCacheSize())).to.eq(1)
                expect((await cache.peek({ handle: 'kathebooks.bsky.social' }))).not.to.be.undefined
                expect((await cache.peek({ handle: 'rabid.audio' }))).to.be.undefined
            })
        })
    })
})
