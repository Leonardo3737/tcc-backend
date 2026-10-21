import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/sequelize';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { ContextoParticipacao } from '../monitorias/participacao.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { formatarCargaHoraria } from '../analytics/carga-horaria';
import { abrirDocx, gravarDocx } from './docx/pacote-docx';
import {
  LinhaDeAtividade,
  preencherRotulo,
  preencherTabelaDeAtividades,
  substituirTexto,
  temAncora,
} from './docx/documento-word';

/**
 * Caminho do modelo oficial.
 *
 * Resolvido a partir de `__dirname` para funcionar tanto em `src` (ts-node)
 * quanto em `dist` (producao). O .docx e copiado para o build pelo
 * `assets` do nest-cli.json — sem aquela entrada, `nest build` levaria apenas
 * os .js e a geracao falharia somente em producao, no primeiro download.
 */
const CAMINHO_DO_MODELO = join(__dirname, 'modelo', 'relatorio-monitoria.docx');

/**
 * Linhas em branco que sobram na tabela, depois das atividades preenchidas.
 *
 * Existem porque o relatorio nao e so o que o sistema sabe: observacoes de cada
 * atividade, quantidade de alunos por sessao e as atividades que nao viraram
 * atendimento registrado (reuniao com o orientador, preparo de material) sao do
 * monitor. Entregar a tabela cheia ate a ultima linha obrigaria quem assina a
 * inserir linhas no Word.
 */
const LINHAS_EM_BRANCO = 8;

/**
 * Rotulos do modelo usados como ancora.
 *
 * Centralizados porque sao verificados no BOOT: se a coordenacao enviar um
 * modelo novo com um rotulo diferente, a aplicacao se recusa a subir com a
 * lista do que nao casou — em vez de gerar, meses depois, um relatorio com
 * campos silenciosamente vazios.
 *
 * Os textos incluem o espaco final onde o modelo o tem. Nao e descuido: a
 * ancora e comparada por IGUALDADE com o texto do run, e "CURSO:" nao casaria
 * com "CURSO: ".
 */
export const ANCORAS = {
  titulo: 'RELATÓRIO FINAL DE MONITORIA ACADÊMICA ',
  entrega: 'Entrega: ',
  curso: 'CURSO: ',
  disciplina: 'DISCIPLINA:',
  periodo: 'PERÍODO:',
  turno: 'TURNO:',
  diasHorarios: 'DIAS / HORÁRIOS DAS AULAS: ',
  alunosNaTurma: 'QUANTIDADE DE ALUNOS NA TURMA:',
  professor: 'PROFESSOR-ORIENTADOR(A): ',
  titulacao: 'TITULAÇÃO DO PROFESSOR-ORIENTADOR(A): ',
  monitor: 'MONITOR(A): ',
  matricula: 'MATRÍCULA DO ALUNO-MONITOR(A): ',
  telefone: 'TELEFONE: ',
  email: 'EMAIL: ',
  cabecalhoDaTabela: ' (o aluno deve cumprir 40h de atividades realizadas descritas abaixo)',
  cidade: 'Porto Velho, ',
  nomeNaAssinatura: 'Nome do aluno',
  raNaAssinatura: 'RA',
  nomeDoProfessorNaAssinatura: ' NOME DO PROFESSOR',
  cienteEmAcordo: 'Ciente e de acordo ',
} as const;

interface CabecalhoDoRelatorio {
  disciplina_codigo: string;
  disciplina_nome: string;
  ano: number;
  semestre: number;
  data_inicio: string | null;
  data_fim: string | null;
  professor_nome: string;
  monitor_nome: string;
  monitor_email: string;
  monitor_matricula: string;
  curso_nome: string;
}

interface AtendimentoDoRelatorio {
  inicio: Date;
  assunto: string;
  minutos: number;
  presentes: number;
}

export interface RelatorioGerado {
  conteudo: Buffer;
  nomeDoArquivo: string;
}

/**
 * Geracao do relatorio final de monitoria em .docx.
 *
 * O documento e produzido SOB DEMANDA e nao e guardado em lugar algum. Nao e
 * economia de espaco: o relatorio e uma FOTOGRAFIA dos dados no instante do
 * download, e guardar uma copia criaria a pergunta "esta desatualizada?" a cada
 * atendimento novo. Como o custo e ler um modelo de 50 KB e trocar um XML, nao
 * ha o que otimizar com cache.
 *
 * ---------------------------------------------------------------------------
 * O QUE E PREENCHIDO E O QUE FICA EM BRANCO
 *
 * O critério e um so: preenche-se o que o banco responde OBJETIVAMENTE. Fica em
 * branco, com o espaco preservado para a mao do monitor:
 *
 *  - TURNO, DIAS / HORARIOS DAS AULAS e QUANTIDADE DE ALUNOS NA TURMA — sao
 *    dados da TURMA da disciplina, e turma nao e entidade deste sistema. O
 *    numero de monitorados da monitoria e outra coisa e colocar um no lugar do
 *    outro seria inventar;
 *  - TELEFONE — nao existe em `usuarios`;
 *  - TITULACAO DO PROFESSOR-ORIENTADOR — nao existe em `professores`
 *    (`departamento` e outra informacao);
 *  - ATIVIDADES REALIZADAS (texto), BIBLIOGRAFIA, e as colunas OBSERVACOES e
 *    QUANTIDADE DE ALUNOS de cada atividade — sao relato, nao dado;
 *  - Entrega e "Ciente e de acordo em __/__/__" — datas de atos que ainda nao
 *    aconteceram. O modelo trazia 01/12/2026 e 01/12/2025 escritos a mao de um
 *    semestre anterior, e manter data errada em documento oficial e pior que
 *    deixar o campo vazio.
 */
@Injectable()
export class RelatorioMonitoriaService implements OnModuleInit {
  private readonly logger = new Logger(RelatorioMonitoriaService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly analyticsService: AnalyticsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Confere o modelo no BOOT, nao no primeiro download.
   *
   * O preenchimento ancora nos rotulos visiveis do documento. Um modelo novo
   * com "CURSO :" em vez de "CURSO: " nao causaria erro nenhum — produziria um
   * relatorio com o campo vazio, e ninguem perceberia ate alguem conferir o
   * arquivo. Falhar no boot transforma esse silencio em uma mensagem que diz
   * exatamente quais ancoras nao foram encontradas.
   *
   * E a mesma escolha de `EmailService.onModuleInit`, pelo mesmo motivo: defeito
   * de configuracao tem de aparecer antes de produzir resultado errado.
   */
  async onModuleInit(): Promise<void> {
    const { documentoXml } = await abrirDocx(await this.lerModelo());

    const faltando = Object.entries(ANCORAS)
      .filter(([, ancora]) => !temAncora(documentoXml, ancora))
      .map(([campo, ancora]) => `${campo} (${ancora})`);

    if (faltando.length > 0) {
      throw new Error(
        'O modelo de relatorio nao contem os rotulos esperados, e os campos ' +
          'correspondentes sairiam em branco sem nenhum aviso. Ancoras nao ' +
          `encontradas: ${faltando.join('; ')}.`,
      );
    }

    this.logger.log(`Modelo de relatorio conferido: ${Object.keys(ANCORAS).length} ancoras.`);
  }

  private lerModelo(): Promise<Buffer> {
    return readFile(CAMINHO_DO_MODELO);
  }

  /**
   * Gera o relatorio do MONITOR AUTENTICADO na monitoria da rota.
   *
   * O vinculo vem do `ContextoParticipacao`, resolvido pelo
   * `ParticipacaoGuard` a partir do token — nunca de um id no corpo ou na query.
   * E o que impede pedir o relatorio de outra pessoa trocando um parametro.
   */
  async gerar(contexto: ContextoParticipacao): Promise<RelatorioGerado> {
    const participacao = contexto.participacao;

    if (!participacao) {
      /**
       * Inalcancavel pela rota: o guard exige papel MONITOR, e sem vinculo
       * ativo nao ha papel. Explicito para nao depender de `!` em um valor que
       * o tipo declara como anulavel.
       */
      throw new NotFoundException('Nenhum vinculo ativo seu nesta monitoria.');
    }

    const cabecalho = await this.buscarCabecalho(participacao.id);
    const atendimentos = await this.buscarAtendimentos(participacao.id);
    const cargaHoraria = await this.buscarCargaHoraria(contexto.monitoria.id, participacao.id);

    const { pacote, documentoXml } = await abrirDocx(await this.lerModelo());

    const preenchido = this.preencher(documentoXml, cabecalho, atendimentos, cargaHoraria);

    return {
      conteudo: await gravarDocx(pacote, preenchido),
      nomeDoArquivo: this.nomeDoArquivo(cabecalho),
    };
  }

  /**
   * Cabecalho em UMA consulta.
   *
   * Os sete JOINs sao o preco de nao fazer sete idas ao banco. O ponto de
   * partida e o VINCULO, nao a monitoria: e dele que saem ao mesmo tempo o
   * monitor e a monitoria, sem risco de combinar o aluno de um com a disciplina
   * de outro.
   *
   * `al.curso_id` e o curso do MONITOR, e nao os cursos da disciplina. A
   * diferenca importa desde que disciplina passou a pertencer a varios cursos
   * (N:M): "CURSO:" no relatorio e o curso de quem assina, e so o do aluno
   * responde isso sem ambiguidade.
   */
  private async buscarCabecalho(participanteId: string): Promise<CabecalhoDoRelatorio> {
    const linhas = (await this.sequelize.query(
      `
      SELECT
        d.codigo    AS disciplina_codigo,
        d.nome      AS disciplina_nome,
        m.ano,
        m.semestre,
        m.data_inicio,
        m.data_fim,
        up.nome     AS professor_nome,
        um.nome     AS monitor_nome,
        um.email    AS monitor_email,
        al.matricula AS monitor_matricula,
        c.nome      AS curso_nome
      FROM monitoria_participantes mp
      JOIN monitorias m   ON m.id = mp.monitoria_id
      JOIN disciplinas d  ON d.id = m.disciplina_id
      JOIN professores pr ON pr.usuario_id = m.professor_id
      JOIN usuarios up    ON up.id = pr.usuario_id
      JOIN alunos al      ON al.usuario_id = mp.aluno_id
      JOIN usuarios um    ON um.id = al.usuario_id
      JOIN cursos c       ON c.id = al.curso_id
      WHERE mp.id = :participanteId;
      `,
      { replacements: { participanteId }, type: QueryTypes.SELECT },
    )) as unknown as CabecalhoDoRelatorio[];

    if (linhas.length === 0) {
      throw new NotFoundException('Vinculo de monitor nao encontrado.');
    }

    return linhas[0];
  }

  /**
   * Atendimentos que entram na tabela: os REALIZADOS deste monitor.
   *
   * O mesmo recorte da carga horaria, e isso e obrigatorio: se a tabela
   * listasse atendimentos AGENDADOS, a soma das linhas nao bateria com o total
   * do cabecalho e o documento se contradiria.
   *
   * `presentes` conta as inscricoes PRESENTES — o numero de alunos efetivamente
   * atendidos naquela sessao, que e dado objetivo. A coluna OBSERVACOES fica
   * vazia de proposito: e relato.
   */
  private async buscarAtendimentos(participanteId: string): Promise<AtendimentoDoRelatorio[]> {
    return (await this.sequelize.query(
      `
      SELECT
        a.inicio,
        a.assunto,
        ROUND(EXTRACT(EPOCH FROM (a.fim - a.inicio)) / 60)::int AS minutos,
        (
          SELECT COUNT(*) FROM atendimento_participantes ap
           WHERE ap.atendimento_id = a.id AND ap.status = 'PRESENTE'
        )::int AS presentes
      FROM atendimentos a
      WHERE a.monitor_participante_id = :participanteId
        AND a.status = 'REALIZADO'
      ORDER BY a.inicio ASC;
      `,
      { replacements: { participanteId }, type: QueryTypes.SELECT },
    )) as unknown as AtendimentoDoRelatorio[];
  }

  /**
   * Carga horaria pelo MESMO caminho do endpoint de indicadores.
   *
   * `AnalyticsService.monitores` ja agrega a carga horaria de todos os monitores
   * da monitoria em uma consulta; aqui se escolhe a linha deste vinculo. Repetir
   * a soma com SQL proprio faria o documento e a tela divergirem na primeira
   * mudanca de regra — e divergencia entre um .docx e uma tela ninguem percebe,
   * porque os dois numeros nunca aparecem juntos.
   */
  private async buscarCargaHoraria(monitoriaId: string, participanteId: string): Promise<number> {
    const monitores = await this.analyticsService.monitores(monitoriaId);
    const meu = monitores.find((monitor) => monitor.participanteId === participanteId);

    return meu?.cargaHorariaMinutos ?? 0;
  }

  private preencher(
    xml: string,
    cabecalho: CabecalhoDoRelatorio,
    atendimentos: AtendimentoDoRelatorio[],
    cargaHorariaMinutos: number,
  ): string {
    const fuso = this.config.getOrThrow<string>('agenda.fusoHorario');
    const periodo = `${cabecalho.ano}-${cabecalho.semestre}`;

    const etapas: [string, string][] = [
      [ANCORAS.titulo, periodo],
      /** Prazo institucional: o sistema nao o conhece. Ver a nota da classe. */
      [ANCORAS.entrega, ''],
      [ANCORAS.curso, cabecalho.curso_nome],
      [ANCORAS.disciplina, ` ${cabecalho.disciplina_codigo} — ${cabecalho.disciplina_nome}`],
      /**
       * Espaco antes do valor porque o rotulo do modelo e "PERIODO:" sem espaco
       * final. Vigencia indefinida devolve string vazia, e ai o espaco sozinho
       * seria preenchimento invisivel — `preencherRotulo` com valor vazio nao
       * escreve run nenhum, entao a condicao resolve os dois casos.
       */
      [ANCORAS.periodo, this.vigencia(cabecalho) ? ` ${this.vigencia(cabecalho)}` : ''],
      [ANCORAS.turno, ''],
      [ANCORAS.diasHorarios, ''],
      [ANCORAS.alunosNaTurma, ''],
      [ANCORAS.professor, cabecalho.professor_nome],
      [ANCORAS.titulacao, ''],
      [ANCORAS.monitor, cabecalho.monitor_nome],
      [ANCORAS.matricula, cabecalho.monitor_matricula],
      [ANCORAS.telefone, ''],
      [ANCORAS.email, cabecalho.monitor_email],
      /**
       * A carga horaria acumulada entra no cabecalho da tabela, e nao como uma
       * linha de TOTAL. Uma linha de total ficaria desatualizada no instante em
       * que o monitor acrescentasse uma atividade a mao — e o relatorio existe
       * para ser completado a mao. Aqui o numero fica rotulado como o que ele e:
       * o que o sistema registrou.
       */
      [
        ANCORAS.cabecalhoDaTabela,
        cargaHorariaMinutos > 0
          ? ` — registrado no sistema: ${formatarCargaHoraria(cargaHorariaMinutos)} em ` +
            `${atendimentos.length} atendimento(s) realizado(s).`
          : '',
      ],
      [ANCORAS.cidade, this.dataLonga(new Date(), fuso)],
      [ANCORAS.cienteEmAcordo, 'em ____ / ____ / ______ :'],
    ];

    let resultado = etapas.reduce(
      (xmlAtual, [ancora, valor]) => preencherRotulo(xmlAtual, ancora, valor),
      xml,
    );

    /**
     * Estes tres sao SUBSTITUICAO, nao acrescimo: no modelo sao exemplos sob a
     * linha de assinatura ("Nome do aluno", "RA", "NOME DO PROFESSOR"), nao
     * rotulos a completar. Acrescentar produziria "Nome do alunoAna Martins".
     */
    resultado = substituirTexto(resultado, ANCORAS.nomeNaAssinatura, cabecalho.monitor_nome);
    resultado = substituirTexto(resultado, ANCORAS.raNaAssinatura, cabecalho.monitor_matricula);
    resultado = substituirTexto(
      resultado,
      ANCORAS.nomeDoProfessorNaAssinatura,
      ` ${cabecalho.professor_nome}`,
    );

    return preencherTabelaDeAtividades(
      resultado,
      atendimentos.map((atendimento) => this.linhaDaAtividade(atendimento, fuso)),
      LINHAS_EM_BRANCO,
    );
  }

  /**
   * "PERIODO:" e o periodo de REALIZACAO da monitoria.
   *
   * Vem de `data_inicio`/`data_fim`, que sao opcionais — monitoria PLANEJADA
   * costuma nascer sem vigencia definida. Faltando qualquer uma das duas, o
   * campo fica em branco: "a partir de 01/08/2026" seria uma afirmacao que o
   * banco nao sustenta.
   *
   * As colunas sao DATEONLY e chegam do driver como 'AAAA-MM-DD'. A formatacao
   * e feita por recorte de string, SEM passar por `Date`, e isso e deliberado:
   * `new Date('2026-08-01')` e meia-noite UTC, e formatar no fuso da
   * instituicao (UTC-4) devolveria 31/07. Data de calendario nao tem fuso, e o
   * jeito de nao errar o dia e nunca converte-la em instante.
   */
  private vigencia(cabecalho: CabecalhoDoRelatorio): string {
    if (!cabecalho.data_inicio || !cabecalho.data_fim) {
      return '';
    }

    return `${this.dataDoCalendario(cabecalho.data_inicio)} a ${this.dataDoCalendario(
      cabecalho.data_fim,
    )}`;
  }

  /** 'AAAA-MM-DD' -> 'DD/MM/AAAA', sem passar por fuso nenhum. */
  private dataDoCalendario(iso: string): string {
    const [ano, mes, dia] = iso.slice(0, 10).split('-');
    return `${dia}/${mes}/${ano}`;
  }

  /**
   * Data e dia da semana no fuso da INSTITUICAO, nunca no do servidor.
   *
   * Mesma disciplina de `notificacoes/mensagens.ts`: o relatorio e assinado por
   * pessoas que leem o horario local, e um servidor em UTC faria um atendimento
   * das 21h de terca aparecer como quarta.
   */
  private linhaDaAtividade(atendimento: AtendimentoDoRelatorio, fuso: string): LinhaDeAtividade {
    const data = new Date(atendimento.inicio);

    const dia = new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(data);

    /**
     * "-feira" sai fora para a coluna ficar igual ao modelo, que traz
     * "09/05/2023 - Terca" e "13/05/2023 - Sabado". O `Intl` devolve
     * "terca-feira"; manter o sufixo faria a coluna DATA estourar a largura em
     * uma tabela de cinco colunas.
     */
    const semana = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long' })
      .format(data)
      .replace(/-feira$/, '');

    return {
      data: `${dia} - ${semana.charAt(0).toUpperCase()}${semana.slice(1)}`,
      atividade: atendimento.assunto,
      cargaHoraria: formatarCargaHoraria(Number(atendimento.minutos)),
      /** Relato: so o monitor escreve. */
      observacoes: '',
      quantidadeDeAlunos: String(atendimento.presentes),
    };
  }

  private dataLonga(data: Date, fuso: string): string {
    const texto = new Intl.DateTimeFormat('pt-BR', {
      timeZone: fuso,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(data);

    return `${texto}.`;
  }

  /**
   * Nome do arquivo baixado.
   *
   * Sem acento, sem espaco e sem barra: o nome vai no cabecalho
   * `Content-Disposition`, e caractere fora do ASCII imprimivel ali tem
   * comportamento diferente em cada navegador. O codigo da disciplina e o
   * periodo bastam para a pessoa distinguir dois relatorios na pasta de
   * downloads.
   */
  private nomeDoArquivo(cabecalho: CabecalhoDoRelatorio): string {
    const disciplina = cabecalho.disciplina_codigo.replace(/[^A-Za-z0-9]/g, '');
    const monitor = cabecalho.monitor_matricula.replace(/[^A-Za-z0-9]/g, '');

    return `relatorio-monitoria-${disciplina}-${cabecalho.ano}-${cabecalho.semestre}-${monitor}.docx`;
  }
}
