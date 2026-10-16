import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, UniqueConstraintError } from 'sequelize';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { AtualizarDisciplinaDto } from './dto/atualizar-disciplina.dto';
import { CriarDisciplinaDto } from './dto/criar-disciplina.dto';
import { DisciplinaRespostaDto } from './dto/disciplina-resposta.dto';
import { FiltroDisciplinasDto } from './dto/filtro-disciplinas.dto';
import { Disciplina } from './entities/disciplina.model';
import { DisciplinaCurso } from './entities/disciplina-curso.model';
import { Curso } from '../cursos/entities/curso.model';
import { CursosService } from '../cursos/cursos.service';
import { prefixoDoNome, proximoCodigo } from '../../common/gerador-de-codigo';

/**
 * Tentativas de gerar um codigo livre.
 *
 * Mais de uma so e necessaria quando duas criacoes com o mesmo prefixo correm
 * ao mesmo tempo e calculam o mesmo numero. Nesse caso uma delas perde para a
 * constraint UNIQUE e recalcula — ja enxergando a linha da outra. Tres e
 * folgado para um catalogo que cresce algumas unidades por semestre.
 */
const MAX_TENTATIVAS_DE_CODIGO = 3;

@Injectable()
export class DisciplinasService {
  constructor(
    @InjectModel(Disciplina) private readonly disciplinaModel: typeof Disciplina,
    @InjectModel(DisciplinaCurso)
    private readonly disciplinaCursoModel: typeof DisciplinaCurso,
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly cursosService: CursosService,
  ) {}

  /**
   * O codigo e gerado aqui, nunca recebido.
   *
   * Ler o maior numero e inserir nao sao atomicos, e nao ha como torna-los sem
   * serializar a criacao de disciplinas. A escolha e a mesma do resto do
   * projeto: o banco e a ultima linha de defesa. A constraint UNIQUE recusa o
   * codigo repetido, e aqui se tenta de novo — na segunda volta a consulta ja
   * enxerga a linha que ganhou a corrida.
   */
  async criar(dto: CriarDisciplinaDto): Promise<DisciplinaRespostaDto> {
    /**
     * Os cursos sao validados antes de qualquer tentativa de insercao.
     *
     * Sem isto, um id inexistente so apareceria como violacao de FK traduzida
     * genericamente, e um curso INATIVO passaria — criando disciplina nova em
     * um curso que a instituicao ja tirou de circulacao.
     */
    const cursosIds = [...new Set(dto.cursosIds)];

    for (const cursoId of cursosIds) {
      await this.cursosService.exigirAtivo(cursoId);
    }

    const prefixo = prefixoDoNome(dto.nome);

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_DE_CODIGO; tentativa += 1) {
      const existentes = await this.disciplinaModel.findAll({
        attributes: ['codigo'],
        where: { codigo: { [Op.iLike]: `${prefixo}%` } },
        raw: true,
      });

      const codigo = proximoCodigo(
        prefixo,
        existentes.map((linha) => linha.codigo),
      );

      try {
        const disciplina = await this.sequelize.transaction(async (transaction) => {
          const criada = await this.disciplinaModel.create(
            { codigo, nome: dto.nome },
            { transaction },
          );

          await this.disciplinaCursoModel.bulkCreate(
            cursosIds.map((cursoId) => ({ disciplinaId: criada.id, cursoId })),
            { transaction },
          );

          return criada;
        });

        /**
         * Recarrega com os cursos: a instancia recem-criada nao traz a
         * associacao, e sem ela a resposta sairia com `cursos: []` logo apos o
         * cadastro.
         */
        await disciplina.reload({ include: [Curso] });

        return DisciplinaRespostaDto.deModelo(disciplina);
      } catch (erro) {
        // So a colisao de codigo justifica nova tentativa. Qualquer outro erro
        // sobe — engoli-lo aqui transformaria falha de banco em laco inutil.
        if (!(erro instanceof UniqueConstraintError)) {
          throw erro;
        }
      }
    }

    throw new ConflictException(
      'Nao foi possivel gerar um codigo livre para a disciplina. Tente novamente.',
    );
  }

  /**
   * Troca o conjunto de cursos da disciplina.
   *
   * Em uma transacao: valida os novos, apaga as associacoes que sairam e insere
   * as que entraram. Remover um curso com participante dele na disciplina e
   * recusado pelo banco — a FK composta de `monitoria_participantes` aponta
   * para esta associacao, e apagar a linha deixaria vinculos sem respaldo da
   * regra. O erro sobe traduzido pelo filtro global.
   */
  private async substituirCursos(disciplinaId: string, cursosIds: string[]): Promise<void> {
    const desejados = [...new Set(cursosIds)];

    for (const cursoId of desejados) {
      await this.cursosService.exigirAtivo(cursoId);
    }

    await this.sequelize.transaction(async (transaction) => {
      const atuais = await this.disciplinaCursoModel.findAll({
        where: { disciplinaId },
        transaction,
      });

      const atuaisIds = atuais.map((linha) => linha.cursoId);
      const remover = atuaisIds.filter((id) => !desejados.includes(id));
      const inserir = desejados.filter((id) => !atuaisIds.includes(id));

      if (remover.length > 0) {
        await this.disciplinaCursoModel.destroy({
          where: { disciplinaId, cursoId: { [Op.in]: remover } },
          transaction,
        });
      }

      if (inserir.length > 0) {
        await this.disciplinaCursoModel.bulkCreate(
          inserir.map((cursoId) => ({ disciplinaId, cursoId })),
          { transaction },
        );
      }
    });
  }

  async listar(filtro: FiltroDisciplinasDto): Promise<RespostaPaginada<DisciplinaRespostaDto>> {
    const where: Record<string, unknown> = {};

    if (filtro.ativa !== undefined) {
      where.ativa = filtro.ativa;
    }

    if (filtro.busca) {
      where[Op.or as unknown as string] = [
        { codigo: { [Op.iLike]: `%${filtro.busca}%` } },
        { nome: { [Op.iLike]: `%${filtro.busca}%` } },
      ];
    }

    if (filtro.cursoId) {
      /**
       * Subconsulta, e NAO `where` dentro do include.
       *
       * Filtrar pelo include transformaria o join em INNER e, de quebra, faria
       * cada disciplina voltar apenas com o curso filtrado — a resposta
       * afirmaria que Banco de Dados so pertence a Sistemas de Informacao,
       * escondendo Engenharia da Computacao. A subconsulta restringe QUAIS
       * disciplinas aparecem sem mexer no que cada uma traz.
       */
      where.id = {
        [Op.in]: this.sequelize.literal(
          '(SELECT disciplina_id FROM disciplina_cursos WHERE curso_id = :cursoFiltrado)',
        ),
      };
    }

    const { rows, count } = await this.disciplinaModel.findAndCountAll({
      // Cursos junto: a resposta os expoe, e sem o include viriam vazios.
      include: [Curso],
      distinct: true,
      replacements: { cursoFiltrado: filtro.cursoId ?? null },
      where,
      order: [['nome', 'ASC']],
      limit: filtro.limite,
      offset: filtro.offset,
    });

    return new RespostaPaginada(
      rows.map(DisciplinaRespostaDto.deModelo),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  async buscarOuFalhar(id: string): Promise<Disciplina> {
    const disciplina = await this.disciplinaModel.findByPk(id, { include: [Curso] });

    if (!disciplina) {
      throw new NotFoundException('Disciplina nao encontrada.');
    }

    return disciplina;
  }

  async detalhar(id: string): Promise<DisciplinaRespostaDto> {
    return DisciplinaRespostaDto.deModelo(await this.buscarOuFalhar(id));
  }

  async atualizar(id: string, dto: AtualizarDisciplinaDto): Promise<DisciplinaRespostaDto> {
    const disciplina = await this.buscarOuFalhar(id);

    // Desativar nao apaga: monitorias passadas continuam apontando para ela (RN10).
    await disciplina.update({
      ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
      ...(dto.ativa !== undefined ? { ativa: dto.ativa } : {}),
    });

    if (dto.cursosIds) {
      await this.substituirCursos(disciplina.id, dto.cursosIds);

      /**
       * Recarrega apos trocar a associacao: a instancia em memoria ainda traz
       * os cursos ANTIGOS, e devolve-la faria a resposta contradizer o que
       * acabou de ser gravado.
       */
      await disciplina.reload({ include: [Curso] });
    }

    return DisciplinaRespostaDto.deModelo(disciplina);
  }
}
