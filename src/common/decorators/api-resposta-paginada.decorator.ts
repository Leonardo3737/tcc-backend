import { Type, applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

import { RespostaPaginada } from '../dto/resposta-paginada.dto';

/**
 * Descreve corretamente uma listagem paginada no OpenAPI.
 *
 * O problema que isto resolve: `@ApiOkResponse({ type: RespostaPaginada })`
 * apaga o generico. TypeScript remove `<T>` na compilacao, entao o Swagger via
 * apenas `{ meta }` e o array `dados` simplesmente NAO aparecia no documento —
 * qualquer geracao de tipos a partir do /docs-json produzia um contrato errado.
 *
 * A solucao padrao do @nestjs/swagger para genericos e compor o schema a mao:
 * `allOf` junta o envelope (que traz `meta`) com um `dados` tipado pelo item.
 * `ApiExtraModels` e necessario porque nem o envelope nem o item aparecem em
 * nenhuma assinatura que o plugin do CLI consiga inspecionar.
 *
 * Uso: `@ApiRespostaPaginada(AlunoRespostaDto)` no lugar do `@ApiOkResponse`.
 */
export const ApiRespostaPaginada = <TModelo extends Type<unknown>>(
  modelo: TModelo,
  descricao?: string,
) =>
  applyDecorators(
    ApiExtraModels(RespostaPaginada, modelo),
    ApiOkResponse({
      description: descricao,
      schema: {
        allOf: [
          { $ref: getSchemaPath(RespostaPaginada) },
          {
            properties: {
              dados: { type: 'array', items: { $ref: getSchemaPath(modelo) } },
            },
            required: ['dados'],
          },
        ],
      },
    }),
  );
