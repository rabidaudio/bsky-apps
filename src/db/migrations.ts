import { Kysely, Migration, MigrationProvider } from 'kysely'

const migrations: Record<string, Migration> = {}

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations
  },
}

migrations['202308271129'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('membership')
      .addColumn('id', 'integer', (col) => col.autoIncrement().primaryKey())
      .addColumn('owner_did', 'varchar', (col) => col.notNull())
      .addColumn('member_did', 'varchar', (col) => col.notNull())
      .addColumn('list', 'integer', (col) => col.notNull())
      .addUniqueConstraint('uniq_memberships', ['owner_did', 'member_did', 'list'])
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('membership').execute()
  }
}

migrations['001'] = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable('post')
      .addColumn('uri', 'varchar', (col) => col.primaryKey())
      .addColumn('cid', 'varchar', (col) => col.notNull())
      .addColumn('replyParent', 'varchar')
      .addColumn('replyRoot', 'varchar')
      .addColumn('indexedAt', 'varchar', (col) => col.notNull())
      .execute()
    await db.schema
      .createTable('sub_state')
      .addColumn('service', 'varchar', (col) => col.primaryKey())
      .addColumn('cursor', 'integer', (col) => col.notNull())
      .execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('post').execute()
    await db.schema.dropTable('sub_state').execute()
  },
}
