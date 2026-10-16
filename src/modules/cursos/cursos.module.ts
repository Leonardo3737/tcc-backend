import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { CursosController } from './cursos.controller';
import { CursosService } from './cursos.service';
import { Curso } from './entities/curso.model';

/**
 * Catalogo de cursos, no mesmo molde de DisciplinasModule.
 *
 * Exporta o service porque Disciplinas e Usuarios precisam VALIDAR o curso
 * informado na criacao — e melhor uma dependencia explicita de modulo do que
 * cada um registrar o model por conta propria e reimplementar a checagem.
 */
@Module({
  imports: [SequelizeModule.forFeature([Curso])],
  controllers: [CursosController],
  providers: [CursosService],
  exports: [CursosService],
})
export class CursosModule {}
