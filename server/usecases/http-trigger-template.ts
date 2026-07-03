import { Liquid } from 'liquidjs'

export class PromptTemplateRenderError extends Error {
  readonly field: string
  constructor(message: string, field: string) {
    super(message)
    this.name = 'PromptTemplateRenderError'
    this.field = field
  }
}

export interface HttpTriggerTemplateContext {
  body: unknown
  header: Record<string, string>
  run?: {
    session_reused: boolean
    session_id: string | null
    session_state: string | null
  }
}

const promptTemplateEngine = new Liquid({
  jsTruthy: true,
  strictFilters: false,
  strictVariables: false,
})

function normalizeRootPaths(template: string): string {
  return template.replace(
    /({[{%]-?\s*)(.*?)(\s*-?[}%]})/gs,
    (_match, open: string, expression: string, close: string) => {
      const normalized = expression.replace(/(^|[^\w"'])\.(?=[A-Za-z_])/g, '$1')
      return `${open}${normalized}${close}`
    },
  )
}

function templateContext(context: HttpTriggerTemplateContext): Record<string, unknown> {
  return {
    body: context.body,
    header: context.header,
    ama: {
      run: context.run ?? {
        session_reused: false,
        session_id: null,
        session_state: null,
      },
    },
  }
}

export function renderHttpPromptTemplate(template: string, context: HttpTriggerTemplateContext): string {
  try {
    const rendered: unknown = promptTemplateEngine.parseAndRenderSync(
      normalizeRootPaths(template),
      templateContext(context),
    )
    return String(rendered)
  } catch (error) {
    const message = String(error).replace(/^Error: /, '')
    throw new PromptTemplateRenderError(message, 'promptTemplate')
  }
}
