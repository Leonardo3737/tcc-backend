import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UsuarioAtual } from '../../common/decorators/usuario-atual.decorator';
import { UsuarioAutenticado } from '../../common/types/usuario-autenticado';
import { FiltroRankingDto } from './dto/filtro-ranking.dto';
import { PosicaoRankingDto, ResumoPontuacaoDto } from './dto/ranking-resposta.dto';
import { RegrasDePontuacaoRespostaDto } from './dto/regras-resposta.dto';
import { GamificacaoService } from './gamificacao.service';

@ApiTags('Gamificacao')
@ApiBearerAuth()
@Controller('gamificacao')
export class GamificacaoController {
  constructor(private readonly gamificacaoService: GamificacaoService) {}

  /**
   * Ranking publico entre usuarios autenticados.
   *
   * Expoe apenas nome e total de pontos — nunca e-mail, matricula ou de qual
   * atendimento vieram os pontos de outra pessoa. O extrato detalhado e privado
   * (ver /meus-pontos).
   */
  /**
   * Fica na gamificacao, e nao em /configuracao, de proposito: este modulo e
   * folha e removivel do AppModule sem quebrar o nucleo. Publicar a tabela de
   * pontos pela configuracao criaria uma dependencia que anularia isso.
   */
  @Get('regras')
  @ApiOperation({
    summary: 'Tabela de pontuacao, para a tela explicar de onde vem cada ponto.',
    description:
      '`pontos` vem `null` quando o valor e VARIAVEL, nao quando vale zero: ' +
      'AVALIACAO_RECEBIDA vale a propria nota (1 a 5).',
  })
  @ApiOkResponse({ type: RegrasDePontuacaoRespostaDto })
  regras(): RegrasDePontuacaoRespostaDto {
    return this.gamificacaoService.regras();
  }

  @Get('ranking')
  @ApiOperation({ summary: 'Ranking por pontuacao acumulada, geral ou por monitoria.' })
  @ApiOkResponse({ type: [PosicaoRankingDto] })
  ranking(@Query() filtro: FiltroRankingDto): Promise<PosicaoRankingDto[]> {
    return this.gamificacaoService.ranking(filtro.limite, filtro.monitoriaId);
  }

  /**
   * `limite` recorta apenas `ultimosEventos`.
   *
   * `total` e `porTipo` sao sempre agregados sobre TODOS os eventos do usuario,
   * para bater com o numero que o /ranking mostra para ele.
   */
  @Get('meus-pontos')
  @ApiOperation({
    summary: 'Extrato de pontuacao do proprio usuario.',
    description:
      'total e porTipo somam todos os eventos do usuario (mesmo criterio do /ranking). ' +
      'O parametro limite recorta apenas a lista ultimosEventos.',
  })
  @ApiOkResponse({ type: ResumoPontuacaoDto })
  meusPontos(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query() filtro: FiltroRankingDto,
  ): Promise<ResumoPontuacaoDto> {
    return this.gamificacaoService.meusPontos(usuario, filtro.monitoriaId, filtro.limite);
  }
}
