/* Mounts the Claude connector: OAuth endpoints + the MCP endpoint at /mcp (Streamable HTTP, stateless). */
import { getOAuthProtectedResourceMetadataUrl, requireBearerAuth } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppConfig } from '../config';
import type { Db } from '../db/client';
import type { FileStore } from '../files/store';
import { rateLimit } from '../http/security';
import { mcpUrlOf, oauthRouter, originOf, SCOPE, tokenVerifier } from './oauth';
import { buildMcpServer } from './tools';

export function mountMcp(app: Express, db: Db, config: AppConfig, fileStore?: FileStore): void {
  app.use(oauthRouter(db, config));

  const verifier = tokenVerifier(db, config);
  const handler = createMcpHandler(
    ctx => {
      // the token says which address it was issued for (https://<site>/mcp): links in tool results use that site
      const resource = ctx.authInfo?.resource;
      const origin = resource ? new URL(resource).origin : config.publicOrigin ?? '';
      return buildMcpServer(db, origin, fileStore);
    },
    { onerror: e => console.warn(`[mcp] ${e.message}`) }
  );
  const node = toNodeHandler(handler, { onerror: e => console.error('[mcp] request failed', e) });

  // one bearer check per site address (the address comes from PUBLIC_ORIGIN, or from the request in development)
  const gates = new Map<string, RequestHandler>();
  const bearer = (req: Request, res: Response, next: NextFunction) => {
    const url = new URL(mcpUrlOf(originOf(req, config)));
    let gate = gates.get(url.href);
    if (!gate) {
      gate = requireBearerAuth({ verifier, requiredScopes: [SCOPE], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(url), expectedResource: url });
      gates.set(url.href, gate);
    }
    gate(req, res, next);
  };

  // bearer tokens, no cookies: any origin may call it (e.g. MCP Inspector in a browser)
  const cors = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, mcp-method, mcp-name, last-event-id');
    res.setHeader('Access-Control-Expose-Headers', 'www-authenticate, mcp-session-id, mcp-protocol-version');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  };

  app.all('/mcp', cors, rateLimit({ name: 'mcp', windowMs: 60_000, max: 300 }), bearer, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    void node(req, res, req.body);
  });
}
