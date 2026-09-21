import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { TodasExcecoesFilter } from './common/filters/todas-excecoes.filter';
import { configuration } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AtendimentosModule } from './modules/atendimentos/atendimentos.module';
import { AvaliacoesModule } from './modules/avaliacoes/avaliacoes.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConfiguracaoModule } from './modules/configuracao/configuracao.module';
import { DisciplinasModule } from './modules/disciplinas/disciplinas.module';
import { DisponibilidadesModule } from './modules/disponibilidades/disponibilidades.module';
import { GamificacaoModule } from './modules/gamificacao/gamificacao.module';
import { MateriaisModule } from './modules/materiais/materiais.module';
import { MonitoriasModule } from './modules/monitorias/monitorias.module';
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
     * Rate limiting global, com teto apertado no login (ver AuthController).
     * Sem isso, forca bruta contra /auth/login e so uma questao de tempo.
     */
    ThrottlerModule.forRoot([{ name: 'padrao', ttl: 60_000, limit: 120 }]),

    DatabaseModule,
    ConfiguracaoModule,
    UsuariosModule,
    AuthModule,
    DisciplinasModule,
    MonitoriasModule,
    DisponibilidadesModule,
    AtendimentosModule,
    AvaliacoesModule,
    MateriaisModule,
    GamificacaoModule,
    AnalyticsModule,
  ],
  providers: [
    // Registrado aqui para valer sobre TODA a aplicacao, inclusive erros
    // levantados dentro de guards e pipes, que rodam antes dos controllers.
    { provide: APP_FILTER, useClass: TodasExcecoesFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
