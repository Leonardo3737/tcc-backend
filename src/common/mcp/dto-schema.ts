import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { getMetadataStorage } from 'class-validator';
import { targetConstructorToSchema } from 'class-validator-jsonschema';

type Ctor = new (...args: any[]) => any;

/** Um `$ref` direto na propriedade ou nos itens do array. */
function temReferencia(propriedade: any): boolean {
  return Boolean(propriedade?.$ref ?? propriedade?.items?.$ref);
}

function gerar(dto: Ctor, visitados: readonly Ctor[]): Record<string, unknown> {
  const schema: any = targetConstructorToSchema(dto, {
    classValidatorMetadataStorage: getMetadataStorage(),
    /**
     * Sem isto, `@ValidateNested` vira `$ref: '#/definitions/Array'`: o
     * class-validator sabe que a propriedade e uma lista de objetos, mas nao
     * de QUAIS objetos. Quem sabe e o `@Type(() => X)` do class-transformer.
     */
    classTransformerMetadataStorage: defaultMetadataStorage,
  });

  for (const prop of Object.keys(schema.properties ?? {})) {
    const alvo = schema.properties[prop];

    // Descricoes e exemplos vindos do Swagger (inclui as classes-pai)
    const swagger = Reflect.getMetadata('swagger/apiModelProperties', dto.prototype, prop);
    if (swagger) {
      if (swagger.description && !alvo.description) alvo.description = swagger.description;
      if (swagger.example !== undefined && alvo.examples === undefined)
        alvo.examples = [swagger.example];
    }

    if (!temReferencia(alvo)) continue;

    /**
     * Referencia aninhada: o schema de uma ferramenta MCP viaja SOZINHO ate o
     * cliente, sem o bloco `definitions` que o `$ref` pressupoe. Deixar a
     * referencia passar produziria uma ferramenta que o cliente nao consegue
     * chamar — e so descobriria isso tentando. Por isso o tipo e resolvido e
     * embutido aqui.
     */
    const aninhado = defaultMetadataStorage.findTypeMetadata(dto, prop)?.typeFunction?.() as
      Ctor | undefined;

    if (!aninhado) {
      throw new Error(
        `${dto.name}.${prop} tem objeto aninhado sem @Type(() => ...): nao da para montar o schema da ferramenta.`,
      );
    }

    if (visitados.includes(aninhado)) {
      throw new Error(
        `${dto.name}.${prop} forma um ciclo de tipos (${[...visitados, aninhado].map((c) => c.name).join(' -> ')}).`,
      );
    }

    const schemaAninhado = gerar(aninhado, [...visitados, dto]);

    schema.properties[prop] = alvo.items?.$ref
      ? { ...alvo, items: schemaAninhado }
      : { ...schemaAninhado, ...(alvo.description ? { description: alvo.description } : {}) };
  }

  schema.additionalProperties = false;
  return schema;
}

/**
 * Gera o JSON Schema de um DTO a partir dos decorators do class-validator
 * e completa com description/example do @nestjs/swagger, quando houver.
 * Use em @Tool({ parameters: dtoParaJsonSchema(MeuDto) }).
 *
 * Roda uma vez, na avaliacao do decorator: um DTO que nao produza schema
 * valido derruba o boot, e nao a primeira chamada da ferramenta em producao.
 */
export function dtoParaJsonSchema(dto: Ctor): Record<string, unknown> {
  const schema = gerar(dto, []);

  if (JSON.stringify(schema).includes('$ref')) {
    throw new Error(`Schema de ${dto.name} ficou com $ref pendente: ${JSON.stringify(schema)}`);
  }

  return schema;
}

/**
 * Schema para ferramentas que nao recebem argumento nenhum.
 *
 * Nao e o mesmo que omitir `parameters`: um objeto vazio e explicito faz o
 * cliente MCP chamar a ferramenta com `{}` em vez de inventar campos, e o
 * `additionalProperties: false` recusa qualquer coisa que ele mande por conta
 * propria.
 */
export const SEM_ARGUMENTOS: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};
