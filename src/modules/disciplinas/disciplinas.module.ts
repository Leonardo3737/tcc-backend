import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { DisciplinasController } from './disciplinas.controller';
import { DisciplinasMcpController } from './disciplinas.mcp-controller';
import { DisciplinasService } from './disciplinas.service';
import { Disciplina } from './entities/disciplina.model';
import { DisciplinaCurso } from './entities/disciplina-curso.model';
import { CursosModule } from '../cursos/cursos.module';

@Module({
  imports: [SequelizeModule.forFeature([Disciplina, DisciplinaCurso]), CursosModule],
  controllers: [DisciplinasController, DisciplinasMcpController],
  providers: [DisciplinasService],
  exports: [DisciplinasService],
})
export class DisciplinasModule {}
