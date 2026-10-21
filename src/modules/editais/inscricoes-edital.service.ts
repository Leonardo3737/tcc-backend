import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { createHash } from 'node:crypto';
import { Op, Order, QueryTypes, col } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { DirecaoOrdenacao } from '../atendimentos/dto/filtro-atendimentos.dto';
import { CursosService } from '../cursos/cursos.service';
import { Curso } from '../cursos/entities/curso.model';
import { DisciplinasService } from '../disciplinas/disciplinas.service';
import { Disciplina } from '../disciplinas/entities/disciplina.model';
import { EmailService } from '../email/email.service';
import { Aluno } from '../usuarios/entities/aluno.model';
import { Professor } from '../usuarios/entities/professor.model';
import { Usuario } from '../usuarios/entities/usuario.model';
import { CriarInscricaoDto } from './dto/criar-inscricao.dto';
import {
  CampoOrdenacaoInscricao,
  FiltroInscricoesDto,
  FiltroResumoInscricoesDto,
} from './dto/filtro-inscricoes.dto';
import { InscricaoConfirmacaoDto, InscricaoRespostaDto } from './dto/inscricao-resposta.dto';
import { ResumoPorDisciplinaDto } from './dto/resumo-por-disciplina.dto';
import { EditaisService } from './editais.service';
import { Boletim } from './entities/boletim.model';
import { Edital } from './entities/edital.model';
import { InscricaoEdital } from './entities/inscricao-edital.model';
import { montarConfirmacao } from './mensagem-de-confirmacao';

/**
 * Teto do PDF do boletim.
 *
 * Nao e configuravel por ambiente de proposito: o mesmo numero esta na CHECK
 * `ck_boletim_tamanho`, e uma variavel de ambiente que divergisse da constraint
 * produziria upload aceito pela aplicacao e recusado pelo banco — erro 500 em
 * cima de um arquivo valido. Mudar o limite e mudar os dois, em migration.
 *
 * Cinco MB e folgado para um boletim: PDFs de historico escolar ficam na casa
 * das centenas de KB, e o que passa disso normalmente e digitalizacao de pagina
 * inteira em alta resolucao.
 */
export const LIMITE_BOLETIM_BYTES = 5 * 1024 * 1024;

/** `%PDF-`. Ver `validarBoletim`. */
const ASSINATURA_PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

const MIME_PDF = 'application/pdf';

/**
 * O arquivo como o multer o entrega.
 *
 * Tipado aqui, e nao com `Express.Multer.File`, porque `@types/multer` nao e
 * dependencia do projeto — o multer vem transitivamente pelo
 * `@nestjs/platform-express`. Declarar os quatro campos que realmente se usa
 * evita acrescentar um pacote de tipos para nada e deixa explicito que o resto
 * (caminho em disco, destino) nao existe: o armazenamento e em memoria, e os
 * bytes vao direto para o banco.
 */
export interface ArquivoRecebido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Traducao do campo publico de ordenacao para a coluna real.
 *
 * O cliente nunca escolhe nome de coluna: escolhe uma chave deste mapa, e
 * qualquer valor fora do enum ja foi recusado pelo ValidationPipe. Mesmo padrao
 * de `COLUNA_DE_ORDENACAO` em AtendimentosService.
 */
const COLUNA_DE_ORDENACAO: Record<CampoOrdenacaoInscricao, string> = {
  [CampoOrdenacaoInscricao.MEDIA]: 'media',
  [CampoOrdenacaoInscricao.N1]: 'n1',
  [CampoOrdenacaoInscricao.N2]: 'n2',
  [CampoOrdenacaoInscricao.NOME]: 'nome_completo',
  [CampoOrdenacaoInscricao.MATRICULA]: 'matricula',
  [CampoOrdenacaoInscricao.CRIADO_EM]: 'created_at',
};

/**
 * Metadado do boletim — SEM a coluna `conteudo`.
 *
 * Esta lista e o que mantem o binario fora de toda resposta de API. Omiti-la
 * faria o Sequelize selecionar tudo, e o PDF de cada candidato viajaria dentro
 * do JSON da listagem.
 */
const METADADO_DO_BOLETIM = ['inscricaoId', 'nomeOriginal', 'tamanhoBytes', 'sha256'];

const INCLUDE_DE_LEITURA = [
  { model: Edital, attributes: ['id', 'ano', 'semestre', 'link', 'fimInscricoes'] },
  { model: Curso, attributes: ['id', 'codigo', 'nome'] },
  { model: Disciplina, attributes: ['id', 'codigo', 'nome'] },
  {
    model: Professor,
    attributes: ['usuarioId'],
    include: [{ model: Usuario, attributes: ['id', 'nome'] }],
  },
];

@Injectable()
export class InscricoesEditalService {
  private readonly logger = new Logger(InscricoesEditalService.name);

  constructor(
    @InjectModel(InscricaoEdital) private readonly inscricaoModel: typeof InscricaoEdital,
    @InjectModel(Boletim) private readonly boletimModel: typeof Boletim,
    /**
     * Models importados direto, sem depender do UsuariosModule: as duas
     * consultas aqui sao de LEITURA e nao envolvem nenhuma regra daquele
     * modulo — e o mesmo criterio que AtendimentosService usa para Avaliacao.
     */
    @InjectModel(Professor) private readonly professorModel: typeof Professor,
    @InjectModel(Aluno) private readonly alunoModel: typeof Aluno,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly editaisService: EditaisService,
    private readonly cursosService: CursosService,
    private readonly disciplinasService: DisciplinasService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Inscricao publica. Nenhuma linha em `alunos` ou `usuarios` e criada aqui.
   *
   * ORDEM DAS ETAPAS, que nao e arbitraria:
   *
   *  1. o ARQUIVO e validado primeiro, antes de qualquer consulta. Ele e a
   *     unica parte da requisicao que ja esta inteira em memoria, e recusar um
   *     upload invalido sem ter tocado no banco e o que impede uma rota publica
   *     de virar gerador de carga;
   *  2. as referencias (edital, curso, disciplina, professor) sao validadas em
   *     seguida, para que o candidato receba "a disciplina nao pertence ao
   *     curso" em vez de uma violacao de FK traduzida genericamente;
   *  3. inscricao e boletim entram na MESMA transacao. Nao existe estado
   *     intermediario visivel: ou ha candidatura com boletim, ou nao ha
   *     candidatura;
   *  4. o e-mail sai DEPOIS do commit, e sua falha nao desfaz nada.
   *
   * SOBRE O E-MAIL (ponto 4). E o inverso da escolha feita na criacao de
   * usuario, onde o envio falhar desfaz a operacao — e a diferenca e que la o
   * e-mail ENTREGA a credencial, sem a qual a conta nasce inutilizavel. Aqui
   * ele apenas CONFIRMA um fato que ja esta gravado: apagar a inscricao porque
   * o provedor esta fora puniria o candidato por um problema nosso, e o prazo
   * do edital pode nem permitir que ele tente de novo. A resposta diz se o
   * envio saiu (`emailConfirmacaoEnviado`) e devolve o identificador, que e o
   * que ele precisa para cobrar a coordenacao.
   *
   * SOBRE RETENTATIVA. Se o candidato enviar duas vezes, a segunda e recusada
   * pelo banco (UNIQUE por edital, em matricula e em e-mail) ANTES de qualquer
   * insercao — nao ha inscricao duplicada nem segundo e-mail. Essa e a
   * protecao, e e por isso que nao ha outbox aqui: a mensagem e uma so por
   * candidatura, enviada em um ponto que so e alcancado uma vez.
   */
  async criar(
    editalId: string,
    dto: CriarInscricaoDto,
    arquivo?: ArquivoRecebido,
  ): Promise<InscricaoConfirmacaoDto> {
    const boletim = this.validarBoletim(arquivo);

    const edital = await this.editaisService.exigirAbertoParaInscricao(editalId);

    await this.exigirCursoEDisciplinaCompativeis(dto.cursoId, dto.disciplinaId);
    await this.exigirProfessor(dto.professorId);

    const inscricao = await this.sequelize.transaction(async (transaction) => {
      const criada = await this.inscricaoModel.create(
        {
          editalId: edital.id,
          nomeCompleto: dto.nomeCompleto,
          matricula: dto.matricula,
          email: dto.email,
          cursoId: dto.cursoId,
          disciplinaId: dto.disciplinaId,
          professorId: dto.professorId,
          turno: dto.turno,
          /**
           * `media` NAO aparece aqui e nao pode aparecer: a coluna e GENERATED
           * ALWAYS no PostgreSQL, que recusa qualquer INSERT que a mencione.
           * O valor e calculado pelo banco a partir destas duas notas.
           */
          n1: dto.n1 ?? null,
          n2: dto.n2 ?? null,
        },
        { transaction },
      );

      await this.boletimModel.create(
        {
          inscricaoId: criada.id,
          conteudo: boletim.conteudo,
          nomeOriginal: boletim.nomeOriginal,
          tamanhoBytes: boletim.conteudo.length,
          sha256: boletim.sha256,
        },
        { transaction },
      );

      return criada;
    });

    return InscricaoConfirmacaoDto.deModelo(
      inscricao,
      await this.enviarConfirmacao(inscricao, edital),
    );
  }

  /**
   * Valida o upload e devolve o que vai para o banco.
   *
   * As tres checagens cobrem coisas diferentes, e nenhuma substitui as outras:
   *
   *  - `mimetype` e o que o CLIENTE declarou. Checar e barato e devolve mensagem
   *    clara no caso honesto (alguem anexou um .docx), mas nao prova nada: e um
   *    cabecalho do proprio upload;
   *  - a ASSINATURA (`%PDF-`) esta no conteudo. E o que de fato impede gravar um
   *    executavel renomeado. A mesma condicao existe como CHECK no banco, para
   *    valer tambem contra INSERT direto;
   *  - o TAMANHO tem teto no multer (que corta o fluxo antes de encher a
   *    memoria, devolvendo 413) e e reconferido aqui, porque o limite do multer
   *    protege o processo e esta confirmacao protege a invariante da tabela.
   *
   * O nome do arquivo e sanitizado antes de gravar — ver `nomeSeguroDeArquivo`.
   */
  private validarBoletim(arquivo?: ArquivoRecebido): {
    conteudo: Buffer;
    nomeOriginal: string;
    sha256: string;
  } {
    if (!arquivo?.buffer?.length) {
      throw new BadRequestException(
        'Envie o boletim de notas em PDF no campo "boletim" (multipart/form-data).',
      );
    }

    if (arquivo.mimetype !== MIME_PDF) {
      throw new BadRequestException('O boletim deve ser um arquivo PDF.');
    }

    if (arquivo.buffer.length > LIMITE_BOLETIM_BYTES) {
      throw new BadRequestException(
        `O boletim excede o limite de ${LIMITE_BOLETIM_BYTES / (1024 * 1024)} MB.`,
      );
    }

    if (!arquivo.buffer.subarray(0, ASSINATURA_PDF.length).equals(ASSINATURA_PDF)) {
      throw new BadRequestException(
        'O arquivo enviado nao e um PDF valido: a assinatura do formato nao foi encontrada.',
      );
    }

    return {
      conteudo: arquivo.buffer,
      nomeOriginal: nomeSeguroDeArquivo(arquivo.originalname),
      sha256: createHash('sha256').update(arquivo.buffer).digest('hex'),
    };
  }

  /**
   * Curso ativo, disciplina ativa e disciplina OFERECIDA pelo curso.
   *
   * A terceira condicao e a regra do escopo ("a disciplina selecionada deve
   * pertencer ao curso informado"). Ela tambem esta no banco, na FK composta
   * `(disciplina_id, curso_id) -> disciplina_cursos` — e la que a garantia mora.
   * Aqui se faz a mesma pergunta antes, so para a resposta dizer o que esta
   * errado em vez de devolver uma violacao de constraint.
   *
   * `buscarOuFalhar` ja traz os cursos da disciplina no include, entao a
   * verificacao de pertinencia nao custa consulta extra.
   */
  private async exigirCursoEDisciplinaCompativeis(
    cursoId: string,
    disciplinaId: string,
  ): Promise<void> {
    const curso = await this.cursosService.exigirAtivo(cursoId);
    const disciplina = await this.disciplinasService.buscarOuFalhar(disciplinaId);

    if (!disciplina.ativa) {
      throw new ConflictException(
        `A disciplina "${disciplina.nome}" esta inativa e nao recebe inscricoes.`,
      );
    }

    const oferecida = (disciplina.cursos ?? []).some((vinculado) => vinculado.id === cursoId);

    if (!oferecida) {
      throw new ConflictException(
        `A disciplina "${disciplina.nome}" nao e oferecida pelo curso "${curso.nome}".`,
      );
    }
  }

  private async exigirProfessor(professorId: string): Promise<void> {
    const professor = await this.professorModel.findByPk(professorId);

    if (!professor) {
      throw new NotFoundException('Professor responsavel nao encontrado.');
    }
  }

  /**
   * Envia a confirmacao e devolve se o provedor aceitou.
   *
   * `EmailService.enviar` nunca lanca (politica documentada na classe), entao
   * nao ha try/catch a fazer aqui — o `false` ja cobre provedor fora, timeout,
   * endereco recusado e e-mail desligado no ambiente. O log registra o caso
   * negativo com o id da inscricao, que e o que permite reenviar depois sem
   * procurar o candidato pelo nome.
   */
  private async enviarConfirmacao(inscricao: InscricaoEdital, edital: Edital): Promise<boolean> {
    const enviou = await this.emailService.enviar(
      montarConfirmacao({
        nomeCompleto: inscricao.nomeCompleto,
        email: inscricao.email,
        inscricaoId: inscricao.id,
        ano: edital.ano,
        semestre: edital.semestre,
        fimInscricoes: edital.fimInscricoes,
        linkDoEdital: edital.link,
        urlDoSistema: this.config.getOrThrow<string>('app.urlFront'),
      }),
    );

    if (!enviou) {
      this.logger.warn(
        `Inscricao ${inscricao.id} GRAVADA, mas a confirmacao por e-mail nao saiu. ` +
          'A inscricao e valida; o candidato tem o identificador na resposta.',
      );
    }

    return enviou;
  }

  /**
   * Listagem administrativa, paginada NO BANCO.
   *
   * Tres consultas por pagina, de proposito:
   *
   *  1. as candidaturas, com edital, curso, disciplina e professor em JOIN;
   *  2. o METADADO dos boletins da pagina (`IN (ids)`), sem a coluna `conteudo`;
   *  3. os alunos cujas matriculas aparecem na pagina.
   *
   * As duas ultimas poderiam virar include, e nao viram. A de boletins fica
   * separada para que a tabela do binario nao apareca na consulta principal —
   * nem por engano de um `attributes` esquecido no futuro. A de alunos e
   * separada porque nao HA associacao: o cruzamento e por matricula, e o
   * resultado e o estado atual do cadastro, nao algo gravado na inscricao.
   *
   * Nenhuma das duas cresce com o total: as duas recebem no maximo `limite`
   * chaves, com teto de 100 imposto pelo PaginacaoDto.
   */
  async listar(filtro: FiltroInscricoesDto): Promise<RespostaPaginada<InscricaoRespostaDto>> {
    const where: Record<string | symbol, unknown> = {};

    if (filtro.editalId) where.editalId = filtro.editalId;
    if (filtro.cursoId) where.cursoId = filtro.cursoId;
    if (filtro.disciplinaId) where.disciplinaId = filtro.disciplinaId;
    if (filtro.turno) where.turno = filtro.turno;
    if (filtro.professorId) where.professorId = filtro.professorId;

    if (filtro.busca) {
      where[Op.or] = [
        { nomeCompleto: { [Op.iLike]: `%${filtro.busca}%` } },
        { matricula: { [Op.iLike]: `%${filtro.busca}%` } },
        { email: { [Op.iLike]: `%${filtro.busca}%` } },
      ];
    }

    /**
     * `ano` e `semestre` sao do EDITAL, nao da inscricao.
     *
     * Vao como `where` no include, o que torna o JOIN obrigatorio — correto
     * aqui: toda inscricao tem edital (FK NOT NULL), entao restringir pelo
     * periodo dele nao esconde nenhuma linha por acidente. E diferente do caso
     * de disciplinas x cursos, onde o include filtrado truncava a LISTA de cada
     * item; `edital` e um para um.
     */
    const filtroDoEdital: Record<string, unknown> = {};
    if (filtro.ano !== undefined) filtroDoEdital.ano = filtro.ano;
    if (filtro.semestre !== undefined) filtroDoEdital.semestre = filtro.semestre;

    const include = INCLUDE_DE_LEITURA.map((item) =>
      item.model === Edital && Object.keys(filtroDoEdital).length > 0
        ? { ...item, where: filtroDoEdital, required: true }
        : item,
    );

    const { rows, count } = await this.inscricaoModel.findAndCountAll({
      where,
      include,
      order: this.montarOrdenacao(filtro),
      limit: filtro.limite,
      offset: filtro.offset,
      /**
       * Todas as associacoes sao para UM registro (belongsTo), entao nao ha
       * linha multiplicada e a paginacao nao precisa de subconsulta. Fixar isso
       * tambem mantem o ORDER BY sobre a tabela principal, onde ele foi escrito.
       */
      subQuery: false,
      distinct: true,
    });

    const [boletins, alunos] = await Promise.all([
      this.metadadosDosBoletins(rows.map((inscricao) => inscricao.id)),
      this.alunosPorMatricula(rows.map((inscricao) => inscricao.matricula)),
    ]);

    return new RespostaPaginada(
      rows.map((inscricao) =>
        InscricaoRespostaDto.deModelo(
          inscricao,
          boletins.get(inscricao.id) ?? null,
          alunos.get(inscricao.matricula.toLowerCase()) ?? null,
        ),
      ),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  /**
   * RESUMO por disciplina: uma linha por disciplina que recebeu candidatura.
   *
   * Existe porque cada disciplina do edital vira UMA monitoria, e a banca
   * trabalha disciplina por disciplina — nao numa lista corrida. Sem isto, o
   * cliente so teria duas saidas, as duas ruins: agrupar no navegador o que
   * cabe em uma pagina, o que parte um grupo ao meio no limite de 100 e exibe
   * um ranking incompleto com aparencia de completo; ou descobrir as
   * disciplinas por tentativa.
   *
   * O CONTRATO com o endpoint plano: este resumo e o cabecalho, e
   * `GET /inscricoes?editalId=...&disciplinaId=...` e o conteudo. Para o
   * cabecalho nao mentir, os dois tem de aceitar os MESMOS filtros — e e por
   * isso que `FiltroResumoInscricoesDto` deriva de `FiltroInscricoesDto` em vez
   * de ser escrito a parte.
   *
   * SQL cru, como em AnalyticsService. Nao e preferencia: `findAndCountAll` com
   * `group` devolve `count` como ARRAY de grupos em vez de numero, e montar
   * agregados por ORM aqui renderia menos legibilidade por mais surpresa.
   *
   * SEM paginacao, deliberadamente. O resultado e limitado pelo catalogo de
   * disciplinas da instituicao — dezenas de linhas minusculas —, nao pelo
   * numero de candidatos. E como nao ha paginacao, reordenar no cliente e
   * correto aqui, diferente da lista de candidatos.
   */
  async resumoPorDisciplina(filtro: FiltroResumoInscricoesDto): Promise<ResumoPorDisciplinaDto[]> {
    const { onde, valores } = this.condicoesDoResumo(filtro);

    /**
     * `JOIN editais` entra SEMPRE, mesmo sem filtro de ano/semestre.
     *
     * A FK e NOT NULL e a relacao e para um, entao o join nao muda nem o
     * conjunto de linhas nem a contagem — e mantem a consulta com uma forma so,
     * em vez de duas variantes que precisariam ser testadas separadamente.
     *
     * `COUNT(i.media)` conta os NAO NULOS: e exatamente "quantos dao para
     * ranquear". `MAX(i.media)` ignora nulos pela mesma razao, entao devolve
     * nulo so quando ninguem tem media — nunca zero.
     */
    const linhas = (await this.sequelize.query(
      `
      SELECT
        d.id                AS disciplina_id,
        d.codigo            AS disciplina_codigo,
        d.nome              AS disciplina_nome,
        COUNT(*)::int       AS total_inscricoes,
        COUNT(i.media)::int AS com_media,
        MAX(i.media)        AS melhor_media,
        /**
         * Os editais do grupo, para a segunda consulta saber onde procurar a
         * monitoria. Agregado simples na lista do SELECT: nao multiplica linha
         * nem altera as contagens acima.
         */
        ARRAY_AGG(DISTINCT i.edital_id) AS editais
      FROM inscricoes_edital i
      JOIN disciplinas d ON d.id = i.disciplina_id
      JOIN editais e     ON e.id = i.edital_id
      ${onde}
      GROUP BY d.id, d.codigo, d.nome
      ORDER BY d.nome ASC;
      `,
      { replacements: valores, type: QueryTypes.SELECT },
    )) as unknown as (Record<string, string | null> & { editais: string[] })[];

    /**
     * Segunda consulta, com as disciplinas e os editais que a primeira trouxe.
     * Nao cresce com o total de candidaturas: recebe uma chave por disciplina.
     */
    const monitorias = await this.monitoriasDoEdital(
      linhas.map((linha) => linha.disciplina_id as string),
      [...new Set(linhas.flatMap((linha) => linha.editais))],
    );

    return linhas.map((linha) =>
      ResumoPorDisciplinaDto.deLinha(linha, monitorias.get(linha.disciplina_id as string) ?? null),
    );
  }

  /**
   * Quais disciplinas do recorte JA tem monitoria vinda do edital, e com
   * quantos monitores.
   *
   * Consulta SEPARADA, nao um join na agregada — e por um motivo concreto, nao
   * estetico: juntar `monitorias` e `monitoria_participantes` na consulta
   * agrupada multiplicaria as linhas de inscricao por monitor e estragaria
   * `COUNT(*)`, que e o total de candidaturas. Seria um erro silencioso: os
   * totais ficariam inflados sem nada falhar.
   *
   * O recorte usa os editais que o proprio resumo encontrou (`array_agg` na
   * consulta agregada), e nao o filtro recebido. Assim a resposta e correta
   * tambem quando o resumo e pedido sem `editalId` — o flag passa a significar
   * "alguma monitoria vinda de um dos editais em questao".
   *
   * `edital_id IS NOT NULL` e o que torna o flag honesto: uma monitoria que o
   * professor abriu a mao no semestre passado nao deve acender a marca de
   * "disciplina ja resolvida por este edital".
   */
  private async monitoriasDoEdital(
    disciplinas: string[],
    editais: string[],
  ): Promise<Map<string, { id: string; monitores: number }>> {
    if (disciplinas.length === 0 || editais.length === 0) {
      return new Map();
    }

    const linhas = (await this.sequelize.query(
      `
      SELECT
        m.disciplina_id,
        m.id AS monitoria_id,
        COUNT(mp.id) FILTER (
          WHERE mp.papel = 'MONITOR' AND mp.status = 'ATIVO'
        )::int AS monitores
      FROM monitorias m
      LEFT JOIN monitoria_participantes mp ON mp.monitoria_id = m.id
      WHERE m.edital_id IS NOT NULL
        AND m.edital_id IN (:editais)
        AND m.disciplina_id IN (:disciplinas)
      GROUP BY m.disciplina_id, m.id
      ORDER BY monitores DESC, m.created_at ASC;
      `,
      { replacements: { editais, disciplinas }, type: QueryTypes.SELECT },
    )) as unknown as { disciplina_id: string; monitoria_id: string; monitores: number }[];

    /**
     * `ORDER BY monitores DESC` + primeira vitoria no Map: havendo mais de uma
     * monitoria da mesma disciplina no recorte (professores diferentes, que
     * `uq_monitoria_oferta` permite), a que JA tem monitor e a que descreve o
     * estado do grupo. Pegar a mais antiga sem olhar os monitores poderia
     * mostrar "pendente" com um monitor ja habilitado em outra.
     */
    const porDisciplina = new Map<string, { id: string; monitores: number }>();

    for (const linha of linhas) {
      if (!porDisciplina.has(linha.disciplina_id)) {
        porDisciplina.set(linha.disciplina_id, {
          id: linha.monitoria_id,
          monitores: Number(linha.monitores),
        });
      }
    }

    return porDisciplina;
  }

  /**
   * Traduz o filtro em fragmentos de SQL e valores separados.
   *
   * A separacao e a parte que importa: os fragmentos sao literais escritos
   * AQUI, no codigo, e nenhum pedaco deles vem da requisicao; o que vem do
   * cliente sao apenas os VALORES, que saem por `replacements` e nunca por
   * interpolacao. Concatenar valor em texto de consulta e o caminho classico
   * para injecao, e e o motivo de esta funcao existir em vez de uma montagem
   * inline.
   *
   * Cada condicao acrescenta a chave correspondente no mesmo `if`. Se as duas
   * metades se separassem, o Sequelize lancaria na hora ("Named parameter has
   * no value") em vez de produzir consulta silenciosamente errada.
   */
  private condicoesDoResumo(filtro: FiltroResumoInscricoesDto): {
    onde: string;
    valores: Record<string, unknown>;
  } {
    const condicoes: string[] = [];
    const valores: Record<string, unknown> = {};

    if (filtro.editalId) {
      condicoes.push('i.edital_id = :editalId');
      valores.editalId = filtro.editalId;
    }

    if (filtro.cursoId) {
      condicoes.push('i.curso_id = :cursoId');
      valores.cursoId = filtro.cursoId;
    }

    /**
     * Filtrar por disciplina em uma consulta AGRUPADA por disciplina nao e
     * contraditorio: devolve um grupo so, que e o cabecalho daquele grupo
     * isolado. Serve a tela que ja esta dentro de uma disciplina.
     */
    if (filtro.disciplinaId) {
      condicoes.push('i.disciplina_id = :disciplinaId');
      valores.disciplinaId = filtro.disciplinaId;
    }

    if (filtro.turno) {
      condicoes.push('i.turno = :turno');
      valores.turno = filtro.turno;
    }

    if (filtro.professorId) {
      condicoes.push('i.professor_id = :professorId');
      valores.professorId = filtro.professorId;
    }

    if (filtro.busca) {
      condicoes.push(
        '(i.nome_completo ILIKE :busca OR i.matricula ILIKE :busca OR i.email ILIKE :busca)',
      );
      valores.busca = `%${filtro.busca}%`;
    }

    // Do EDITAL, nao da inscricao — mesma semantica do endpoint plano.
    if (filtro.ano !== undefined) {
      condicoes.push('e.ano = :ano');
      valores.ano = filtro.ano;
    }

    if (filtro.semestre !== undefined) {
      condicoes.push('e.semestre = :semestre');
      valores.semestre = filtro.semestre;
    }

    return {
      onde: condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '',
      valores,
    };
  }

  async detalhar(id: string): Promise<InscricaoRespostaDto> {
    const inscricao = await this.inscricaoModel.findByPk(id, { include: INCLUDE_DE_LEITURA });

    if (!inscricao) {
      throw new NotFoundException('Inscricao nao encontrada.');
    }

    const [boletins, alunos] = await Promise.all([
      this.metadadosDosBoletins([inscricao.id]),
      this.alunosPorMatricula([inscricao.matricula]),
    ]);

    return InscricaoRespostaDto.deModelo(
      inscricao,
      boletins.get(inscricao.id) ?? null,
      alunos.get(inscricao.matricula.toLowerCase()) ?? null,
    );
  }

  /**
   * A UNICA leitura do projeto que traz os bytes do PDF.
   *
   * Por isso ela e um metodo separado, com nome que diz o que faz: qualquer
   * outra consulta que precise falar de boletim usa `metadadosDosBoletins`. A
   * autorizacao (PROFESSOR) esta no controller, e o cabecalho de download —
   * `Content-Disposition: attachment` com nome sanitizado — tambem, porque e
   * decisao de transporte.
   */
  async conteudoDoBoletim(inscricaoId: string): Promise<Boletim> {
    const boletim = await this.boletimModel.findByPk(inscricaoId);

    if (!boletim) {
      throw new NotFoundException('Boletim nao encontrado para esta inscricao.');
    }

    return boletim;
  }

  private async metadadosDosBoletins(ids: string[]): Promise<Map<string, Boletim>> {
    if (ids.length === 0) {
      return new Map();
    }

    const linhas = await this.boletimModel.findAll({
      attributes: METADADO_DO_BOLETIM,
      where: { inscricaoId: { [Op.in]: ids } },
    });

    return new Map(linhas.map((linha) => [linha.inscricaoId, linha]));
  }

  /**
   * Quais destas matriculas pertencem a alunos JA CADASTRADOS.
   *
   * Responde ao proposito declarado no escopo — o professor usa os dados da
   * inscricao para cadastrar os aprovados e precisa saber de quem nao precisa
   * criar conta. Nada e gravado: o resultado e o estado atual de `alunos`, e um
   * candidato que se cadastrar amanha passa a ser reconhecido sem que nenhuma
   * inscricao antiga seja alterada.
   *
   * A chave do Map e minuscula porque `alunos.matricula` e `varchar`, e nao
   * CITEXT: "2021A" e "2021a" sao matriculas diferentes para o banco, mas o
   * cruzamento aqui e uma conveniencia de leitura, nao uma regra — casar sem
   * depender de caixa evita um falso negativo que confundiria a banca.
   */
  private async alunosPorMatricula(matriculas: string[]): Promise<Map<string, Aluno>> {
    const unicas = [...new Set(matriculas)];

    if (unicas.length === 0) {
      return new Map();
    }

    const linhas = await this.alunoModel.findAll({
      attributes: ['usuarioId', 'matricula', 'cursoId'],
      where: { matricula: { [Op.in]: unicas } },
    });

    return new Map(linhas.map((linha) => [linha.matricula.toLowerCase(), linha]));
  }

  /**
   * ORDER BY seguro, com NULLS LAST sempre.
   *
   * Duas decisoes:
   *
   *  - a coluna vem de `COLUNA_DE_ORDENACAO` e e envolvida em `col()`,
   *    qualificada pelo alias da tabela principal. Qualificar importa: com
   *    JOINs, um `created_at` solto e ambiguo para o PostgreSQL;
   *  - NULLS LAST nas DUAS direcoes, e nao apenas na descendente. Nota ausente
   *    nao e nota baixa: em `media DESC` o NULL iria para o topo (o padrao do
   *    PostgreSQL e NULLS FIRST em DESC) e um candidato sem nota apareceria
   *    como primeiro colocado. Em ASC ele iria para o fim naturalmente, mas
   *    fixar o comportamento nos dois casos evita que a lista afirme coisas
   *    diferentes dependendo da direcao.
   *
   * `id` desempata: sem ele, duas medias iguais podem trocar de lugar entre
   * requisicoes e uma candidatura pular de pagina sem nunca ser vista.
   */
  private montarOrdenacao(filtro: FiltroInscricoesDto): Order {
    const coluna = COLUNA_DE_ORDENACAO[filtro.ordenarPor] ?? COLUNA_DE_ORDENACAO.media;
    const direcao = filtro.direcao === DirecaoOrdenacao.ASC ? 'ASC' : 'DESC';

    return [
      [col(`${InscricaoEdital.name}.${coluna}`), `${direcao} NULLS LAST`],
      [col(`${InscricaoEdital.name}.id`), 'ASC'],
    ];
  }
}

/**
 * Nome de arquivo seguro para gravar e para devolver em `Content-Disposition`.
 *
 * O nome vem do upload, ou seja, do cliente. Tres riscos, nesta ordem:
 *
 *  1. CABECALHO HTTP. Um nome com `"` ou com quebra de linha quebra — ou
 *    injeta — o `Content-Disposition` do download. Por isso tudo que nao e
 *    letra, digito, ponto, hifen, underscore ou espaco e trocado;
 *  2. CAMINHO. `../../etc/passwd` nao tem efeito aqui (nada e escrito em disco),
 *    mas o nome e devolvido ao navegador, que usa o ultimo segmento como
 *    sugestao de salvamento. Fica so o nome base;
 *  3. TAMANHO. A coluna e varchar(255).
 *
 * A extensao `.pdf` e garantida no fim: o conteudo ja foi verificado pela
 * assinatura, e um arquivo salvo sem extensao nao abre com dois cliques.
 */
export function nomeSeguroDeArquivo(nome: string): string {
  const base = (nome ?? '').split(/[\\/]/).pop() ?? '';

  const limpo = base
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._\- ]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);

  const semExtensao = limpo.replace(/\.pdf$/i, '').trim();

  return `${semExtensao.length > 0 ? semExtensao : 'boletim'}.pdf`;
}

/**
 * Valor de `Content-Disposition` para download do boletim.
 *
 * Os dois parametros sao necessarios e cumprem papeis diferentes (RFC 6266):
 *
 *  - `filename` tem de ser ASCII. Um nome como "boletim-João.pdf" dentro das
 *    aspas e invalido, e o comportamento de cada navegador diante disso e
 *    diferente — alguns truncam, outros salvam com mojibake;
 *  - `filename*` carrega o nome real, percent-encoded em UTF-8, e e o que os
 *    navegadores atuais preferem quando esta presente.
 *
 * `nomeSeguroDeArquivo` ja rodou antes (na gravacao) e roda de novo aqui: o
 * nome vai dentro de um cabecalho HTTP, e uma linha gravada por fora da API
 * — script de manutencao, restauracao de backup — nao passou por aquela
 * sanitizacao.
 */
export function cabecalhoDeAnexo(nome: string): string {
  const seguro = nomeSeguroDeArquivo(nome);
  const ascii = seguro.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(seguro)}`;
}
