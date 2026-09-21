import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Nao inclui `status`, `disciplinaId`, `ano` nem `semestre`.
 *
 * Status muda por operacoes de dominio (ativar/encerrar/cancelar), que tem regras
 * de transicao. Disciplina e periodo sao a IDENTIDADE da oferta: altera-los
 * transformaria a monitoria em outra, invalidando participacoes e atendimentos
 * ja registrados. Para ofertar outra disciplina, cria-se outra monitoria.
 */
export class AtualizarMonitoriaDto {
  @ApiPropertyOptional({ example: 'Monitoria com foco em exercicios de prova.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'descricao deve ser um texto' })
  @MaxLength(2000, { message: 'descricao deve ter no maximo 2000 caracteres' })
  descricao?: string;

  @ApiPropertyOptional({ example: '2026-08-01', format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'dataInicio deve estar no formato AAAA-MM-DD' })
  dataInicio?: string;

  @ApiPropertyOptional({ example: '2026-12-15', format: 'date' })
  @IsOptional()
  @IsDateString({}, { message: 'dataFim deve estar no formato AAAA-MM-DD' })
  dataFim?: string;
}
