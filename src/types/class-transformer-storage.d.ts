/**
 * Tipagem do caminho interno `class-transformer/cjs/storage`.
 *
 * O `defaultMetadataStorage` e a unica forma de descobrir, a partir de
 * `@Type(() => X)`, QUAL classe ha dentro de uma lista anotada com
 * `@ValidateNested` — informacao que o class-validator sozinho nao tem. E o que
 * permite ao gerador de schema das ferramentas MCP embutir o objeto aninhado em
 * vez de emitir um `$ref` que o cliente nao resolve.
 *
 * A biblioteca exporta o modulo em runtime mas nao o declara no `exports` do
 * package.json com tipos, entao a declaracao mora aqui. O tipo em si e o
 * publicado pela propria biblioteca — nao e um `any` disfarcado.
 */
declare module 'class-transformer/cjs/storage' {
  import { MetadataStorage } from 'class-transformer/types/MetadataStorage';

  export const defaultMetadataStorage: MetadataStorage;
}
