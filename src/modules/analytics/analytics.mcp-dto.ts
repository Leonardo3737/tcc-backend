import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

import { CampoId } from '../../common/mcp/campo-id.decorator';

export class IndicadoresDaPlataformaMcpDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Restringe os numeros as monitorias do professor autenticado.',
  })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'apenasMinhas deve ser booleano' })
  apenasMinhas?: boolean;
}

export class IndicadoresDaMonitoriaMcpDto {
  @CampoId('monitoriaId', 'ID da monitoria.')
  monitoriaId: string;
}
