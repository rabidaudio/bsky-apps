import { type Kysely, type Migration, type MigrationProvider, sql } from 'kysely'

const migrations: Record<string, Migration> = {}

export const migrationProvider: MigrationProvider = {
  async getMigrations () {
    return migrations
  }
}

migrations['202308281223'] = {
  async up (db: Kysely<unknown>) {
    await db.schema.alterTable('list')
      .addColumn('createdAt', 'timestamp', (opts) => opts.notNull().defaultTo(sql`now()`))
      .execute()
    await db.schema.createIndex('idx_list_on_created_at').on('list').column('createdAt').execute()
  },
  async down (db: Kysely<unknown>) {
    await db.schema.dropIndex('idx_list_on_created_at').execute()
    await db.schema.alterTable('list').dropColumn('createdAt').execute()
  }
}

migrations['202308271617'] = {
  async up (db: Kysely<unknown>) {
    await db.schema.alterTable('membership').dropConstraint('uniq_memberships').execute()
    await db.schema.dropIndex('idx_membership_on_list_and_owner').execute()

    await db.schema.alterTable('membership')
      .dropColumn('ownerDid')
      .execute()

    await db.schema.alterTable('membership')
      .dropColumn('listId')
      .execute()

    await db.schema
      .createTable('list')
      .addColumn('id', 'varchar(15)', (col) => col.primaryKey())
      .addColumn('ownerDid', 'varchar', (col) => col.notNull())
      .addColumn('name', 'varchar')
      .addColumn('isPublic', 'boolean', (col) => col.notNull().defaultTo(false))
      .execute()

    await db.schema.createIndex('idx_list_on_owner_did').on('list').column('ownerDid').execute()
    await db.schema.createIndex('idx_list_on_id').on('list').column('ownerDid').execute()

    await db.schema
      .alterTable('membership')
      .addColumn('listId', 'varchar', (col) => col.notNull())
      .execute()

    await db.schema
      .alterTable('membership')
      .addForeignKeyConstraint('fk_list_membership', ['listId'], 'list', ['id'])
      .execute()

    await db.schema.alterTable('membership')
      .addUniqueConstraint('uniq_membership', ['listId', 'memberDid'])
      .execute()
  },
  async down (db: Kysely<unknown>) {
    await db.schema.alterTable('membership').dropConstraint('uniq_membership').execute()
    await db.schema.alterTable('membership').dropConstraint('fk_list_membership').execute()
    await db.schema.alterTable('membership').dropColumn('listId').execute()
    await db.schema.dropTable('list').cascade().execute()
    await db.schema.alterTable('membership').addColumn('ownerDid', 'varchar', (col) => col.notNull()).execute()
    await db.schema.alterTable('membership').addColumn('listId', 'integer', (col) => col.notNull()).execute()
    await db.schema
      .createIndex('idx_membership_on_list_and_owner')
      .on('membership')
      .columns(['listId', 'ownerDid'])
      .execute()
    await db.schema.alterTable('membership')
      .addUniqueConstraint('uniq_memberships', ['ownerDid', 'memberDid', 'listId'])
      .execute()
  }
}

migrations['202308271129'] = {
  async up (db: Kysely<unknown>) {
    await db.schema
      .createTable('membership')
      .addColumn('id', 'serial', (col) => col.primaryKey())
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
  async down (db: Kysely<unknown>) {
    await db.schema.dropTable('membership').cascade().execute()
    await db.schema.dropIndex('idx_post_on_author').execute()
    await db.schema.dropIndex('idx_post_on_indexedAt').execute()
    await db.schema.alterTable('post').dropColumn('author').execute()
  }
}

migrations['001'] = {
  async up (db: Kysely<unknown>) {
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
  async down (db: Kysely<unknown>) {
    await db.schema.dropTable('post').execute()
    await db.schema.dropTable('sub_state').execute()
  }
}
