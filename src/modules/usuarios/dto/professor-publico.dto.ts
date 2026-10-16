import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Professor } from '../entities/professor.model';

/**
 * Professor visto por quem NAO esta autenticado.
 *
 * Existe por uma necessidade concreta: a inscricao em edital e publica e exige
 * escolher o professor responsavel, entao o formulario precisa de uma lista de
 * professores sem token. A rota autenticada que ja existe (`GET /professores`)
 * nao serve para isso — ela devolve `UsuarioRespostaDto`, que inclui o E-MAIL,
 * e expor e-mail de docente em rota anonima transformaria o formulario em fonte
 * de endereco para spam. O escopo proibe expor dado pessoal em listagem
 * publica.
 *
 * Por isso a projecao e minima e deliberada: identificador, nome e
 * departamento. Nome e departamento de docente sao informacao institucional
 * publicada pela propria instituicao — o criterio ja registrado em
 * `ProfessoresController.listar`. Fora ficam e-mail, identificacao funcional
 * (matricula funcional e dado administrativo), situacao da conta e timestamps.
 *
 * Nao e substituto de `UsuarioRespostaDto`: a rota autenticada continua a
 * mesma, com os mesmos campos, para quem tem token.
 */
export class ProfessorPublicoDto {
  @ApiProperty({ format: 'uuid' })
  usuarioId: string;

  @ApiProperty({ example: 'Carlos Lima' })
  nome: string;

  @ApiPropertyOptional({ example: 'Departamento de Computacao', nullable: true })
  departamento: string | null;

  static deModelo(professor: Professor): ProfessorPublicoDto {
    const dto = new ProfessorPublicoDto();
    dto.usuarioId = professor.usuarioId;
    dto.nome = professor.usuario?.nome ?? '';
    dto.departamento = professor.departamento;
    return dto;
  }
}
