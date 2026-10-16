import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CursosModule } from '../cursos/cursos.module';
import { DisciplinasModule } from '../disciplinas/disciplinas.module';
import { Aluno } from '../usuarios/entities/aluno.model';
import { Professor } from '../usuarios/entities/professor.model';
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
 * DEPENDENCIAS DE MODULO, as duas de leitura e validacao:
 *
 *  - `CursosModule` e `DisciplinasModule` sao usados para recusar curso
 *    inativo, disciplina inativa e disciplina que o curso nao oferece ANTES de
 *    tentar inserir — a garantia e das FKs, a mensagem util vem desses dois.
 *
 * `Professor` e `Aluno` entram como MODEL, nao como modulo: as duas consultas
 * sao leituras simples ("este professor existe?", "esta matricula tem conta?")
 * e nao acionam nenhuma regra do UsuariosModule. Importar o modulo inteiro para
 * isso criaria dependencia que nao corresponde ao que se usa — o mesmo criterio
 * aplicado a Avaliacao em AtendimentosModule.
 *
 * O `EmailService` nao aparece aqui porque `EmailModule` e `@Global()`.
 *
 * Nenhum modulo consome este: editais sao uma ponta do sistema. A selecao
 * TERMINA quando o professor cria a conta do aprovado pelas rotas que ja
 * existem — nao ha automacao ligando inscricao aprovada a `usuarios`, por
 * exigencia explicita do escopo.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Edital, InscricaoEdital, Boletim, Professor, Aluno]),
    CursosModule,
    DisciplinasModule,
  ],
  controllers: [EditaisController, InscricoesPublicasController, InscricoesController],
  providers: [EditaisService, InscricoesEditalService],
})
export class EditaisModule {}
