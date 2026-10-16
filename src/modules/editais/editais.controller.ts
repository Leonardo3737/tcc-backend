import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ApiRespostaPaginada } from '../../common/decorators/api-resposta-paginada.decorator';
import { Perfis } from '../../common/decorators/perfis.decorator';
import { Publico } from '../../common/decorators/publico.decorator';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { RespostaErro } from '../../common/dto/resposta-erro.dto';
import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { AtualizarEditalDto } from './dto/atualizar-edital.dto';
import { CriarEditalDto } from './dto/criar-edital.dto';
import { EditalPublicoDto, EditalRespostaDto } from './dto/edital-resposta.dto';
import { FiltroEditaisDto } from './dto/filtro-editais.dto';
import { EditaisService } from './editais.service';

/**
 * Editais de selecao de monitores.
 *
 * Tudo aqui e restrito a PROFESSOR, com UMA excecao: `GET /editais/abertos`, a
 * vitrine do formulario publico de inscricao. A assimetria e deliberada —
 * gerenciar processo seletivo e ato administrativo, mas descobrir que existe um
 * processo aberto nao pode exigir conta, ja que o candidato tipico ainda nao
 * tem uma (a conta do monitor e criada pelo professor depois da aprovacao).
 */
@ApiTags('Editais')
@ApiBearerAuth()
@Controller('editais')
export class EditaisController {
  constructor(private readonly editaisService: EditaisService) {}

  @Post()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Cadastra um edital de selecao de monitores. Somente PROFESSOR.',
    description:
      'As datas sao de calendario (AAAA-MM-DD) e o periodo e inclusivo nos dois extremos. ' +
      'Periodo invertido devolve 409 — a mesma regra existe como CHECK no banco.',
  })
  @ApiCreatedResponse({ type: EditalRespostaDto })
  @ApiConflictResponse({ description: 'Periodo de inscricoes invalido.', type: RespostaErro })
  criar(@Body() dto: CriarEditalDto): Promise<EditalRespostaDto> {
    return this.editaisService.criar(dto);
  }

  /**
   * Declarada ANTES de `GET /:id` de proposito.
   *
   * O Nest resolve rotas na ordem de declaracao. Se `:id` viesse primeiro,
   * "abertos" seria lido como id e o ParseUUIDPipe devolveria 400 — uma rota
   * publica inacessivel por um detalhe de ordenacao do arquivo.
   */
  @Publico()
  @Get('abertos')
  @ApiOperation({
    summary: 'Editais aceitando inscricao agora. PUBLICO, sem autenticacao.',
    description:
      'Devolve apenas editais ativos cujo periodo contem a data de hoje no fuso da ' +
      'instituicao. O filtro e do servidor: nao ha parametro para ver edital encerrado ' +
      'ou excluido, porque exibi-lo no formulario produziria um candidato que preenche ' +
      'tudo e e recusado no envio. A representacao e menor que a do professor — sem ' +
      '`ativo` e sem timestamps. Ordenado pelo que fecha primeiro.',
  })
  @ApiRespostaPaginada(EditalPublicoDto)
  listarAbertos(@Query() paginacao: PaginacaoDto): Promise<RespostaPaginada<EditalPublicoDto>> {
    return this.editaisService.listarAbertos(paginacao);
  }

  @Get()
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Lista editais. Somente PROFESSOR.',
    description:
      'Sem o filtro `ativo`, traz ativos E excluidos logicamente — e assim que se encontra ' +
      'um edital desligado por engano para reativar com PATCH.',
  })
  @ApiRespostaPaginada(EditalRespostaDto)
  listar(@Query() filtro: FiltroEditaisDto): Promise<RespostaPaginada<EditalRespostaDto>> {
    return this.editaisService.listar(filtro);
  }

  @Get(':id')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({ summary: 'Detalha um edital. Somente PROFESSOR.' })
  @ApiOkResponse({ type: EditalRespostaDto })
  @ApiNotFoundResponse({ description: 'Edital nao encontrado.', type: RespostaErro })
  detalhar(@Param('id', ParseUUIDPipe) id: string): Promise<EditalRespostaDto> {
    return this.editaisService.detalhar(id);
  }

  @Patch(':id')
  @Perfis(PerfilUsuario.PROFESSOR)
  @ApiOperation({
    summary: 'Edita um edital. Somente PROFESSOR.',
    description:
      'Aceita alterar uma data so: o periodo RESULTANTE e validado contra o que ja esta ' +
      'gravado. `ativo: true` reativa um edital excluido.',
  })
  @ApiOkResponse({ type: EditalRespostaDto })
  @ApiConflictResponse({ description: 'Periodo de inscricoes invalido.', type: RespostaErro })
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarEditalDto,
  ): Promise<EditalRespostaDto> {
    return this.editaisService.atualizar(id, dto);
  }

  /**
   * Exclusao LOGICA. Nenhuma linha e removida.
   *
   * O verbo e DELETE porque e o que o escopo pede e o que um cliente REST
   * espera para "excluir edital", mas o efeito e `ativo = false`: o edital sai
   * da vitrine publica, para de aceitar inscricao e continua existindo para as
   * candidaturas que ja recebeu (RN10). A FK em `inscricoes_edital` e RESTRICT e
   * recusaria a remocao fisica de qualquer forma.
   *
   * Idempotente: chamar duas vezes devolve 204 nas duas.
   */
  @Delete(':id')
  @Perfis(PerfilUsuario.PROFESSOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Exclui um edital (logicamente). Somente PROFESSOR.',
    description:
      'NAO remove a linha: marca `ativo = false`. O edital sai de GET /editais/abertos e ' +
      'passa a recusar inscricao, mas segue existindo para as candidaturas ja recebidas ' +
      '(RN10 — o historico nao e destruido). Reativa-se com PATCH { "ativo": true }.',
  })
  @ApiNoContentResponse({ description: 'Edital excluido logicamente.' })
  @ApiNotFoundResponse({ description: 'Edital nao encontrado.', type: RespostaErro })
  excluir(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.editaisService.excluir(id);
  }
}
