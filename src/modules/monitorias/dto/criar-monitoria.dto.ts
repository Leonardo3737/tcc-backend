import { ApiHideProperty, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CriarMonitoriaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'disciplinaId deve ser um UUID valido' })
  disciplinaId: string;

  /**
   * Professor responsavel. PREENCHIDO PELO SERVIDOR, nunca pelo cliente.
   *
   * O campo esta no DTO, mas nao tem decorator de validacao nenhum — e isso e
   * o mecanismo, nao esquecimento. O `ValidationPipe` global roda com
   * `whitelist` e `forbidNonWhitelisted`: propriedade sem decorator de
   * validacao nao entra na whitelist, entao manda-la devolve
   * 400 ("property professorId should not exist"). Nao ha caminho da
   * requisicao ate aqui.
   *
   * `@ApiHideProperty` existe pelo mesmo motivo: sem ele o plugin CLI do
   * @nestjs/swagger anunciaria no schema um campo que a API recusa.
   *
   * Quem preenche, em cada um dos dois caminhos:
   *
   *  - `POST /monitorias` -> o CONTROLLER, com o id do usuario autenticado.
   *    O efeito e o mesmo de antes: a monitoria e sempre de quem a criou;
   *  - aprovacao de candidatura -> o professor que o CANDIDATO indicou na
   *    inscricao, lido do banco. E o professor que vai supervisionar aquela
   *    disciplina, e e por isso que o valor deixou de ser sempre o do
   *    autenticado.
   *
   * A garantia de que o valor e de um professor de verdade e a FK
   * `monitorias_professor_id_fkey` para `professores(usuario_id)`: id que nao
   * seja de professor e recusado pelo banco.
   */
  @ApiHideProperty()
  professorId: string;

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

  @ApiPropertyOptional({ example: 'Monitoria de apoio para listas e provas.' })
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
