import { readdirSync, readFileSync } from 'node:fs'
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

function applyThrough(db: DatabaseSync, lastMigration: string) {
  const names = readdirSync(new URL('../migrations', import.meta.url))
    .filter((name) => name.endsWith('.sql') && name.localeCompare(lastMigration) <= 0)
    .sort()
  for (const name of names) apply(db, name)
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

  it('creates a replay ledger keyed by issuer, proof key, and jti', () => {
    const db = new DatabaseSync(':memory:')
    apply(db, '0025_dpop_proof_replay.sql')
    const insert = db.prepare(
      'INSERT INTO dpop_proofs (issuer, key_thumbprint, jti, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?)',
    )
    insert.run('https://issuer.example.test', 'jkt_1', 'jti_1', '2026-01-01T00:05:00Z', '2026-01-01T00:00:00Z')
    expect(() =>
      insert.run('https://issuer.example.test', 'jkt_1', 'jti_1', '2026-01-01T00:05:00Z', '2026-01-01T00:00:01Z'),
    ).toThrow()
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get('idx_dpop_proofs_expires_at'),
    ).toBeTruthy()
    db.close()
  })

  it('upgrades the complete referenced runner graph without data loss or foreign-key damage', () => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0025_dpop_proof_replay.sql')
    db.exec(`
      PRAGMA foreign_keys=on;
      INSERT INTO projects (id,organization_id,name,created_at,updated_at)
        VALUES ('project_1','org_1','Project','2026-01-01','2026-01-01');
      INSERT INTO agents (id,project_id,name,system_prompt,created_at,updated_at)
        VALUES ('agent_1','project_1','Agent','Work','2026-01-01','2026-01-01');
      INSERT INTO environments (id,project_id,name,hosting_mode,created_at,updated_at)
        VALUES ('env_1','project_1','Environment','self_hosted','2026-01-01','2026-01-01');
      INSERT INTO sessions (id,agent_id,organization_id,project_id,durable_object_name,state,created_at,updated_at)
        VALUES ('session_1','agent_1','org_1','project_1','session-do-1','running','2026-01-01','2026-01-01');
      INSERT INTO runners (
        id,organization_id,project_id,name,environment_id,auth_mode,oidc_subject,oidc_client_id,
        state,current_load,max_concurrent,runtime_usage,runtimes,metadata,created_at,updated_at
      ) VALUES
        ('runner_bearer','org_1','project_1','Bearer','env_1','bearer','sub_1','client_1','active',1,2,'[{"runtime":"ama"}]','[{"runtime":"ama"}]','{"pool":"legacy"}','2026-01-01','2026-01-02'),
        ('runner_oidc','org_1','project_1','OIDC','env_1','oidc','sub_2','client_2','offline',0,1,'[]','[]','{}','2026-01-01','2026-01-01'),
        ('runner_federated','org_1','project_1','Federated','env_1','federated','sub_3','client_3','offline',0,1,'[]','[]','{}','2026-01-01','2026-01-01');
      INSERT INTO work_items (
        id,organization_id,project_id,session_id,environment_id,runner_id,lease_id,type,state,payload,
        available_at,created_at,updated_at
      ) VALUES ('work_1','org_1','project_1','session_1','env_1','runner_bearer','lease_1','session.run','leased','{"prompt":"keep"}','2026-01-01','2026-01-01','2026-01-02');
      INSERT INTO leases (
        id,work_item_id,runner_id,organization_id,project_id,state,expires_at,resume_token,created_at,updated_at
      ) VALUES ('lease_1','work_1','runner_bearer','org_1','project_1','active','2026-01-03','resume-keep','2026-01-01','2026-01-02');
      INSERT INTO session_channels (
        id,session_id,work_item_id,lease_id,runner_id,organization_id,project_id,state,accepted_at,last_seen_at,
        close_reason,created_at,updated_at
      ) VALUES ('channel_1','session_1','work_1','lease_1','runner_bearer','org_1','project_1','active','2026-01-01','2026-01-02','keep-me','2026-01-01','2026-01-02');
    `)
    apply(db, '0026_realmroot_runner_auth.sql')
    expect(db.prepare('SELECT DISTINCT auth_mode FROM runners').all()).toEqual([{ auth_mode: 'realmroot' }])
    expect(db.prepare('SELECT runtime_usage,runtimes,metadata FROM runners WHERE id = ?').get('runner_bearer')).toEqual(
      {
        runtime_usage: '[{"runtime":"ama"}]',
        runtimes: '[{"runtime":"ama"}]',
        metadata: '{"pool":"legacy"}',
      },
    )
    expect(db.prepare('SELECT runner_id,lease_id,payload FROM work_items WHERE id = ?').get('work_1')).toEqual({
      runner_id: 'runner_bearer',
      lease_id: 'lease_1',
      payload: '{"prompt":"keep"}',
    })
    expect(db.prepare('SELECT runner_id,resume_token FROM leases WHERE id = ?').get('lease_1')).toEqual({
      runner_id: 'runner_bearer',
      resume_token: 'resume-keep',
    })
    expect(db.prepare('SELECT runner_id,close_reason FROM session_channels WHERE id = ?').get('channel_1')).toEqual({
      runner_id: 'runner_bearer',
      close_reason: 'keep-me',
    })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(() =>
      db
        .prepare(`INSERT INTO runners (
        id,organization_id,project_id,name,auth_mode,state,current_load,max_concurrent,runtime_usage,runtimes,metadata,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          'runner_legacy',
          'org_1',
          'project_1',
          'Legacy',
          'oidc',
          'offline',
          0,
          1,
          '[]',
          '[]',
          '{}',
          '2026-01-01',
          '2026-01-01',
        ),
    ).toThrow()
    db.close()
  })

  it('drops the identity-broker tenant table', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE federated_tenants (id text PRIMARY KEY NOT NULL)')
    apply(db, '0027_drop_identity_broker.sql')
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get('federated_tenants'),
    ).toBeUndefined()
    db.close()
  })

  it('adds the controlling user pointer without rewriting existing audit actors', () => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0027_drop_identity_broker.sql')
    db.prepare(`INSERT INTO audit_records (
      id,organization_id,project_id,actor_user_id,actor_type,action,resource_type,outcome,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'audit_1',
      'org_1',
      null,
      'agent_1',
      'agent',
      'agent.create',
      'agent',
      'success',
      '2026-01-01',
    )
    apply(db, '0028_audit_actor_chain.sql')
    expect(
      db.prepare('SELECT actor_type,actor_user_id,controller_user_id FROM audit_records WHERE id = ?').get('audit_1'),
    ).toEqual({ actor_type: 'agent', actor_user_id: 'agent_1', controller_user_id: null })
    db.close()
  })

  it('upgrades multiple legacy Agents without blank identity or username collisions', () => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0028_audit_actor_chain.sql')
    db.exec(`
      INSERT INTO projects (id,organization_id,name,created_at,updated_at)
        VALUES ('project_1','org_1','Project','2026-01-01','2026-01-01');
      INSERT INTO agents (id,project_id,name,system_prompt,realmroot,created_at,updated_at) VALUES
        ('agent_bound','project_1','Bound','Work',
          '{"agentId":"rr_agent_1","origin":"https://id.realmroot.dev","credentialRef":"ama://vaults/v1/credentials/c1"}',
          '2026-01-01','2026-01-01'),
        ('agent_unbound','project_1','Unbound','Work',null,'2026-01-01','2026-01-01');
    `)

    expect(() => apply(db, '0030_agent_identity_provisioning.sql')).not.toThrow()
    expect(
      db
        .prepare('SELECT id,username,identity_issuer,identity_subject,identity_credential_ref FROM agents ORDER BY id')
        .all(),
    ).toEqual([
      {
        id: 'agent_bound',
        username: 'legacy-agent-bound',
        identity_issuer: 'https://id.realmroot.dev/api/auth',
        identity_subject: 'rr_agent_1',
        identity_credential_ref: 'ama://vaults/v1/credentials/c1',
      },
      {
        id: 'agent_unbound',
        username: 'legacy-agent-unbound',
        identity_issuer: 'urn:ama:legacy:unbound',
        identity_subject: 'agent_unbound',
        identity_credential_ref: null,
      },
    ])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })
})
