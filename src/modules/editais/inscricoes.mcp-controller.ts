import { UseFilters, UsePipes } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool, ToolRoles } from '@rekog/mcp-nest';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PerfilUsuario } from '../../common/enums/perfil-usuario.enum';
import { ESCRITA, LEITURA } from '../../common/mcp/anotacoes';
import { ArquivoGeradoMcpDto } from '../../common/mcp/arquivo-gerado.dto';
import { dtoParaJsonSchema } from '../../common/mcp/dto-schema';
import { McpExcecoesFilter } from '../../common/mcp/mcp-excecoes.filter';
import { McpValidationPipe } from '../../common/mcp/mcp-validation.pipe';
import { usuarioMcp } from '../../common/mcp/usuario-mcp';
import { AprovacaoDeInscricaoService } from './aprovacao-de-inscricao.service';
import { AprovacaoRespostaDto } from './dto/aprovacao-resposta.dto';
import {
  FiltroExportacaoInscricoesDto,
  FiltroInscricoesDto,
  FiltroResumoInscricoesDto,
} from './dto/filtro-inscricoes.dto';
import { InscricaoRespostaDto } from './dto/inscricao-resposta.dto';
import { ResumoPorDisciplinaDto } from './dto/resumo-por-disciplina.dto';
import { InscricaoMcpDto, PlanilhaDeInscricoesMcpDto } from './editais.mcp-dto';
import { InscricoesEditalService } from './inscricoes-edital.service';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Ferramentas MCP de candidatura. Todas de PROFESSOR, como no REST.
 *
 * Aqui estao dados pessoais de candidatos que nao tem conta no sistema e nao
 * escolheram participar de nada alem da selecao — por isso nenhuma destas
 * ferramentas existe sem `@ToolRoles`, e por isso o boletim continua sendo
 * obtido por uma operacao propria, e nunca devolvido junto de uma listagem.
 */
@McpController('inscricoes')
@UsePipes(McpValidationPipe)
@UseFilters(McpExcecoesFilter)
export class InscricoesMcpController {
  constructor(
    private readonly inscricoesService: InscricoesEditalService,
    private readonly aprovacaoService: AprovacaoDeInscricaoService,
    private readonly config: ConfigService,
  ) {}

  @Tool({
    name: 'listar_inscricoes',
    description:
      'Lista as candidaturas de um edital, com busca por nome, matricula ou e-mail, recorte por curso, disciplina, ' +
      'turno e professor, e ordenacao por media ou data. Candidato sem media fica sempre no fim. ' +
      'Nao devolve o boletim. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(FiltroInscricoesDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  listar(@Payload() filtro: FiltroInscricoesDto): Promise<RespostaPaginada<InscricaoRespostaDto>> {
    return this.inscricoesService.listar(filtro);
  }

  @Tool({
    name: 'resumo_de_inscricoes_por_disciplina',
    description:
      'Totais das candidaturas agrupados por disciplina: quantos candidatos, quantos sem media, a melhor media ' +
      'e se aquela disciplina ja tem monitoria com monitor registrado. Disciplina sem nenhum candidato nao aparece. ' +
      'Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(FiltroResumoInscricoesDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  resumo(@Payload() filtro: FiltroResumoInscricoesDto): Promise<ResumoPorDisciplinaDto[]> {
    return this.inscricoesService.resumoPorDisciplina(filtro);
  }

  @Tool({
    name: 'detalhar_inscricao',
    description: 'Detalha uma candidatura pelo id, sem o boletim. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(InscricaoMcpDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  detalhar(@Payload() args: InscricaoMcpDto): Promise<InscricaoRespostaDto> {
    return this.inscricoesService.detalhar(args.id);
  }

  /**
   * A planilha e GERADA de verdade — inclusive a recusa acima do teto de linhas,
   * que acontece aqui dentro. O que nao trafega e o binario. Ver
   * `ArquivoGeradoMcpDto`.
   */
  @Tool({
    name: 'exportar_inscricoes',
    description:
      'Gera a planilha .xlsx das candidaturas do edital (e-mail, nome, matricula, curso, disciplina, professor, turno, ' +
      'N1, N2 e media). `editalId` e obrigatorio: planilha que mistura editais poe candidatos de processos diferentes ' +
      'na mesma coluna de media. Nao e paginada; acima do teto a exportacao e RECUSADA, em vez de entregar um arquivo ' +
      'truncado que parece completo. Devolve os dados do arquivo e o caminho para baixa-lo. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(FiltroExportacaoInscricoesDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  async exportar(
    @Payload() filtro: FiltroExportacaoInscricoesDto,
  ): Promise<PlanilhaDeInscricoesMcpDto> {
    const { conteudo, nomeDoArquivo, total } = await this.inscricoesService.exportar(filtro);

    return {
      nomeDoArquivo,
      tipoDeConteudo: TIPO_XLSX,
      tamanhoBytes: conteudo.length,
      caminhoDeDownload: `/${this.prefixo()}/inscricoes/exportar?editalId=${filtro.editalId}`,
      totalDeInscricoes: total,
    };
  }

  @Tool({
    name: 'obter_boletim_da_inscricao',
    description:
      'Localiza o comprovante de desempenho (PDF) anexado pelo candidato e devolve nome, tamanho e o caminho ' +
      'autenticado para baixa-lo. O PDF em si nao trafega pela ferramenta: e binario e pode chegar a 5 MB. ' +
      'Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(InscricaoMcpDto),
    annotations: LEITURA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  async boletim(@Payload() args: InscricaoMcpDto): Promise<ArquivoGeradoMcpDto> {
    const boletim = await this.inscricoesService.conteudoDoBoletim(args.id);

    return {
      nomeDoArquivo: boletim.nomeOriginal,
      tipoDeConteudo: 'application/pdf',
      tamanhoBytes: boletim.tamanhoBytes,
      caminhoDeDownload: `/${this.prefixo()}/inscricoes/${args.id}/boletim`,
    };
  }

  @Tool({
    name: 'aprovar_inscricao',
    description:
      'Aprova a candidatura: registra a monitoria da disciplina (criando, adotando ou reaproveitando a oferta existente), ' +
      'cria a conta do aluno quando o e-mail ainda nao tiver uma — com senha provisoria enviada por e-mail — e habilita ' +
      'o aluno como MONITOR. A monitoria fica sob responsabilidade do professor INDICADO na candidatura, e fica registrado ' +
      'quem aprovou. Somente PROFESSOR.',
    parameters: dtoParaJsonSchema(InscricaoMcpDto),
    annotations: ESCRITA,
  })
  @ToolRoles([PerfilUsuario.PROFESSOR])
  aprovar(@Payload() args: InscricaoMcpDto, @Ctx() ctx: McpContext): Promise<AprovacaoRespostaDto> {
    return this.aprovacaoService.aprovar(args.id, usuarioMcp(ctx));
  }

  private prefixo(): string {
    return this.config.getOrThrow<string>('app.prefixo');
  }
}
