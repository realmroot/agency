import { describe, expect, it } from 'vitest'
import { hasSecretMaterial, nextDueFromInterval, PromptTemplateRenderError, renderHttpPromptTemplate } from './trigger'

describe('nextDueFromInterval', () => {
  it('computes the next due date from a given timestamp', () => {
    const from = new Date('2026-01-01T00:00:00.000Z').getTime()
    expect(nextDueFromInterval(3600, from)).toBe('2026-01-01T01:00:00.000Z')
  })

  it('uses the current time as default when no from is provided', () => {
    const before = Date.now()
    const result = nextDueFromInterval(60)
    const after = Date.now()
    const resultMs = new Date(result).getTime()
    expect(resultMs).toBeGreaterThanOrEqual(before + 60 * 1000)
    expect(resultMs).toBeLessThanOrEqual(after + 60 * 1000)
  })
})

describe('hasSecretMaterial', () => {
  it('returns false for null, undefined, and non-object primitives', () => {
    expect(hasSecretMaterial(null)).toBe(false)
    expect(hasSecretMaterial(undefined)).toBe(false)
    expect(hasSecretMaterial(42)).toBe(false)
    expect(hasSecretMaterial('plain-string')).toBe(false)
  })

  it('returns false for empty objects and safe objects', () => {
    expect(hasSecretMaterial({})).toBe(false)
    expect(hasSecretMaterial({ owner: 'platform' })).toBe(false)
  })

  it('detects secret-looking keys at the top level', () => {
    expect(hasSecretMaterial({ secret: 'x' })).toBe(true)
    expect(hasSecretMaterial({ token: 'x' })).toBe(true)
    expect(hasSecretMaterial({ apikey: 'x' })).toBe(true)
    expect(hasSecretMaterial({ password: 'x' })).toBe(true)
    expect(hasSecretMaterial({ privatekey: 'x' })).toBe(true)
  })

  it('detects secret-looking keys nested in arrays', () => {
    expect(hasSecretMaterial([{ ok: 1 }, { token: 'x' }])).toBe(true)
    expect(hasSecretMaterial([{ ok: 1 }])).toBe(false)
  })

  it('detects secret-looking keys at any depth in nested objects', () => {
    expect(hasSecretMaterial({ nested: { deep: { secret: 'x' } } })).toBe(true)
    expect(hasSecretMaterial({ nested: { deep: { safe: 'ok' } } })).toBe(false)
  })
})

describe('renderHttpPromptTemplate', () => {
  it('renders body, header, and AMA run variables', () => {
    const prompt = renderHttpPromptTemplate(
      'Handle {{ .body.ticket.id }} for {{ .body.team }} via {{ .header["x-source"] }} reused={{ .ama.run.session_reused }}.',
      {
        body: { ticket: { id: 'T-123' }, team: 'support' },
        header: { 'x-source': 'webhook' },
        run: { session_reused: false, session_id: null, session_state: null },
      },
    )
    expect(prompt).toBe('Handle T-123 for support via webhook reused=false.')
  })

  it('keeps template output as Markdown text', () => {
    const prompt = renderHttpPromptTemplate(
      '# Event\n\n- Ticket: {{ .body.ticket.id }}\n- URL: [open]({{ .body.ticket.url }})',
      {
        body: { ticket: { id: 'T-123', url: 'https://example.test/tickets/T-123' } },
        header: {},
      },
    )
    expect(prompt).toBe('# Event\n\n- Ticket: T-123\n- URL: [open](https://example.test/tickets/T-123)')
  })

  it('renders missing variables as empty text', () => {
    const prompt = renderHttpPromptTemplate('Payload: {{ .body.missing.value }}.', {
      body: { payload: { ok: true } },
      header: {},
    })
    expect(prompt).toBe('Payload: .')
  })

  it('does not expose body fields at the template root', () => {
    const prompt = renderHttpPromptTemplate('Event={{ .event }} Body={{ .body.event }}', {
      body: { event: 'issues' },
      header: {},
    })
    expect(prompt).toBe('Event= Body=issues')
  })

  it('renders array, null, number, and boolean values', () => {
    const prompt = renderHttpPromptTemplate('{{ .body.items[1] }} {{ .body.none }} {{ .body.count }} {{ .body.ok }}', {
      body: { items: ['first', 'second'], none: null, count: 3, ok: false },
      header: {},
    })
    expect(prompt).toBe('second  3 false')
  })

  it('renders conditional blocks for truthy paths', () => {
    const prompt = renderHttpPromptTemplate('{% if .body.comment.id %}Comment {{ .body.comment.id }}{% endif %}', {
      body: { comment: { id: 123 } },
      header: {},
    })
    expect(prompt).toBe('Comment 123')
  })

  it('renders else branch for missing or falsey condition paths', () => {
    const prompt = renderHttpPromptTemplate('{% if .body.review.id %}Review{% else %}No review{% endif %}', {
      body: { review: { id: null } },
      header: {},
    })
    expect(prompt).toBe('No review')
  })

  it('supports equality conditions', () => {
    const prompt = renderHttpPromptTemplate(
      '{% if .body.event == "issues" %}Issue {{ .body.subject.number }}{% endif %}',
      {
        body: { event: 'issues', subject: { number: 42 } },
        header: {},
      },
    )
    expect(prompt).toBe('Issue 42')
  })

  it('[spec: triggers/http-create] supports literal comparisons in conditional prompt templates', () => {
    const prompt = renderHttpPromptTemplate(
      [
        '{% if .body.ok == true %}ok{% endif %}',
        '{% if .body.disabled == false %}disabled{% endif %}',
        '{% if .body.count == 3 %}count{% endif %}',
        '{% if .body.none == null %}none{% endif %}',
        '{% if .body.status == "open" %}open{% endif %}',
        '{% if .body.notNumber == "NaN" %}nan{% endif %}',
        '{% if .body.event != "pull_request" %}not-pr{% endif %}',
      ].join(' '),
      {
        body: { ok: true, disabled: false, count: 3, none: null, status: 'open', notNumber: 'NaN', event: 'issues' },
        header: {},
      },
    )
    expect(prompt).toBe('ok disabled count none open nan not-pr')
  })

  it('does not render variables inside skipped conditional branches', () => {
    const prompt = renderHttpPromptTemplate(
      '{% if .body.event == "pull_request" %}{{ .body.missing.value }}{% else %}Issue{% endif %}',
      {
        body: { event: 'issues' },
        header: {},
      },
    )
    expect(prompt).toBe('Issue')
  })

  it('[spec: triggers/http-create] renders empty content for false conditional blocks without else branches', () => {
    const prompt = renderHttpPromptTemplate('Start{% if .body.review.id %}Review{% endif %}End', {
      body: { review: { id: null } },
      header: {},
    })
    expect(prompt).toBe('StartEnd')
  })

  it('[spec: triggers/http-create] fails when a conditional block is malformed', () => {
    expect(() =>
      renderHttpPromptTemplate('{% if .body.event %}Issue', {
        body: { event: 'issues' },
        header: {},
      }),
    ).toThrow(PromptTemplateRenderError)
  })

  it('[spec: triggers/http-create] fails when a conditional expression is blank', () => {
    expect(() =>
      renderHttpPromptTemplate('{% if %}Issue{% endif %}', {
        body: {},
        header: {},
      }),
    ).toThrow(PromptTemplateRenderError)
  })

  it('does not expose unknown template roots', () => {
    const prompt = renderHttpPromptTemplate('Secret={{ secrets.token }}', {
      body: {},
      header: {},
    })
    expect(prompt).toBe('Secret=')
  })
})
