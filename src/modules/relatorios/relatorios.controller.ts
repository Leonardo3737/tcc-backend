import { Controller, Get, Header, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { ContextoMonitoria } from '../../common/decorators/contexto-monitoria.decorator';
import { ExigeParticipacao } from '../../common/decorators/exige-participacao.decorator';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { PapelMonitoria } from '../../common/enums/papel-monitoria.enum';
import { ParticipacaoGuard } from '../monitorias/guards/participacao.guard';
import { ContextoParticipacao } from '../monitorias/participacao.service';
import { RelatorioMonitoriaService } from './relatorio-monitoria.service';

const TIPO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Relatorio final da monitoria, em .docx.
 *
 * A rota vive sob a MONITORIA pela mesma razao dos materiais e das
 * disponibilidades: quem pode gerar o relatorio e definido pela PARTICIPACAO, e
 * participacao so existe no contexto de uma monitoria. Uma rota
 * `/relatorios/:id` nao teria como responder "este relatorio e seu?".
 */
@ApiTags('Monitorias - Relatorio')
@ApiBearerAuth()
@UseGuards(ParticipacaoGuard)
@Controller('monitorias/:monitoriaId/relatorio')
export class RelatoriosController {
  constructor(private readonly relatorioService: RelatorioMonitoriaService) {}

  /**
   * AUTORIZACAO, e por que ela nao depende de nada que o cliente mande.
   *
   * `papeis: [MONITOR]` exige vinculo ATIVO com papel MONITOR na monitoria da
   * rota. O `ParticipacaoGuard` resolve isso a partir do TOKEN e entrega o
   * vinculo no contexto; o service gera o relatorio desse vinculo. Nao existe
   * parametro de monitor em lugar algum — trocar um id na URL muda a monitoria,
   * e ai o guard recusa, nao a pessoa do relatorio.
   *
   * `professorResponsavel: 'NEGADO'` e a parte menos obvia. O professor
   * administra a monitoria, mas o relatorio final e um documento PESSOAL, que
   * ele assina como orientador no fim — nao um relatorio dele. Pior: com varios
   * monitores na mesma monitoria, "o relatorio" do professor seria ambiguo, e
   * resolver a ambiguidade exigiria um id de monitor na requisicao, que e
   * exatamente o que esta rota evita. Se um dia o professor precisar baixar o
   * relatorio de um monitor, isso e outra rota, com o vinculo no caminho.
   *
   * Mesmo criterio de `DisponibilidadesController`, que tambem NEGA o
   * professor: ele administra a monitoria, mas nao TEM agenda de monitor.
   *
   * ---------------------------------------------------------------------------
   * `Content-Disposition: attachment` com o nome do arquivo.
   *
   * O nome e gerado pelo servidor (codigo da disciplina, periodo, matricula),
   * em ASCII, e e o que o navegador usa ao salvar. O frontend que consome isto
   * precisa ler o `blob` da resposta e esse cabecalho — `fetch` + `JSON.parse`
   * produziria um arquivo corrompido, porque o corpo e binario.
   *
   * `@Res()` desliga a serializacao automatica do Nest: o corpo e um Buffer,
   * nao JSON. Como o handler nao devolve valor, o interceptor de log registra a
   * requisicao sem corpo de resposta — os bytes do documento nao entram na
   * trilha, que seria o pior lugar para eles.
   */
  @Get()
  @ExigeParticipacao({ papeis: [PapelMonitoria.MONITOR], professorResponsavel: 'NEGADO' })
  @Header('Cache-Control', 'no-store')
  @ApiProduces(TIPO_DOCX)
  @ApiOperation({
    summary: 'Gera e baixa o relatorio final da monitoria em .docx. Somente o MONITOR.',
    description:
      'O relatorio e do MONITOR AUTENTICADO na monitoria da rota: o vinculo vem do token, ' +
      'nunca de um identificador enviado pelo cliente. Gerado sob demanda a partir do modelo ' +
      'oficial, com os dados do banco no instante do download — nada e armazenado. ' +
      'Preenche identificacao (curso, disciplina, periodo de realizacao, orientador, monitor, ' +
      'matricula, e-mail), a carga horaria acumulada e uma linha por atendimento REALIZADO. ' +
      'Campos de relato (atividades, bibliografia, observacoes) e dados que o sistema nao ' +
      'possui (turno, horarios da turma, telefone, titulacao) ficam EM BRANCO para ' +
      'preenchimento manual. Disponivel a qualquer momento, inclusive com a monitoria em ' +
      'andamento.',
  })
  @ApiOkResponse({
    description: 'O documento .docx preenchido.',
    content: { [TIPO_DOCX]: { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiForbiddenResponse({
    description: 'Nao e MONITOR com vinculo ativo nesta monitoria.',
    type: RespostaErro,
  })
  async baixar(
    @ContextoMonitoria() contexto: ContextoParticipacao,
    @Res() resposta: Response,
  ): Promise<void> {
    const { conteudo, nomeDoArquivo } = await this.relatorioService.gerar(contexto);

    resposta.setHeader('Content-Type', TIPO_DOCX);
    resposta.setHeader('Content-Length', conteudo.length);
    resposta.setHeader('Content-Disposition', `attachment; filename="${nomeDoArquivo}"`);

    resposta.end(conteudo);
  }
}
