import { getMetadataStorage } from 'class-validator';
import { targetConstructorToSchema } from 'class-validator-jsonschema';

type Ctor = new (...args: any[]) => any;

/**
 * Gera o JSON Schema de um DTO a partir dos decorators do class-validator
 * e completa com description/example do @nestjs/swagger, quando houver.
 * Use em @Tool({ parameters: dtoParaJsonSchema(MeuDto) }).
 */
export function dtoParaJsonSchema(dto: Ctor): Record<string, unknown> {
  const schema: any = targetConstructorToSchema(dto, {
    classValidatorMetadataStorage: getMetadataStorage(),
  });

  // Descrições e exemplos vindos do Swagger (inclui as classes-pai)
  for (const prop of Object.keys(schema.properties ?? {})) {
    const swagger = Reflect.getMetadata('swagger/apiModelProperties', dto.prototype, prop);
    if (!swagger) continue;
    const alvo = schema.properties[prop];
    if (swagger.description && !alvo.description) alvo.description = swagger.description;
    if (swagger.example !== undefined && alvo.examples === undefined) alvo.examples = [swagger.example];
  }

  schema.additionalProperties = false;
  return schema;
}