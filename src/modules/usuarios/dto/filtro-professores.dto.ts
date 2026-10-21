import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { PaginacaoDto } from '../../../common/dto/paginacao.dto';

/**
 * Os dois filtros de professor vivem no MESMO arquivo de proposito.
 *
 * Eles diferem em uma coisa so — o conjunto de colunas que a busca varre — e
 * essa diferenca e de seguranca, nao de comodidade. Lado a lado, ela fica
 * visivel para quem for mexer; em arquivos separados, copiar o campo errado de
 * um para o outro passa sem ninguem notar. O escopo real de cada um e aplicado
 * em `UsuariosService`, onde as duas listas de colunas tambem estao adjacentes.
 */

/**
 * Busca da listagem AUTENTICADA (`GET /professores`).
 *
 * Varre tudo que a resposta ja expoe a quem tem token: nome, e-mail,
 * identificacao funcional e departamento. O criterio e o mesmo de
 * `FiltroAlunosDto` — buscar por um campo que a propria listagem devolve nao
 * revela nada novo, so evita paginacao as cegas.
 */
export class FiltroProfessoresDto extends PaginacaoDto {
  @ApiPropertyOptional({
    description:
      'Busca parcial e sem distincao de caixa em nome, e-mail, identificacao funcional ou ' +
      'departamento.',
    example: 'carlos',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'busca deve ser um texto' })
  @MaxLength(150, { message: 'busca deve ter no maximo 150 caracteres' })
  busca?: string;
}

/**
 * Busca da listagem PUBLICA (`GET /professores/publicos`).
 *
 * Mesma forma, escopo menor: NOME e DEPARTAMENTO, nunca e-mail nem
 * identificacao funcional.
 *
 * A razao nao e simetria com a projecao de resposta — e que buscar e o caminho
 * inverso de expor, e nesta rota ele seria pior. `ProfessorPublicoDto` omite o
 * e-mail para nao entregar enderecos a um anonimo; se a busca aceitasse e-mail,
 * qualquer pessoa poderia digitar `fulano@ufx.edu.br` e descobrir, pelo acerto
 * ou pelo vazio, se aquele endereco pertence a um docente da instituicao. O
 * endereco nao apareceria na resposta, mas a resposta o CONFIRMARIA — e em
 * silencio, que e justamente o que torna um oraculo de existencia dificil de
 * perceber. E a mesma preocupacao que faz /auth/recuperacao/solicitar responder
 * 202 para e-mail inexistente.
 *
 * A identificacao funcional (SIAPE) fica fora pelo mesmo raciocinio, agravado
 * por ser dado administrativo que esta rota nao devolve em nenhum campo.
 */
export class FiltroProfessoresPublicosDto extends PaginacaoDto {
  @ApiPropertyOptional({
    description:
      'Busca parcial e sem distincao de caixa em nome ou departamento. NAO busca por ' +
      'e-mail nem por identificacao funcional: em rota publica, isso permitiria confirmar ' +
      'se um endereco pertence a um docente.',
    example: 'computacao',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'busca deve ser um texto' })
  @MaxLength(150, { message: 'busca deve ter no maximo 150 caracteres' })
  busca?: string;
}
