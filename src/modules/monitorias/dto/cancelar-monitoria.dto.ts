import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CancelarMonitoriaDto {
  @ApiProperty({ example: 'Monitor desistiu e nao houve substituto.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'motivo deve ser um texto' })
  @Length(5, 500, { message: 'motivo deve ter entre 5 e 500 caracteres' })
  motivo: string;
}
