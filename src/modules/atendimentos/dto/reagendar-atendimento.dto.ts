import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsString, Length } from 'class-validator';

/**
 * Reagendamento: muda o horario SEM cancelar.
 *
 * A alternativa que existia era cancelar e criar outro atendimento — o que
 * deixava no historico um cancelamento (sugerindo que algo deu errado) e fazia
 * todos os inscritos perderem a inscricao. Aqui as inscricoes acompanham o novo
 * horario, propagadas pelo proprio banco.
 */
export class ReagendarAtendimentoDto {
  @ApiProperty({ example: '2026-09-15T17:00:00.000Z', format: 'date-time' })
  @IsDateString({}, { message: 'inicio deve ser uma data ISO 8601 valida' })
  inicio: string;

  @ApiProperty({ example: '2026-09-15T18:00:00.000Z', format: 'date-time' })
  @IsDateString({}, { message: 'fim deve ser uma data ISO 8601 valida' })
  fim: string;

  @ApiProperty({ example: 'Conflito com prova da disciplina.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'motivo deve ser um texto' })
  @Length(5, 500, { message: 'motivo deve ter entre 5 e 500 caracteres' })
  motivo: string;
}
