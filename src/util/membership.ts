import { AppContext } from '../config'
import { Membership } from '../db/schema'

const LIMIT = 250

// wipe and recreate list
export const replaceList = async (ctx: AppContext, listId: number, ownerDid: string, members: string[]): Promise<void> => {
    if (members.length > LIMIT) throw new Error(`Lists are limited to ${LIMIT} members`)

    await ctx.db.transaction().execute(async (trx) => {
        await trx.deleteFrom('membership').where('listId', '=', listId).where('ownerDid', '=', ownerDid)
        const rows: Membership[] = members.map(memberDid => ({
            listId,
            ownerDid,
            memberDid
        }))
        await trx.insertInto('membership').values(rows).execute()
    })
}
