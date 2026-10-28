import { ValidationError, ValidationPipe } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

function mensagens(erros: ValidationError[], prefixo = ''): string[] {
  return erros.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...mensagens(e.children ?? [], `${prefixo}${e.property}.`),
  ]);
}

/**
 * ValidationPipe para handlers MCP: mesmas regras do REST, mas devolve
 * as mensagens do class-validator como erro da ferramenta (isError: true),
 * em vez de "Internal server error".
 */
export class McpValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      exceptionFactory: (erros) =>
        new RpcException(`Parametros invalidos: ${mensagens(erros).join('; ')}`),
    });
  }
}
