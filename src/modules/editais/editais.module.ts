import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CursosModule } from '../cursos/cursos.module';
import { Monitoria } from '../monitorias/entities/monitoria.model';
import { MonitoriasModule } from '../monitorias/monitorias.module';
import { DisciplinasModule } from '../disciplinas/disciplinas.module';
import { Aluno } from '../usuarios/entities/aluno.model';
import { Professor } from '../usuarios/entities/professor.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { UsuariosModule } from '../usuarios/usuarios.module';
import { AprovacaoDeInscricaoService } from './aprovacao-de-inscricao.service';
import { EditaisController } from './editais.controller';
import { EditaisService } from './editais.service';
import { Boletim } from './entities/boletim.model';
import { Edital } from './entities/edital.model';
import { InscricaoEdital } from './entities/inscricao-edital.model';
import { InscricoesController } from './inscricoes.controller';
import { InscricoesEditalService } from './inscricoes-edital.service';
import { InscricoesPublicasController } from './inscricoes-publicas.controller';

/**
 * Edital, inscricao e boletim ficam no mesmo modulo: nenhum dos dois ultimos
 * existe fora de um edital, e inscricao e boletim precisam entrar na MESMA
 * transacao — separar empurraria a transacao para fora da fronteira do modulo.
 * E a mesma razao que mantem atendimento, inscricao e historico juntos.
 *
 * DEPENDENCIAS DE MODULO:
 *
 *  - `CursosModule` e `DisciplinasModule` recusam curso inativo, disciplina
 *    inativa e disciplina que o curso nao oferece ANTES de tentar inserir — a
 *    garantia e das FKs, a mensagem util vem desses dois;
 *  - `UsuariosModule` e `MonitoriasModule` sustentam a APROVACAO de
 *    candidatura: ver a nota junto dos imports.
 *
 * `Professor`, `Aluno`, `Usuario` e `Monitoria` entram tambem como MODEL, para
 * leituras simples que nao acionam regra alguma ("este professor existe?",
 * "esta matricula tem conta?", "a monitoria desta oferta ja existe?"). E o
 * mesmo criterio aplicado a Avaliacao em AtendimentosModule — a ESCRITA, em
 * todos os casos, vai pelo service do modulo dono.
 *
 * O `EmailService` nao aparece aqui porque `EmailModule` e `@Global()`.
 *
 * ---------------------------------------------------------------------------
 * ESTE MODULO DEIXOU DE SER UMA PONTA
 *
 * Ate a aprovacao existir, nenhum modulo era consumido por este e a selecao
 * terminava fora do sistema: o professor lia os dados da inscricao e cadastrava
 * o aprovado a mao. `POST /inscricoes/:id/aprovar` fechou esse ciclo — a
 * candidatura aprovada agora cria conta, monitoria e vinculo de MONITOR.
 *
 * A direcao continua uma so: Editais conhece Usuarios e Monitorias, e nenhum
 * dos dois conhece Editais. O unico rastro no sentido inverso e a coluna
 * `monitorias.edital_id`, que e NULAVEL e nao cria dependencia de codigo —
 * monitoria sem edital segue sendo o caminho normal.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      Edital,
      InscricaoEdital,
      Boletim,
      Professor,
      Aluno,
      Usuario,
      /** Somente LEITURA: reaproveitar a monitoria da oferta na aprovacao. */
      Monitoria,
    ]),
    CursosModule,
    DisciplinasModule,
    /**
     * A aprovacao de candidatura PRECISA destes dois como MODULO, nao como
     * model: ela cria conta de aluno por `UsuariosService` (senha gerada,
     * entregue por e-mail, autoria registrada) e cria a monitoria e o vinculo
     * de MONITOR por `MonitoriasService`/`ParticipantesService`, que carregam
     * RN01, RN09 e a checagem de curso compativel. Reimplementar qualquer um
     * desses passos aqui perderia regra em silencio.
     *
     * Nenhum dos dois conhece este modulo, entao a dependencia e unidirecional.
     */
    UsuariosModule,
    MonitoriasModule,
  ],
  controllers: [EditaisController, InscricoesPublicasController, InscricoesController],
  providers: [EditaisService, InscricoesEditalService, AprovacaoDeInscricaoService],
})
export class EditaisModule {}
