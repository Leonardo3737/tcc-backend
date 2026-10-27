import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { AtendimentoParticipante } from '../atendimentos/entities/atendimento-participante.model';
import { Atendimento } from '../atendimentos/entities/atendimento.model';
import { DisciplinasModule } from '../disciplinas/disciplinas.module';
import { DisciplinaCurso } from '../disciplinas/entities/disciplina-curso.model';
import { Aluno } from '../usuarios/entities/aluno.model';
import { MonitoriaParticipante } from './entities/monitoria-participante.model';
import { Monitoria } from './entities/monitoria.model';
import { ParticipacaoGuard } from './guards/participacao.guard';
import { MonitoriasController } from './monitorias.controller';
import { MonitoriasMcpController } from './monitorias.mcp-controller';
import { MonitoriasService } from './monitorias.service';
import { ParticipacaoService } from './participacao.service';
import { ParticipantesController } from './participantes.controller';
import { ParticipantesService } from './participantes.service';

/**
 * MONITORIA e MONITORIA_PARTICIPANTE vivem no mesmo modulo porque o vinculo nao
 * existe fora da monitoria e todas as suas rotas sao sub-recursos
 * (/monitorias/:id/...). Separa-los criaria dependencia circular sem ganho.
 *
 * Os models de atendimento sao registrados aqui apenas para LEITURA: encerrar
 * uma monitoria ou uma participacao precisa verificar se ha atendimentos
 * pendentes. Isso registra o repositorio sem importar o AtendimentosModule, o
 * que evitaria um ciclo — AtendimentosModule depende deste.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Monitoria,
      MonitoriaParticipante,
      Aluno,
      Atendimento,
      AtendimentoParticipante,
      /**
       * Somente LEITURA: `ParticipantesService` consulta a associacao para
       * dizer se o curso do aluno esta entre os da disciplina. E import de
       * model, nao de modulo — nao cria ciclo com DisciplinasModule.
       */
      DisciplinaCurso,
    ]),
    DisciplinasModule,
  ],
  controllers: [MonitoriasController, ParticipantesController, MonitoriasMcpController],
  providers: [MonitoriasService, ParticipacaoService, ParticipantesService, ParticipacaoGuard],
  exports: [MonitoriasService, ParticipacaoService, ParticipantesService, ParticipacaoGuard],
})
export class MonitoriasModule {}
