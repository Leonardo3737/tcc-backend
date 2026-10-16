import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { DirecaoOrdenacao } from '../atendimentos/dto/filtro-atendimentos.dto';
import { AtualizarEditalDto } from './dto/atualizar-edital.dto';
import { CriarEditalDto } from './dto/criar-edital.dto';
import { EditalPublicoDto, EditalRespostaDto, estaNoPeriodo } from './dto/edital-resposta.dto';
import { FiltroEditaisDto } from './dto/filtro-editais.dto';
import { Edital } from './entities/edital.model';

@Injectable()
export class EditaisService {
  constructor(
    @InjectModel(Edital) private readonly editalModel: typeof Edital,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly config: ConfigService,
  ) {}

  /**
   * O dia de hoje no fuso da INSTITUICAO, calculado pelo PostgreSQL.
   *
   * Nao e `new Date()`. O periodo de inscricoes e um intervalo de dias locais, e
   * quem decide se "hoje" esta dentro dele nao pode ser o fuso do processo
   * Node: um servidor em UTC viraria o dia tres horas antes de Porto Velho, e
   * o edital abriria ou fecharia um dia adiantado. E a mesma regra que
   * disponibilidades ja seguem — conversao de fuso e feita no banco.
   *
   * O `::text` e proposital: sem ele o driver devolveria `date` como objeto
   * Date em meia-noite LOCAL do processo, reintroduzindo exatamente o fuso que
   * esta consulta existe para tirar do caminho. Como string 'AAAA-MM-DD', a
   * comparacao com as colunas (tambem strings) e lexicografica e exata.
   */
  async dataDeHoje(): Promise<string> {
    const fuso = this.config.getOrThrow<string>('agenda.fusoHorario');

    const [linha] = await this.sequelize.query<{ hoje: string }>(
      'SELECT (now() AT TIME ZONE :fuso)::date::text AS hoje',
      { type: QueryTypes.SELECT, replacements: { fuso } },
    );

    return linha.hoje;
  }

  async criar(dto: CriarEditalDto): Promise<EditalRespostaDto> {
    /**
     * A ordem das datas e validada aqui para devolver 400 com explicacao, e
     * TAMBEM no banco (`ck_edital_periodo`), que e o que impede um INSERT
     * direto ou um UPDATE parcial de criar um edital que nunca aceita
     * inscricao. Validar nos dois lugares nao e duplicacao: a mensagem util e
     * daqui, a garantia e de la.
     */
    this.exigirPeriodoCoerente(dto.inicioInscricoes, dto.fimInscricoes);

    const edital = await this.editalModel.create({
      inicioInscricoes: dto.inicioInscricoes,
      fimInscricoes: dto.fimInscricoes,
      link: dto.link,
      ano: dto.ano,
      semestre: dto.semestre,
    });

    return EditalRespostaDto.deModelo(edital, await this.dataDeHoje());
  }

  async listar(filtro: FiltroEditaisDto): Promise<RespostaPaginada<EditalRespostaDto>> {
    const where: Record<string, unknown> = {};

    if (filtro.ano !== undefined) {
      where.ano = filtro.ano;
    }

    if (filtro.semestre !== undefined) {
      where.semestre = filtro.semestre;
    }

    if (filtro.ativo !== undefined) {
      where.ativo = filtro.ativo;
    }

    const direcao = filtro.direcao === DirecaoOrdenacao.ASC ? 'ASC' : 'DESC';

    const [{ rows, count }, hoje] = await Promise.all([
      this.editalModel.findAndCountAll({
        where,
        // `id` como desempate: sem ele, dois editais com a mesma data de inicio
        // podem trocar de pagina entre requisicoes e um deles nunca aparecer.
        order: [
          ['inicio_inscricoes', direcao],
          ['id', 'ASC'],
        ],
        limit: filtro.limite,
        offset: filtro.offset,
      }),
      this.dataDeHoje(),
    ]);

    return new RespostaPaginada(
      rows.map((edital) => EditalRespostaDto.deModelo(edital, hoje)),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  /**
   * Consulta PUBLICA: editais em que da para se inscrever AGORA.
   *
   * O filtro e imposto pelo servidor, nao escolhido pelo cliente. Nao ha
   * parametro para ver editais inativos ou fora do periodo — a rota existe para
   * alimentar o formulario publico, e devolver um edital encerrado ali produz
   * um candidato que preenche tudo e recebe 409 no envio.
   *
   * Ordenado por fim de inscricoes ASCENDENTE: o que fecha primeiro e o que a
   * pessoa precisa ver primeiro.
   */
  async listarAbertos(paginacao: PaginacaoDto): Promise<RespostaPaginada<EditalPublicoDto>> {
    const hoje = await this.dataDeHoje();

    const { rows, count } = await this.editalModel.findAndCountAll({
      where: {
        ativo: true,
        inicioInscricoes: { [Op.lte]: hoje },
        fimInscricoes: { [Op.gte]: hoje },
      },
      order: [
        ['fim_inscricoes', 'ASC'],
        ['id', 'ASC'],
      ],
      limit: paginacao.limite,
      offset: paginacao.offset,
    });

    return new RespostaPaginada(
      rows.map(EditalPublicoDto.deModelo),
      count,
      paginacao.pagina,
      paginacao.limite,
    );
  }

  async buscarOuFalhar(id: string): Promise<Edital> {
    const edital = await this.editalModel.findByPk(id);

    if (!edital) {
      throw new NotFoundException('Edital nao encontrado.');
    }

    return edital;
  }

  async detalhar(id: string): Promise<EditalRespostaDto> {
    const edital = await this.buscarOuFalhar(id);

    return EditalRespostaDto.deModelo(edital, await this.dataDeHoje());
  }

  /**
   * Porta de entrada da inscricao publica. Duas recusas, com codigos diferentes
   * de proposito.
   *
   * Edital inexistente e edital EXCLUIDO sao indistinguiveis na resposta (404):
   * para quem nao esta autenticado, confirmar que um id existe mas foi retirado
   * e informacao sobre a operacao interna da instituicao que a rota publica nao
   * tem razao para dar.
   *
   * Fora do periodo e 409 com as datas, porque ai a informacao e util e nao
   * revela nada: o edital esta publicado, e saber quando abre ou que ja fechou
   * e justamente o que o candidato precisa.
   */
  async exigirAbertoParaInscricao(id: string): Promise<Edital> {
    const edital = await this.editalModel.findByPk(id);

    if (!edital || !edital.ativo) {
      throw new NotFoundException('Edital nao encontrado.');
    }

    const hoje = await this.dataDeHoje();

    if (!estaNoPeriodo(edital, hoje)) {
      throw new ConflictException(
        hoje < edital.inicioInscricoes
          ? `As inscricoes deste edital comecam em ${edital.inicioInscricoes}.`
          : `As inscricoes deste edital encerraram em ${edital.fimInscricoes}.`,
      );
    }

    return edital;
  }

  async atualizar(id: string, dto: AtualizarEditalDto): Promise<EditalRespostaDto> {
    const edital = await this.buscarOuFalhar(id);

    /**
     * O par RESULTANTE e validado, nao os campos recebidos.
     *
     * Enviar so `fimInscricoes` pode inverter o periodo contra a data de inicio
     * que ja esta gravada. Ler as duas e comparar o que o registro vai PASSAR a
     * ter e a unica forma de pegar isso antes do banco.
     */
    this.exigirPeriodoCoerente(
      dto.inicioInscricoes ?? edital.inicioInscricoes,
      dto.fimInscricoes ?? edital.fimInscricoes,
    );

    await edital.update({
      ...(dto.inicioInscricoes !== undefined ? { inicioInscricoes: dto.inicioInscricoes } : {}),
      ...(dto.fimInscricoes !== undefined ? { fimInscricoes: dto.fimInscricoes } : {}),
      ...(dto.link !== undefined ? { link: dto.link } : {}),
      ...(dto.ano !== undefined ? { ano: dto.ano } : {}),
      ...(dto.semestre !== undefined ? { semestre: dto.semestre } : {}),
      ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
    });

    return EditalRespostaDto.deModelo(edital, await this.dataDeHoje());
  }

  /**
   * Exclusao LOGICA — `ativo = false`, nunca `DELETE`.
   *
   * Um edital e o contexto das candidaturas que ele recebeu. Apagar a linha
   * deixaria candidatos apontando para um processo que o sistema afirma nunca
   * ter existido; a FK em `inscricoes_edital` e RESTRICT e recusaria o DELETE de
   * qualquer forma (RN10).
   *
   * Idempotente de proposito: excluir duas vezes nao e erro, e devolver 409 na
   * segunda chamada so cria tratamento de caso para o cliente sem proteger
   * nada. A reativacao fica em `PATCH { ativo: true }`.
   */
  async excluir(id: string): Promise<void> {
    const edital = await this.buscarOuFalhar(id);

    if (edital.ativo) {
      await edital.update({ ativo: false });
    }
  }

  private exigirPeriodoCoerente(inicio: string, fim: string): void {
    if (fim < inicio) {
      throw new ConflictException(
        `Periodo invalido: o fim das inscricoes (${fim}) e anterior ao inicio (${inicio}).`,
      );
    }
  }
}
