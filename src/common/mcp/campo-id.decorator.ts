import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Campo de identificador nos DTOs de argumento das ferramentas MCP.
 *
 * No REST esses ids chegam como parametro de rota e passam pelo
 * `ParseUUIDPipe`. Uma ferramenta MCP recebe um unico objeto de argumentos,
 * entao o id vira propriedade do DTO — e precisa da MESMA recusa de valor mal
 * formado, senao um id invalido chega ao Sequelize e volta como erro interno
 * em vez de mensagem util.
 *
 * Existe como decorator composto porque o par @ApiProperty + @IsUUID se repete
 * em dezenas de DTOs de argumento: escrever os dois a mao convida a esquecer o
 * segundo, que e justamente o que valida.
 */
export function CampoId(nome: string, descricao: string) {
  return applyDecorators(
    ApiProperty({ format: 'uuid', description: descricao }),
    IsUUID('4', { message: `${nome} deve ser um UUID valido` }),
  );
}
