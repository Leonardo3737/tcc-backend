import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { AlunosController } from './alunos.controller';
import { MonitoriaParticipante } from '../monitorias/entities/monitoria-participante.model';
import { Aluno } from './entities/aluno.model';
import { Professor } from './entities/professor.model';
import { Usuario } from './entities/usuario.model';
import { HashService } from './hash.service';
import { ProfessoresController } from './professores.controller';
import { AlunosMcpController } from './alunos.mcp-controller';
import { ProfessoresMcpController } from './professores.mcp-controller';
import { UsuariosController } from './usuarios.controller';
import { UsuariosMcpController } from './usuarios.mcp-controller';
import { UsuariosService } from './usuarios.service';
import { CursosModule } from '../cursos/cursos.module';

/**
 * USUARIO, ALUNO e PROFESSOR vivem no mesmo modulo porque compartilham um unico
 * ciclo de vida: as especializacoes sao 1:1 com o usuario e nascem na mesma
 * transacao. Separa-los em tres modulos criaria dependencia circular sem
 * nenhum ganho de coesao.
 *
 * HashService e exportado junto porque `senhaHash` e coluna de `usuarios` —
 * assim o AuthModule consome tudo de um unico import, sem ciclo.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Usuario, Aluno, Professor, MonitoriaParticipante]),
    CursosModule,
  ],
  controllers: [
    UsuariosController,
    AlunosController,
    ProfessoresController,
    UsuariosMcpController,
    AlunosMcpController,
    ProfessoresMcpController,
  ],
  providers: [UsuariosService, HashService],
  exports: [UsuariosService, HashService],
})
export class UsuariosModule {}
