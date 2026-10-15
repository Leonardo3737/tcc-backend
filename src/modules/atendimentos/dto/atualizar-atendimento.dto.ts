import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

/**
 * Dados basicos de um atendimento ja agendado.
 *
 * NAO inclui `inicio` nem `fim`, e isso e o ponto principal deste DTO. Mudar
 * horario por aqui contornaria tudo o que o reagendamento faz: validar a janela
 * de disponibilidade do monitor, recusar conflito de agenda dos inscritos
 * (RN03), registrar a transicao no historico (RN10) e avisar quem ja estava
 * inscrito. Horario muda em POST /atendimentos/:id/reagendar, e so la.
 *
 * Tambem nao inclui `status` (muda por realizar/cancelar, que tem pre-condicoes),
 * nem `monitoriaId`, `monitorParticipanteId` ou `origem` — identidade e
 * procedencia da sessao. Trocar o monitor de um atendimento com inscritos nao e
 * edicao: e outro atendimento.
 *
 * `modalidade` tambem ficou de fora, e com isso e definida no agendamento e
 * nao muda mais. Quem se inscreveu escolheu comparecer a uma sessao presencial
 * ou remota; virar a chave depois mudaria o compromisso assumido sem que a
 * inscricao fosse refeita. `local` continua editavel, o que cobre o caso real
 * de corrigir a sala ou o link sem alterar a natureza do encontro.
 */
export class AtualizarAtendimentoDto {
  @ApiPropertyOptional({ example: 'Duvidas sobre limites e continuidade' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'assunto deve ser um texto' })
  @Length(3, 200, { message: 'assunto deve ter entre 3 e 200 caracteres' })
  assunto?: string;

  /**
   * Aceita string vazia para LIMPAR o local.
   *
   * Sem isso nao haveria como remover um local ja informado: omitir o campo
   * significa "nao mexer", e `null` nao passa pelo `IsString`. A conversao de
   * vazio para `null` fica no service, junto da regra.
   */
  @ApiPropertyOptional({
    example: 'Sala 203 / https://meet.exemplo/abc',
    description: 'String vazia remove o local.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'local deve ser um texto' })
  @MaxLength(150, { message: 'local deve ter no maximo 150 caracteres' })
  local?: string;

  @ApiPropertyOptional({
    example: 5,
    minimum: 1,
    maximum: 50,
    description: 'Nao pode ficar abaixo do numero de inscritos ativos.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'vagas deve ser um numero inteiro' })
  @Min(1, { message: 'vagas deve ser no minimo 1' })
  @Max(50, { message: 'vagas deve ser no maximo 50' })
  vagas?: number;
}
