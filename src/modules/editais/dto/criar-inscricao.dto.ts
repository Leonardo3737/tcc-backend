import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

import { Turno } from '../../../common/enums/turno.enum';

/**
 * Converte nota de texto para numero, tratando VAZIO como ausente.
 *
 * Esta funcao existe por um motivo especifico e facil de errar. A inscricao
 * chega como `multipart/form-data` (por causa do PDF), e ali todo campo e
 * string — um campo de nota que o candidato nao preencheu chega como `''`, nao
 * como ausente.
 *
 * `@Type(() => Number)` resolveria a conversao e introduziria exatamente o bug
 * que o escopo proibe: `Number('')` e ZERO. A nota em branco viraria 0, a media
 * seria calculada com ela, e o candidato apareceria na lista da banca com nota
 * zero que ninguem lhe atribuiu. Por isso a conversao e explicita aqui, e `''`
 * vira `undefined` — que, com `@IsOptional`, significa "nao informado" e deixa
 * a coluna nula.
 *
 * Texto que nao e numero vira NaN de proposito: `@IsNumber` recusa NaN, e a
 * resposta e 400 em vez de uma nota silenciosamente perdida.
 */
export function notaInformada({ value }: { value: unknown }): number | undefined {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }

  return Number(value);
}

const DESCRICAO_NOTA =
  'Aceita decimal (ex.: 8.5), de 0 a 10, com no maximo 2 casas. Deixe em branco se a nota ' +
  'ainda nao existe: o campo em branco NAO vira zero, e a media fica nula.';

/**
 * Dados de uma candidatura. Endpoint PUBLICO — nada aqui pressupoe conta.
 *
 * `media` nao esta neste DTO e nao poderia estar: com `forbidNonWhitelisted`,
 * manda-la devolve 400, e no banco a coluna e GENERATED ALWAYS, que o
 * PostgreSQL recusa escrever. Sao duas barreiras independentes para a mesma
 * exigencia — o cliente nao define a media.
 *
 * O PDF do boletim NAO e campo deste DTO: vem no campo de arquivo `boletim` do
 * multipart e e validado no controller e no service (ver
 * `InscricoesEditalService.validarBoletim`).
 */
export class CriarInscricaoDto {
  @ApiProperty({ example: 'Maria Oliveira dos Santos' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'nomeCompleto deve ser um texto' })
  @MaxLength(150, { message: 'nomeCompleto deve ter no maximo 150 caracteres' })
  @Matches(/^(?=.{3,})\S+(\s+\S+)+$/, {
    message: 'nomeCompleto deve conter nome e sobrenome',
  })
  nomeCompleto: string;

  @ApiProperty({ example: '2021001234' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'matricula deve ser um texto' })
  @Matches(/^[A-Za-z0-9._-]{3,30}$/, {
    message: 'matricula deve ter de 3 a 30 caracteres alfanumericos, ponto, hifen ou underscore',
  })
  matricula: string;

  @ApiProperty({ example: 'maria@ufx.edu.br' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email deve ser um endereco de e-mail valido' })
  @MaxLength(150, { message: 'email deve ter no maximo 150 caracteres' })
  email: string;

  @ApiProperty({ format: 'uuid', description: 'Curso do candidato.' })
  @IsUUID('4', { message: 'cursoId deve ser um UUID valido' })
  cursoId: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Disciplina pretendida. Precisa ser oferecida pelo curso informado.',
  })
  @IsUUID('4', { message: 'disciplinaId deve ser um UUID valido' })
  disciplinaId: string;

  @ApiProperty({ format: 'uuid', description: 'Professor responsavel pela candidatura.' })
  @IsUUID('4', { message: 'professorId deve ser um UUID valido' })
  professorId: string;

  @ApiProperty({ enum: Turno })
  @IsEnum(Turno, { message: 'turno deve ser MATUTINO, VESPERTINO ou NOTURNO' })
  turno: Turno;

  @ApiPropertyOptional({ example: 8.5, minimum: 0, maximum: 10, description: DESCRICAO_NOTA })
  @IsOptional()
  @Transform(notaInformada)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'n1 deve ser um numero com ate 2 casas decimais' })
  @Min(0, { message: 'n1 deve ser no minimo 0' })
  @Max(10, { message: 'n1 deve ser no maximo 10' })
  n1?: number;

  @ApiPropertyOptional({ example: 9.25, minimum: 0, maximum: 10, description: DESCRICAO_NOTA })
  @IsOptional()
  @Transform(notaInformada)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'n2 deve ser um numero com ate 2 casas decimais' })
  @Min(0, { message: 'n2 deve ser no minimo 0' })
  @Max(10, { message: 'n2 deve ser no maximo 10' })
  n2?: number;
}
