/**
 * MCP coverage of the instance's own API routes (docs/extension-points.md):
 * a deployment that adds routes under app/api (sign-up, billing, a
 * simulated bank) declares here, for each "METHOD /api/path", the MCP tools
 * doing the same, or why the route stays out of the MCP server (a French
 * reason). The guard of lib/mcp/__tests__/route-coverage.test.ts reads it
 * with Kledg's own map (lib/mcp/route-coverage.ts), so a fork never edits
 * Kledg's map. Kledg: no route of its own here.
 */

export type InstanceRouteCoverage = { tools: readonly string[] } | { excluded: string }

export const INSTANCE_ROUTE_COVERAGE: Readonly<Record<string, InstanceRouteCoverage>> = {}
