import { type ListItem, type ListResponse, type RpcRequestType, type RpcResponseType, rpcRequest, v1 } from './core'

type ProjectsRpc = typeof v1.projects

export type ProjectListResponse = RpcResponseType<ProjectsRpc['$get'], 200>
export type Project = ListItem<ProjectListResponse>
export type ProjectInput = RpcRequestType<ProjectsRpc['$post']>['json']
export type ProjectUpdateInput = RpcRequestType<ProjectsRpc[':projectId']['$patch']>['json']

export const projectsApi = {
  listProjects: () => rpcRequest<ListResponse<Project>>(v1.projects.$get({ query: {} })),
  createProject: (input: ProjectInput) => rpcRequest<Project>(v1.projects.$post({ json: input })),
  updateProject: (projectId: string, input: ProjectUpdateInput) =>
    rpcRequest<Project>(v1.projects[':projectId'].$patch({ param: { projectId }, json: input })),
  deleteProject: (projectId: string) => rpcRequest<void>(v1.projects[':projectId'].$delete({ param: { projectId } })),
}
