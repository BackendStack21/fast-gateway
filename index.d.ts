import * as restana from 'restana'
import { IncomingMessage } from 'http'

declare namespace fastgateway {
  type ProxyType = 'http' | 'http-legacy' | 'lambda' | (string & {})

  type Method =
    | 'GET'
    | 'DELETE'
    | 'PATCH'
    | 'POST'
    | 'PUT'
    | 'HEAD'
    | 'OPTIONS'
    | 'TRACE'

  interface Docs {
    name: string
    endpoint: string
    type: string
  }

  interface ProxyFactoryOpts {
    proxyType: ProxyType
    opts: {}
    route: Route
  }

  interface Route {
    proxyType?: ProxyType
    proxyConfig?: {}
    proxyHandler?: Function
    pathRegex?: string
    timeout?: number
    prefix: string | RegExp
    docs?: Docs
    prefixRewrite?: string
    target: string
    methods?: Method[]
    middlewares?: Function[]
    urlRewrite?: Function
    hooks?: Hooks
    disableQsOverwrite?: boolean
  }

  interface WebSocketRoute {
    proxyType: 'websocket'
    proxyConfig?: {} // https://github.com/faye/faye-websocket-node#initialization-options
    prefix: string | string[]
    target: string
    // upstream opening handshake timeout in milliseconds, 0 disables it. Default: 30000
    timeout?: number
    subProtocols?: string[] // https://github.com/faye/faye-websocket-node#subprotocol-negotiation
    hooks?: WebSocketHooks
  }

  interface WebSocketHooks {
    // "req" is the upgrade request (http.IncomingMessage): headers, cookies, origin...
    onOpen?: (
      ws: any,
      searchParams: URLSearchParams,
      req: IncomingMessage,
    ) => void | Promise<void>
  }

  interface Hooks {
    onRequest?: Function
    rewriteHeaders?: Function
    onResponse?: Function
    onError?: Function
    rewriteRequestHeaders?: Function
    request?: {
      timeout?: number
      [x: string]: any
    }
    queryString?: string
    [x: string]: any
  }

  interface Options<P extends restana.Protocol> {
    // any HTTP framework with a compatible API, e.g. an Express.js application
    server?: Object | restana.Service<P>
    proxyFactory?: (opts: ProxyFactoryOpts) => Function | null | undefined
    restana?: {}
    middlewares?: Function[]
    pathRegex?: string
    timeout?: number
    targetOverride?: string
    enableServicesEndpoint?: boolean
    routes: (Route | WebSocketRoute)[]
  }
}

declare function fastgateway<
  P extends restana.Protocol = restana.Protocol.HTTP,
>(opts: fastgateway.Options<P>): restana.Service<P>

export = fastgateway
