import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { secretRefIdentity } from '@server/domain/vault'
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

function expectResolvableIdentitySnapshot(
  db: DatabaseSync,
  snapshot: { credentialRef?: unknown },
  expected: { vaultId: string; credentialId: string },
) {
  expect(snapshot.credentialRef).toBe(`ama://vaults/${expected.vaultId}/credentials/${expected.credentialId}`)
  const identity = secretRefIdentity(String(snapshot.credentialRef))
  expect(identity).toEqual(expected)
  expect(
    db
      .prepare('SELECT id FROM vault_credentials WHERE id = ? AND vault_id = ?')
      .get(expected.credentialId, expected.vaultId),
  ).toEqual({ id: expected.credentialId })
}

describe('[spec: agents/realmroot-binding] Realmroot schema migrations', () => {
  it('keeps browser authorization attempts free of D1 client-key rate-limit state', () => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0029_web_auth_sessions.sql')

    const columns = db.prepare('PRAGMA table_info(web_authorization_attempts)').all() as Array<{ name: string }>
    expect(columns.map(({ name }) => name)).not.toContain('client_key')
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'web_authorization_attempts'")
        .all(),
    ).toEqual([])
    db.close()
  })

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
})

function seedIdentityMigrationAgent(
  db: DatabaseSync,
  values: { id?: string; remoteAgentId?: string; credentialId?: string; origin?: string } = {},
) {
  const id = values.id ?? 'agent_1'
  const descriptor = JSON.stringify({
    agentId: values.remoteAgentId ?? 'rr_agent_1',
    origin: values.origin ?? 'https://realmroot.example',
    username: 'reviewer',
    credentialRef: `ama://vaults/vault_old/credentials/${values.credentialId ?? 'cred_realmroot'}`,
  })
  db.prepare(`INSERT INTO agents (
    id,project_id,name,description,system_prompt,skills,subagents,allowed_tools,mcp_connectors,archived_at,current_version_id,created_at,updated_at,realmroot
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    'project_1',
    `Agent ${id}`,
    null,
    'Work.',
    '[]',
    '[]',
    '[]',
    '[]',
    null,
    `agentver_${id}`,
    '2026-01-01',
    '2026-01-02',
    descriptor,
  )
  db.prepare(`INSERT INTO agent_versions (
    id,agent_id,project_id,version,system_prompt,skills,subagents,allowed_tools,mcp_connectors,created_at,realmroot
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    `agentver_${id}`,
    id,
    'project_1',
    1,
    'Work.',
    '[]',
    '[]',
    '[]',
    '[]',
    '2026-01-01',
    descriptor,
  )
  return descriptor
}

describe('[spec: identities/migration] Identity resource migration', () => {
  it('moves the Realmroot credential and snapshots into the new one-way model', () => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0029_web_auth_sessions.sql')
    db.exec(`
      INSERT INTO projects (id,organization_id,name,created_at,updated_at) VALUES ('project_1','org_1','Project','2026-01-01','2026-01-02');
      INSERT INTO vaults (id,organization_id,project_id,name,scope,created_at,updated_at) VALUES ('vault_old','org_1','project_1','Old','project','2026-01-01','2026-01-02');
      INSERT INTO vault_credentials (id,vault_id,organization_id,project_id,name,type,state,created_at,updated_at)
        VALUES ('cred_realmroot','vault_old','org_1','project_1','State','ama.dev/realmroot-agent-state','active','2026-01-01','2026-01-02');
      INSERT INTO vault_credential_versions (id,credential_id,vault_id,organization_id,project_id,version,provider,secret_ref,reference_name,state,has_secret,created_at)
        VALUES ('ver_realmroot','cred_realmroot','vault_old','org_1','project_1',1,'ama','ama://vaults/vault_old/credentials/cred_realmroot/versions/ver_realmroot','STATE','active',1,'2026-01-01');
    `)
    const descriptor = seedIdentityMigrationAgent(db)
    db.prepare(`INSERT INTO sessions (
      id,agent_id,organization_id,agent_version_id,agent_snapshot,project_id,durable_object_name,state,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      'session_1',
      'agent_1',
      'org_1',
      'agentver_agent_1',
      JSON.stringify({ id: 'agentver_agent_1', realmroot: JSON.parse(descriptor) }),
      'project_1',
      'do_1',
      'stopped',
      '2026-01-01',
      '2026-01-02',
    )

    apply(db, '0030_identity_resources.sql')

    expect(
      db.prepare('SELECT runtime,state,remote_agent_id,bound_agent_id,vault_id,credential_id FROM identities').get(),
    ).toEqual({
      runtime: 'ama',
      state: 'active',
      remote_agent_id: 'rr_agent_1',
      bound_agent_id: 'agent_1',
      vault_id: 'vault_identity_migrated_agent_agent_1',
      credential_id: 'cred_realmroot',
    })
    expect(db.prepare('SELECT identity_id FROM agents WHERE id = ?').get('agent_1')).toEqual({
      identity_id: 'identity_migrated_agent_agent_1',
    })
    expect(db.prepare('SELECT identity_id FROM agent_versions WHERE id = ?').get('agentver_agent_1')).toEqual({
      identity_id: 'identity_migrated_agent_agent_1',
    })
    expect(db.prepare('SELECT vault_id FROM vault_credentials WHERE id = ?').get('cred_realmroot')).toEqual({
      vault_id: 'vault_identity_migrated_agent_agent_1',
    })
    expect(db.prepare('SELECT vault_id FROM vault_credential_versions WHERE id = ?').get('ver_realmroot')).toEqual({
      vault_id: 'vault_identity_migrated_agent_agent_1',
    })
    const snapshot = JSON.parse(
      (db.prepare('SELECT agent_snapshot FROM sessions WHERE id = ?').get('session_1') as { agent_snapshot: string })
        .agent_snapshot,
    )
    expect(snapshot.realmroot).toBeUndefined()
    expect(snapshot.identity).toMatchObject({
      identityId: 'identity_migrated_agent_agent_1',
      runtime: 'ama',
      agentId: 'rr_agent_1',
    })
    const expectedSecret = {
      vaultId: 'vault_identity_migrated_agent_agent_1',
      credentialId: 'cred_realmroot',
    }
    const agentSnapshot = JSON.parse(
      (db.prepare('SELECT identity_snapshot FROM agents WHERE id = ?').get('agent_1') as { identity_snapshot: string })
        .identity_snapshot,
    )
    const versionSnapshot = JSON.parse(
      (
        db.prepare('SELECT identity_snapshot FROM agent_versions WHERE id = ?').get('agentver_agent_1') as {
          identity_snapshot: string
        }
      ).identity_snapshot,
    )
    expectResolvableIdentitySnapshot(db, agentSnapshot, expectedSecret)
    expectResolvableIdentitySnapshot(db, versionSnapshot, expectedSecret)
    expectResolvableIdentitySnapshot(db, snapshot.identity, expectedSecret)
    const agentColumns = db.prepare('PRAGMA table_info(agents)').all() as Array<{ name: string }>
    const versionColumns = db.prepare('PRAGMA table_info(agent_versions)').all() as Array<{ name: string }>
    expect(agentColumns.map(({ name }) => name)).not.toContain('realmroot')
    expect(versionColumns.map(({ name }) => name)).not.toContain('realmroot')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it('preserves distinct current and historical descriptors for one Agent', () => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0029_web_auth_sessions.sql')
    const current = {
      agentId: 'rr_current',
      origin: 'https://realmroot.example',
      username: 'current',
      credentialRef: 'ama://vaults/vault_old/credentials/cred_current',
    }
    const historical = {
      agentId: 'rr_historical',
      origin: 'https://realmroot.example',
      username: 'historical',
      credentialRef: 'ama://vaults/vault_old/credentials/cred_historical',
    }
    db.exec(`
      INSERT INTO projects (id,organization_id,name,created_at,updated_at) VALUES ('project_1','org_1','Project','2026-01-01','2026-01-03');
      INSERT INTO vaults (id,organization_id,project_id,name,scope,created_at,updated_at) VALUES ('vault_old','org_1','project_1','Old','project','2026-01-01','2026-01-03');
      INSERT INTO vault_credentials (id,vault_id,organization_id,project_id,name,type,state,created_at,updated_at) VALUES
        ('cred_current','vault_old','org_1','project_1','Current','ama.dev/realmroot-agent-state','active','2026-01-02','2026-01-03'),
        ('cred_historical','vault_old','org_1','project_1','Historical','ama.dev/realmroot-agent-state','active','2026-01-01','2026-01-02');
      INSERT INTO vault_credential_versions (id,credential_id,vault_id,organization_id,project_id,version,provider,secret_ref,reference_name,state,has_secret,created_at) VALUES
        ('ver_current','cred_current','vault_old','org_1','project_1',1,'ama','ama://vaults/vault_old/credentials/cred_current/versions/ver_current','CURRENT','active',1,'2026-01-02'),
        ('ver_historical','cred_historical','vault_old','org_1','project_1',1,'ama','ama://vaults/vault_old/credentials/cred_historical/versions/ver_historical','HISTORICAL','active',1,'2026-01-01');
    `)
    db.prepare(`INSERT INTO agents (
      id,project_id,name,system_prompt,skills,subagents,allowed_tools,mcp_connectors,current_version_id,created_at,updated_at,realmroot
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'agent_1',
      'project_1',
      'Agent',
      'Work.',
      '[]',
      '[]',
      '[]',
      '[]',
      'agentver_current',
      '2026-01-01',
      '2026-01-03',
      JSON.stringify(current),
    )
    const insertVersion = db.prepare(`INSERT INTO agent_versions (
      id,agent_id,project_id,version,system_prompt,skills,subagents,allowed_tools,mcp_connectors,created_at,realmroot
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    insertVersion.run(
      'agentver_historical',
      'agent_1',
      'project_1',
      1,
      'Work.',
      '[]',
      '[]',
      '[]',
      '[]',
      '2026-01-01',
      JSON.stringify(historical),
    )
    insertVersion.run(
      'agentver_current',
      'agent_1',
      'project_1',
      2,
      'Work.',
      '[]',
      '[]',
      '[]',
      '[]',
      '2026-01-02',
      JSON.stringify(current),
    )
    db.prepare(`INSERT INTO sessions (
      id,agent_id,organization_id,agent_version_id,agent_snapshot,project_id,durable_object_name,state,metadata,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      'session_historical',
      'agent_1',
      'org_1',
      'agentver_historical',
      JSON.stringify({ id: 'agentver_historical', realmroot: historical }),
      'project_1',
      'do_history',
      'stopped',
      JSON.stringify({ runtime: 'codex' }),
      '2026-01-01',
      '2026-01-02',
    )

    apply(db, '0030_identity_resources.sql')

    expect(
      db.prepare('SELECT id,remote_agent_id,vault_id,credential_id,bound_agent_id FROM identities ORDER BY id').all(),
    ).toEqual([
      {
        id: 'identity_migrated_agent_agent_1',
        remote_agent_id: 'rr_current',
        vault_id: 'vault_identity_migrated_agent_agent_1',
        credential_id: 'cred_current',
        bound_agent_id: 'agent_1',
      },
      {
        id: 'identity_migrated_version_agentver_historical',
        remote_agent_id: 'rr_historical',
        vault_id: 'vault_identity_migrated_version_agentver_historical',
        credential_id: 'cred_historical',
        bound_agent_id: 'agent_1',
      },
    ])
    expect(db.prepare('SELECT id,managed_by FROM vaults WHERE managed_by = ? ORDER BY id').all('identity')).toEqual([
      { id: 'vault_identity_migrated_agent_agent_1', managed_by: 'identity' },
      { id: 'vault_identity_migrated_version_agentver_historical', managed_by: 'identity' },
    ])
    expect(db.prepare('SELECT id,vault_id FROM vault_credentials ORDER BY id').all()).toEqual([
      { id: 'cred_current', vault_id: 'vault_identity_migrated_agent_agent_1' },
      { id: 'cred_historical', vault_id: 'vault_identity_migrated_version_agentver_historical' },
    ])
    expect(db.prepare('SELECT id,identity_id FROM agent_versions ORDER BY version').all()).toEqual([
      { id: 'agentver_historical', identity_id: 'identity_migrated_version_agentver_historical' },
      { id: 'agentver_current', identity_id: 'identity_migrated_agent_agent_1' },
    ])
    const currentAgentSnapshot = JSON.parse(
      (db.prepare('SELECT identity_snapshot FROM agents WHERE id = ?').get('agent_1') as { identity_snapshot: string })
        .identity_snapshot,
    )
    const versionSnapshots = db
      .prepare('SELECT id,identity_snapshot FROM agent_versions ORDER BY version')
      .all() as Array<{
      id: string
      identity_snapshot: string
    }>
    expectResolvableIdentitySnapshot(db, currentAgentSnapshot, {
      vaultId: 'vault_identity_migrated_agent_agent_1',
      credentialId: 'cred_current',
    })
    expectResolvableIdentitySnapshot(db, JSON.parse(versionSnapshots[0]!.identity_snapshot), {
      vaultId: 'vault_identity_migrated_version_agentver_historical',
      credentialId: 'cred_historical',
    })
    expectResolvableIdentitySnapshot(db, JSON.parse(versionSnapshots[1]!.identity_snapshot), {
      vaultId: 'vault_identity_migrated_agent_agent_1',
      credentialId: 'cred_current',
    })
    const session = db
      .prepare('SELECT agent_snapshot,metadata FROM sessions WHERE id = ?')
      .get('session_historical') as {
      agent_snapshot: string
      metadata: string
    }
    expect(JSON.parse(session.agent_snapshot)).toMatchObject({
      identity: {
        identityId: 'identity_migrated_version_agentver_historical',
        agentId: 'rr_historical',
        runtime: 'ama',
      },
    })
    expectResolvableIdentitySnapshot(db, JSON.parse(session.agent_snapshot).identity, {
      vaultId: 'vault_identity_migrated_version_agentver_historical',
      credentialId: 'cred_historical',
    })
    expect(JSON.parse(session.agent_snapshot)).not.toHaveProperty('realmroot')
    expect(JSON.parse(session.metadata)).toEqual({ runtime: 'codex' })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()
  })

  it.each([
    {
      name: 'Remote Agent',
      first: { remoteAgentId: 'rr_shared', credentialId: 'cred_agent_1' },
      second: { remoteAgentId: 'rr_shared', credentialId: 'cred_agent_2' },
    },
    {
      name: 'credential',
      first: { remoteAgentId: 'rr_agent_1', credentialId: 'cred_shared' },
      second: { remoteAgentId: 'rr_agent_2', credentialId: 'cred_shared' },
    },
  ])('fails before writes when one $name is shared across Agents', ({ first, second }) => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0029_web_auth_sessions.sql')
    db.exec(
      "INSERT INTO projects (id,organization_id,name,created_at,updated_at) VALUES ('project_1','org_1','Project','2026-01-01','2026-01-01')",
    )
    seedIdentityMigrationAgent(db, { id: 'agent_1', ...first })
    seedIdentityMigrationAgent(db, { id: 'agent_2', ...second })

    expect(() => apply(db, '0030_identity_resources.sql')).toThrow(/CHECK constraint failed/)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='identities'").get()).toBeUndefined()
    db.close()
  })

  it('fails before writes when an active Trigger conflicts with migrated runtime=ama', () => {
    const db = new DatabaseSync(':memory:')
    applyThrough(db, '0029_web_auth_sessions.sql')
    db.exec(
      "INSERT INTO projects (id,organization_id,name,created_at,updated_at) VALUES ('project_1','org_1','Project','2026-01-01','2026-01-01')",
    )
    seedIdentityMigrationAgent(db)
    db.prepare(`INSERT INTO triggers (
      id,organization_id,project_id,agent_id,environment_id,trigger_type,runtime,name,prompt_template,interval_seconds,window_seconds,enabled,next_due_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'trigger_1',
      'org_1',
      'project_1',
      'agent_1',
      null,
      'scheduled',
      'codex',
      'Conflict',
      'Work',
      3600,
      0,
      1,
      '2026-01-02',
      '2026-01-01',
      '2026-01-01',
    )

    expect(() => apply(db, '0030_identity_resources.sql')).toThrow()
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='identities'").get()).toBeUndefined()
    db.close()
  })
})
