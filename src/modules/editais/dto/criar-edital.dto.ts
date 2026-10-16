import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsInt, IsUrl, Matches, Max, MaxLength, Min } from 'class-validator';

/** Aceita apenas data de calendario, sem hora. Ver `DESCRICAO_DATA`. */
export const PADRAO_DATA = /^\d{4}-\d{2}-\d{2}$/;

const DESCRICAO_DATA =
  'Data de calendario (AAAA-MM-DD), sem hora. O periodo e um intervalo de DIAS no fuso ' +
  'da instituicao: aceitar instante obrigaria a escolher uma hora de corte arbitraria e ' +
  'faria o mesmo edital abrir em dias diferentes conforme o fuso de quem consulta.';

export class CriarEditalDto {
  @ApiProperty({ example: '2026-11-10', format: 'date', description: DESCRICAO_DATA })
  @Matches(PADRAO_DATA, { message: 'inicioInscricoes deve estar no formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'inicioInscricoes nao e uma data valida' })
  inicioInscricoes: string;

  @ApiProperty({ example: '2026-11-25', format: 'date', description: DESCRICAO_DATA })
  @Matches(PADRAO_DATA, { message: 'fimInscricoes deve estar no formato AAAA-MM-DD' })
  @IsDateString({ strict: true }, { message: 'fimInscricoes nao e uma data valida' })
  fimInscricoes: string;

  /**
   * URL do documento oficial. O sistema NAO hospeda o edital — ele aponta para
   * onde a instituicao ja publica, que e a copia com fe publica.
   *
   * `require_protocol` ligado de proposito: "www.ufx.edu.br/edital.pdf" vira
   * link relativo no e-mail e no frontend, e ninguem descobre isso antes de
   * algum candidato clicar.
   */
  @ApiProperty({ example: 'https://ufx.edu.br/editais/2026-2-monitoria.pdf' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(2048, { message: 'link deve ter no maximo 2048 caracteres' })
  @IsUrl(
    { require_protocol: true, protocols: ['http', 'https'] },
    { message: 'link deve ser uma URL http ou https completa' },
  )
  link: string;

  @ApiProperty({ example: 2026, minimum: 2000, maximum: 2100 })
  @Type(() => Number)
  @IsInt({ message: 'ano deve ser um numero inteiro' })
  @Min(2000, { message: 'ano deve ser no minimo 2000' })
  @Max(2100, { message: 'ano deve ser no maximo 2100' })
  ano: number;

  @ApiProperty({ example: 2, enum: [1, 2] })
  @Type(() => Number)
  @IsInt({ message: 'semestre deve ser um numero inteiro' })
  @Min(1, { message: 'semestre deve ser 1 ou 2' })
  @Max(2, { message: 'semestre deve ser 1 ou 2' })
  semestre: number;
}
