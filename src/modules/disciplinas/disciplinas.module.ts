import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { DisciplinasController } from './disciplinas.controller';
import { DisciplinasService } from './disciplinas.service';
import { Disciplina } from './entities/disciplina.model';

@Module({
  imports: [SequelizeModule.forFeature([Disciplina])],
  controllers: [DisciplinasController],
  providers: [DisciplinasService],
  exports: [DisciplinasService],
})
export class DisciplinasModule {}
