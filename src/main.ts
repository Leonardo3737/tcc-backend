import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { mcp } from './mcp/mcp.strategy';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const prefixo = config.getOrThrow<string>('app.prefixo');
  const porta = config.getOrThrow<number>('app.porta');
  const origens = config.get<string[]>('app.corsOrigens') ?? [];

  /* MCP */
  mcp.setHttpAdapter(app.getHttpAdapter())
  app.connectMicroservice({ strategy: mcp })



  /**
   * Cabecalhos de seguranca.
   *
   * A API e consumida por um frontend Next.js separado, entao o essencial aqui e
   * nosniff, sem-referrer e a remocao do X-Powered-By, que anuncia o stack. A CSP
   * padrao do helmet e desligada: ela protege paginas HTML servidas por este
   * processo, e a unica que existe e o proprio Swagger, que ela quebraria.
   */
  app.use(helmet({ contentSecurityPolicy: false }));

  app.setGlobalPrefix(prefixo, {
  exclude: [
    { path: '.well-known/oauth-protected-resource', method: RequestMethod.GET },
    { path: '.well-known/oauth-authorization-server', method: RequestMethod.GET },
  ],
});

  /**
   * Validacao global de entrada.
   *
   * - whitelist: remove campos nao declarados no DTO;
   * - forbidNonWhitelisted: alem de remover, rejeita a requisicao. E o que
   *   impede mass assignment — um cliente mandando {"ativo": false} ou
   *   {"perfil": "PROFESSOR"} recebe 400 em vez de ter o campo ignorado
   *   silenciosamente (ou, pior, aceito);
   * - transform: converte o payload para a classe do DTO, habilitando os
   *   @Transform e a conversao de tipos de query string.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // Sem origem configurada, o CORS fica fechado: e o navegador de um front
  // desconhecido que deve ser barrado, nao o contrario.
  app.enableCors({
    origin: origens.length > 0 ? origens : false,
    credentials: true,
  });

  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Plataforma de Apoio a Monitoria - API')
      .setDescription(
        'Backend da plataforma de monitoria academica. Cobre a fundacao ' +
        '(usuarios, alunos, professores, autenticacao e autorizacao), o nucleo ' +
        'funcional (cursos, disciplinas, monitorias, participantes, disponibilidades e ' +
        'atendimentos) e a selecao de monitores por edital, cuja inscricao e a UNICA ' +
        'rota de escrita publica da API. MONITOR e MONITORADO NAO sao tipos de usuario: sao papeis ' +
        'que um ALUNO assume dentro de uma MONITORIA especifica, representados em ' +
        'monitoria_participantes.papel. O mesmo aluno pode ser MONITOR em uma ' +
        'monitoria e MONITORADO em outra.',
      )
      .setVersion('0.2.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
      .build(),
  );

  SwaggerModule.setup('docs', app, documento, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.startAllMicroservices();
  await app.listen(porta);

  logger.log(`API em http://localhost:${porta}/${prefixo}`);
  logger.log(`Swagger em http://localhost:${porta}/docs`);
}

void bootstrap();
