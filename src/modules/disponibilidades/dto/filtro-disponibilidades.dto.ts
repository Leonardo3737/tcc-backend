import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class FiltroDisponibilidadesDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Filtra pelo vinculo do monitor.' })
  @IsOptional()
  @IsUUID('4', { message: 'participanteId deve ser um UUID valido' })
  participanteId?: string;

  @ApiPropertyOptional({ default: true, description: 'Padrao: apenas faixas ativas.' })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'ativa deve ser booleano' })
  ativa?: boolean;
}
