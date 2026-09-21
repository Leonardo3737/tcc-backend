import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { MonitoriasModule } from '../monitorias/monitorias.module';
import { Material } from './entities/material.model';
import { MateriaisController } from './materiais.controller';
import { MateriaisService } from './materiais.service';

@Module({
  imports: [SequelizeModule.forFeature([Material]), MonitoriasModule],
  controllers: [MateriaisController],
  providers: [MateriaisService],
  exports: [MateriaisService],
})
export class MateriaisModule {}
