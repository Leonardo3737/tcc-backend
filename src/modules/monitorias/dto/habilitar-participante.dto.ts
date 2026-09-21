import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Operacao de dominio "habilitar monitor" (RN01), nao um INSERT generico.
 *
 * Nao existe campo `papel` no corpo de proposito: o papel vem da ROTA
 * (/monitores ou /monitorados), nao de um dado que o cliente escolhe. Isso
 * impede que alguem se habilite como MONITOR mandando um JSON diferente para o
 * endpoint de inscricao de monitorado.
 */
export class HabilitarParticipanteDto {
  @ApiProperty({ format: 'uuid', description: 'ID do usuario do aluno.' })
  @IsUUID('4', { message: 'alunoId deve ser um UUID valido' })
  alunoId: string;
}
