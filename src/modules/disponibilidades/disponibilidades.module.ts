import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { MonitoriasModule } from '../monitorias/monitorias.module';
import { DisponibilidadesController } from './disponibilidades.controller';
import { DisponibilidadesService } from './disponibilidades.service';
import { Disponibilidade } from './entities/disponibilidade.model';

@Module({
  imports: [SequelizeModule.forFeature([Disponibilidade]), MonitoriasModule],
  controllers: [DisponibilidadesController],
  providers: [DisponibilidadesService],
  // Exportado porque o agendamento de atendimento valida a janela do monitor.
  exports: [DisponibilidadesService],
})
export class DisponibilidadesModule {}
