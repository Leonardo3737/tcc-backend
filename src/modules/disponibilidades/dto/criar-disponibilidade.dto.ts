import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export class CriarDisponibilidadeDto {
  @ApiProperty({
    example: 2,
    minimum: 0,
    maximum: 6,
    description: '0 = domingo, 1 = segunda ... 6 = sabado.',
  })
  @Type(() => Number)
  @IsInt({ message: 'diaSemana deve ser um numero inteiro' })
  @Min(0, { message: 'diaSemana deve estar entre 0 (domingo) e 6 (sabado)' })
  @Max(6, { message: 'diaSemana deve estar entre 0 (domingo) e 6 (sabado)' })
  diaSemana: number;

  @ApiProperty({ example: '14:00' })
  @Matches(HORA, { message: 'horaInicio deve estar no formato HH:MM' })
  horaInicio: string;

  @ApiProperty({ example: '16:00' })
  @Matches(HORA, { message: 'horaFim deve estar no formato HH:MM' })
  horaFim: string;
}
