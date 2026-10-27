import { Module } from '@nestjs/common';

import { McpHttpController } from './mcp-http.controller';

@Module({ controllers: [McpHttpController] })
export class McpModule {}