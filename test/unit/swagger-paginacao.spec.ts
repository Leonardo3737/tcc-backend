import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { DisciplinasController } from '../../src/modules/disciplinas/disciplinas.controller';
import { DisciplinasService } from '../../src/modules/disciplinas/disciplinas.service';
import { MonitoriasController } from '../../src/modules/monitorias/monitorias.controller';
import { MonitoriasService } from '../../src/modules/monitorias/monitorias.service';

/**
 * Modulo minimo, so com os controllers, para gerar o documento OpenAPI sem
 * precisar de banco. Os services entram como stub porque nada e executado —
 * o que esta sob teste sao os DECORATORS.
 */
@Module({
  controllers: [DisciplinasController, MonitoriasController],
  providers: [
    { provide: DisciplinasService, useValue: {} },
    { provide: MonitoriasService, useValue: {} },
  ],
})
class ModuloDeDocumentacao {}

/**
 * Regressao do contrato publicado.
 *
 * `RespostaPaginada<T>` perde o generico na compilacao. Antes do decorator
 * @ApiRespostaPaginada, o documento descrevia toda listagem paginada como um
 * objeto com `meta` e SEM `dados` — quem gerasse tipos a partir do /docs-json
 * (openapi-typescript e afins) produzia um contrato errado e so descobriria em
 * runtime. Este teste falha se alguem voltar a usar
 * `@ApiOkResponse({ type: RespostaPaginada })`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- o documento OpenAPI e JSON dinamico */
describe('OpenAPI — listagens paginadas', () => {
  let documento: any;

  beforeAll(async () => {
    const app = await NestFactory.create(ModuloDeDocumentacao, { logger: false });

    documento = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('teste').setVersion('0').build(),
    );

    await app.close();
  });

  function schemaDaListagem(rota: string): any {
    return documento.paths[rota].get.responses['200'].content['application/json'].schema;
  }

  it.each([
    ['/disciplinas', 'DisciplinaRespostaDto'],
    ['/monitorias', 'MonitoriaRespostaDto'],
  ])('descreve dados como array de %s em %s', (rota, item) => {
    const schema = schemaDaListagem(rota);

    expect(schema.allOf).toBeDefined();

    const envelope = schema.allOf.find((parte: any) => '$ref' in parte);
    const conteudo = schema.allOf.find((parte: any) => 'properties' in parte);

    expect(envelope.$ref).toBe('#/components/schemas/RespostaPaginada');
    expect(conteudo.properties.dados.type).toBe('array');
    expect(conteudo.properties.dados.items.$ref).toBe(`#/components/schemas/${item}`);
  });

  it('registra o envelope e os itens em components.schemas', () => {
    const schemas = documento.components.schemas;

    expect(schemas.RespostaPaginada).toBeDefined();
    expect(schemas.MetaPaginacao).toBeDefined();
    expect(schemas.DisciplinaRespostaDto).toBeDefined();
    expect(schemas.MonitoriaRespostaDto).toBeDefined();
  });
});
