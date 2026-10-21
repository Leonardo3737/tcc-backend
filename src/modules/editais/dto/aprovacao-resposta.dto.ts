import { ApiProperty } from '@nestjs/swagger';

/**
 * De onde saiu a monitoria da aprovacao.
 *
 * Tres estados, nao um booleano, porque o terceiro precisa ser VISIVEL: a
 * aprovacao pode adotar uma monitoria que o professor abriu a mao, gravando
 * nela o vinculo com o edital. Escrever em um registro que outra pessoa criou e
 * algo que quem aprova tem o direito de saber que aconteceu.
 */
export enum OrigemDaMonitoria {
  /** Nao existia nada para esta oferta: a monitoria nasceu agora. */
  CRIADA = 'CRIADA',

  /** Ja existia, vinda DESTE edital. E o segundo monitor da disciplina. */
  REUSADA = 'REUSADA',

  /**
   * Ja existia SEM edital — aberta a mao antes da selecao — e passou a apontar
   * para este edital. Nada mais dela foi alterado.
   */
  ADOTADA = 'ADOTADA',
}

class MonitoriaCriadaDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) disciplinaId: string;
  @ApiProperty({ example: 2026 }) ano: number;
  @ApiProperty({ example: 2 }) semestre: number;

  /**
   * Nao e detalhe de implementacao: e a diferenca entre "abri a monitoria de
   * Banco de Dados", "acrescentei o segundo monitor a que eu ja tinha" e "usei
   * a monitoria que voce mesmo havia aberto". A tela precisa poder dizer qual
   * das tres aconteceu — a ultima mais que as outras.
   */
  @ApiProperty({
    enum: OrigemDaMonitoria,
    example: OrigemDaMonitoria.CRIADA,
    description:
      'CRIADA = nasceu agora. REUSADA = ja existia, vinda deste edital. ' +
      'ADOTADA = existia sem edital e passou a apontar para este.',
  })
  origem: OrigemDaMonitoria;
}

class MonitorHabilitadoDto {
  @ApiProperty({ format: 'uuid', description: 'Id do usuario/aluno (AD-03: sao o mesmo).' })
  usuarioId: string;

  @ApiProperty({ example: 'Maria Oliveira dos Santos' }) nome: string;
  @ApiProperty({ example: 'maria@ufx.edu.br' }) email: string;

  @ApiProperty({ format: 'uuid', description: 'Vinculo criado em monitoria_participantes.' })
  participanteId: string;

  /**
   * `false` = o e-mail da inscricao ja tinha conta e ela foi reaproveitada.
   *
   * Importa para a tela saber se faz sentido avisar "a senha provisoria foi
   * enviada por e-mail": quando a conta ja existia, nenhuma credencial saiu, e
   * dizer o contrario faria o monitor esperar um e-mail que nao vem.
   */
  @ApiProperty({
    example: true,
    description: 'true quando a conta foi criada agora (e a senha provisoria foi enviada).',
  })
  contaCriada: boolean;
}

/**
 * Resultado da aprovacao de uma candidatura.
 *
 * Devolve os dois objetos que passaram a existir — a monitoria e o vinculo de
 * MONITOR — e, em cada um, se ele foi CRIADO ou REAPROVEITADO. Essa distincao e
 * o que torna a operacao segura de repetir: aprovar de novo a mesma candidatura
 * nao duplica nada, e a resposta diz o que de fato mudou.
 */
export class AprovacaoRespostaDto {
  @ApiProperty({ format: 'uuid', description: 'Inscricao aprovada.' })
  inscricaoId: string;

  @ApiProperty({ type: MonitoriaCriadaDto })
  monitoria: MonitoriaCriadaDto;

  @ApiProperty({ type: MonitorHabilitadoDto })
  monitor: MonitorHabilitadoDto;
}
