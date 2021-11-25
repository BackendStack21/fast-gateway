import * as restana from 'restana';

declare namespace fastgateway {
  type Type = 'http' | 'lambda';

  type Method = 'GET' | 'DELETE' | 'PATCH' | 'POST' | 'PUT' | 'HEAD' | 'OPTIONS' | 'TRACE';

  interface Docs {
    name: string;
    endpoint: string;
    type: string;
  }

  interface ProxyFactoryOpts {
    proxyType: string;
    opts: {};
    route: Route;
  }

  interface Route {
    proxyType?: Type;
    proxyConfig?: {};
    proxyHandler?: Function;
    http2?: boolean;
    pathRegex?: string;
    timeout?: number;
    prefix: string;
    docs?: Docs;
    prefixRewrite?: string;
    target: string;
    methods?: Method[];
    middlewares?: Function[];
    urlRewrite?: Function;
    hooks?: Hooks;
  }

  interface Hooks {
    onRequest?: Function,
    rewriteHeaders?: Function,
    onResponse?: Function,
    rewriteRequestHeaders?: Function,
    request?: {
      timeout?: number,
      [x: string]: any 
    }
    queryString?: string,
    [x: string]: any 
  }
  
  interface Options<P extends restana.Protocol> {
    server?: Object | restana.Service<P> | Express.Application;
    proxyFactory?: (opts: ProxyFactoryOpts) => Function;
    restana?: {};
    middlewares?: Function[];
    pathRegex?: string;
    timeout?: number;
    targetOverride?: string;
    routes: Route[];
  }
}

declare function fastgateway<P extends restana.Protocol = restana.Protocol.HTTP>(
  opts?: fastgateway.Options<P>
): restana.Service<P>;

export = fastgateway;
