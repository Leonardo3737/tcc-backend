import { Controller } from '@nestjs/common';
import { McpHttpControllerFor } from '@rekog/mcp-nest';

import { mcpTransport } from './mcp.strategy';

/**
 * Monta o endpoint MCP como um controller Nest. Assim os APP_GUARD globais
 * (JwtAuthGuard, PerfilGuard, ThrottlerGuard) rodam em toda requisição MCP,
 * inclusive no tools/list.
 */
@Controller('mcp')
export class McpHttpController extends McpHttpControllerFor(mcpTransport) {}