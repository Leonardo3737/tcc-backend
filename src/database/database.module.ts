import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';

import { Atendimento } from '../modules/atendimentos/entities/atendimento.model';
import { AtendimentoParticipante } from '../modules/atendimentos/entities/atendimento-participante.model';
import { AtendimentoStatusHistorico } from '../modules/atendimentos/entities/atendimento-status-historico.model';
import { Avaliacao } from '../modules/avaliacoes/entities/avaliacao.model';
import { Disciplina } from '../modules/disciplinas/entities/disciplina.model';
import { PontuacaoEvento } from '../modules/gamificacao/entities/pontuacao-evento.model';
import { RecuperacaoSenha } from '../modules/auth/entities/recuperacao-senha.model';
import { Notificacao } from '../modules/notificacoes/entities/notificacao.model';
import { LogRequisicao } from '../modules/logs/entities/log-requisicao.model';
import { Material } from '../modules/materiais/entities/material.model';
import { Disponibilidade } from '../modules/disponibilidades/entities/disponibilidade.model';
import { Monitoria } from '../modules/monitorias/entities/monitoria.model';
import { MonitoriaParticipante } from '../modules/monitorias/entities/monitoria-participante.model';
import { Aluno } from '../modules/usuarios/entities/aluno.model';
import { Professor } from '../modules/usuarios/entities/professor.model';
import { Usuario } from '../modules/usuarios/entities/usuario.model';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'postgres' as const,
        host: config.getOrThrow<string>('database.host'),
        port: config.getOrThrow<number>('database.port'),
        database: config.getOrThrow<string>('database.database'),
        username: config.getOrThrow<string>('database.username'),
        password: config.getOrThrow<string>('database.password'),
        logging: config.get<boolean>('database.logging') ? console.log : false,

        models: [
          Usuario,
          Aluno,
          Professor,
          Disciplina,
          Monitoria,
          MonitoriaParticipante,
          Disponibilidade,
          Atendimento,
          AtendimentoParticipante,
          AtendimentoStatusHistorico,
          Avaliacao,
          Material,
          PontuacaoEvento,
          RecuperacaoSenha,
          Notificacao,
          LogRequisicao,
        ],

        /**
         * AD-04: o schema e propriedade das migrations, nunca do ORM.
         * `synchronize: true` apagaria/alteraria colunas silenciosamente e nao
         * consegue criar as constraints que sustentam as regras de negocio
         * (indices parciais, EXCLUDE, FKs compostas) previstas para a fase 2.
         */
        synchronize: false,
        autoLoadModels: false,

        define: {
          underscored: true,
          timestamps: true,
        },
      }),
    }),
  ],
})
export class DatabaseModule {}
