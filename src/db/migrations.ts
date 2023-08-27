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
      .addColumn('ownerDid', 'varchar', (col) => col.notNull())
      .addColumn('memberDid', 'varchar', (col) => col.notNull())
      .addColumn('listId', 'integer', (col) => col.notNull())
      .addUniqueConstraint('uniq_memberships', ['ownerDid', 'memberDid', 'listId'])
      .execute()
    
    await db.schema
      .createIndex('idx_membership_on_member')
      .on('membership')
      .column('memberDid')
      .execute()
    await db.schema
      .createIndex('idx_membership_on_list_and_owner')
      .on('membership')
      .columns(['listId', 'ownerDid'])
      .execute()

    await db.schema.alterTable('post')
      .addColumn('author', 'varchar', (col) => col.notNull())
      .execute()

    await db.schema.createIndex('idx_post_on_author').on('post').column('author').execute()
    await db.schema.createIndex('idx_post_on_indexedAt').on('post').column('indexedAt').execute()
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable('membership').execute()
    await db.schema.dropIndex('idx_post_on_author').execute()
    await db.schema.dropIndex('idx_post_on_indexedAt').execute()
    await db.schema.alterTable('post').dropColumn('author').execute()
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
