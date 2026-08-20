export type AuthToken = string | undefined;
export interface Auth {
    in?: 'header' | 'query' | 'cookie';
    key?: string;
    name?: string;
    scheme?: never;
    type: 'apiKey' | 'http';
}
export declare const getAuthToken: (_auth: Auth, _callback: ((auth: Auth) => Promise<AuthToken> | AuthToken) | AuthToken) => Promise<string | undefined>;
