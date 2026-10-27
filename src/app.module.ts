import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { TodasExcecoesFilter } from './common/filters/todas-excecoes.filter';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { McpModule } from './mcp/mcp.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AtendimentosModule } from './modules/atendimentos/atendimentos.module';
import { AuthModule } from './modules/auth/auth.module';
import { AvaliacoesModule } from './modules/avaliacoes/avaliacoes.module';
import { ConfiguracaoModule } from './modules/configuracao/configuracao.module';
import { CursosModule } from './modules/cursos/cursos.module';
import { DisciplinasModule } from './modules/disciplinas/disciplinas.module';
import { DisponibilidadesModule } from './modules/disponibilidades/disponibilidades.module';
import { EditaisModule } from './modules/editais/editais.module';
import { EmailModule } from './modules/email/email.module';
import { GamificacaoModule } from './modules/gamificacao/gamificacao.module';
import { LogsModule } from './modules/logs/logs.module';
import { MateriaisModule } from './modules/materiais/materiais.module';
import { MonitoriasModule } from './modules/monitorias/monitorias.module';
import { NotificacoesModule } from './modules/notificacoes/notificacoes.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { RelatoriosModule } from './modules/relatorios/relatorios.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    /**
     * Barramento de eventos em processo.
     *
     * Existe para desacoplar a gamificacao do nucleo: Atendimentos e Avaliacoes
     * emitem, Gamificacao escuta. Nao e mensageria — nao ha fila, retentativa nem
     * durabilidade, e nao precisa haver: perder um evento de pontuacao nao
     * corrompe nada de academico.
     */
    EventEmitterModule.forRoot(),

    /**
     * Agendador em processo, para o lembrete do dia e o reenvio de pendentes.
     *
     * Pinado em ^6: a versao 12 e ESM-only ("type": "module"), o mesmo que ja
     * obrigou a fixar o @nestjs/event-emitter em ^3 — quebra o Jest e o runtime
     * CommonJS deste projeto.
     */
    ScheduleModule.forRoot(),

    /**
     * Rate limiting global, com teto apertado no login (ver AuthController).
     * Sem isso, forca bruta contra /auth/login e so uma questao de tempo.
     */
    ThrottlerModule.forRoot([{ name: 'padrao', ttl: 60_000, limit: 120 }]),

    DatabaseModule,

    /**
     * Infraestrutura global, sem dominio. Registrado aqui para que a
     * configuracao de e-mail seja validada no boot, ainda que nenhum modulo o
     * consuma por enquanto.
     */
    EmailModule,

    /**
     * Trilha de requisicoes. Registra o interceptor global e o middleware que
     * marca o inicio; remover esta linha desliga o registro por inteiro.
     */
    LogsModule,

    ConfiguracaoModule,
    UsuariosModule,
    AuthModule,
    CursosModule,
    DisciplinasModule,
    MonitoriasModule,
    DisponibilidadesModule,
    AtendimentosModule,
    AvaliacoesModule,
    MateriaisModule,
    GamificacaoModule,
    AnalyticsModule,
    NotificacoesModule,
    EditaisModule,
    RelatoriosModule,
    McpModule,
    OAuthModule
  ],
  providers: [
    // Registrado aqui para valer sobre TODA a aplicacao, inclusive erros
    // levantados dentro de guards e pipes, que rodam antes dos controllers.
    { provide: APP_FILTER, useClass: TodasExcecoesFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
