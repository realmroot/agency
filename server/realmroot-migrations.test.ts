import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

function migration(name: string) {
  return readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

function apply(db: DatabaseSync, name: string) {
  db.exec('BEGIN')
  try {
    for (const statement of migration(name)) db.exec(statement)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

describe('[spec: agents/realmroot-binding] Realmroot schema migrations', () => {
  it('upgrades an old database and preserves credential versions while admitting the dedicated type', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`
      PRAGMA foreign_keys=on;
      CREATE TABLE projects (id text PRIMARY KEY NOT NULL);
      CREATE TABLE vaults (id text PRIMARY KEY NOT NULL);
      CREATE TABLE agents (id text PRIMARY KEY NOT NULL);
      CREATE TABLE agent_versions (id text PRIMARY KEY NOT NULL);
      CREATE TABLE vault_credentials (
        id text PRIMARY KEY NOT NULL,
        vault_id text NOT NULL REFERENCES vaults(id),
        organization_id text NOT NULL,
        project_id text REFERENCES projects(id),
        name text NOT NULL,
        type text NOT NULL CHECK(type in ('opaque','ama.dev/basic-auth','ama.dev/ssh-auth','ama.dev/tls','ama.dev/private-key-jwk','ama.dev/oauth-token')),
        metadata text DEFAULT '{}' NOT NULL,
        state text DEFAULT 'active' NOT NULL,
        active_version_id text,
        revoked_at text,
        revoked_by_user_id text,
        revoke_reason text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE vault_credential_versions (
        id text PRIMARY KEY NOT NULL,
        credential_id text NOT NULL REFERENCES vault_credentials(id),
        vault_id text NOT NULL REFERENCES vaults(id),
        organization_id text NOT NULL,
        project_id text REFERENCES projects(id),
        version integer NOT NULL,
        provider text NOT NULL,
        secret_ref text NOT NULL,
        reference_name text NOT NULL,
        state text DEFAULT 'active' NOT NULL,
        has_secret integer DEFAULT true NOT NULL,
        metadata text DEFAULT '{}' NOT NULL,
        created_at text NOT NULL,
        superseded_at text,
        revoked_at text
      );
      INSERT INTO projects VALUES ('project_1');
      INSERT INTO vaults VALUES ('vault_1');
      INSERT INTO vault_credentials VALUES (
        'cred_1','vault_1','org_1','project_1','Existing','opaque','{}','active','ver_1',null,null,null,
        '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'
      );
      INSERT INTO vault_credential_versions VALUES (
        'ver_1','cred_1','vault_1','org_1','project_1',1,'ama',
        'ama://vaults/vault_1/credentials/cred_1/versions/ver_1','EXISTING','active',1,'{}',
        '2026-01-01T00:00:00Z',null,null
      );
    `)

    apply(db, '0023_agent_realmroot_binding.sql')
    apply(db, '0024_realmroot_credential_type.sql')

    const agentColumns = db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>
    const versionColumns = db.prepare('PRAGMA table_info(agent_versions)').all() as Array<{ name: string }>
    expect(agentColumns.map(({ name }) => name)).toContain('realmroot')
    expect(versionColumns.map(({ name }) => name)).toContain('realmroot')
    expect(db.prepare('SELECT id, active_version_id FROM vault_credentials WHERE id = ?').get('cred_1')).toMatchObject({
      id: 'cred_1',
      active_version_id: 'ver_1',
    })
    expect(
      db.prepare('SELECT id, credential_id, version FROM vault_credential_versions WHERE id = ?').get('ver_1'),
    ).toEqual({
      id: 'ver_1',
      credential_id: 'cred_1',
      version: 1,
    })

    expect(() =>
      db
        .prepare(
          `INSERT INTO vault_credentials (
            id,vault_id,organization_id,project_id,name,type,metadata,state,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          'cred_realmroot',
          'vault_1',
          'org_1',
          'project_1',
          'Realmroot state',
          'ama.dev/realmroot-agent-state',
          '{}',
          'active',
          '2026-01-02T00:00:00Z',
          '2026-01-02T00:00:00Z',
        ),
    ).not.toThrow()
    db.close()
  })
})
