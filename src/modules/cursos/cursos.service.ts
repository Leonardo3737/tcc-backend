import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { AtualizarCursoDto } from './dto/atualizar-curso.dto';
import { CriarCursoDto } from './dto/criar-curso.dto';
import { CursoRespostaDto } from './dto/curso-resposta.dto';
import { FiltroCursosDto } from './dto/filtro-cursos.dto';
import { Curso } from './entities/curso.model';
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
export class CursosService {
  constructor(@InjectModel(Curso) private readonly cursoModel: typeof Curso) {}

  /**
   * O codigo e gerado aqui, nunca recebido.
   *
   * Ler o maior numero e inserir nao sao atomicos, e nao ha como torna-los sem
   * serializar a criacao de cursos. A escolha e a mesma do resto do
   * projeto: o banco e a ultima linha de defesa. A constraint UNIQUE recusa o
   * codigo repetido, e aqui se tenta de novo — na segunda volta a consulta ja
   * enxerga a linha que ganhou a corrida.
   */
  async criar(dto: CriarCursoDto): Promise<CursoRespostaDto> {
    const prefixo = prefixoDoNome(dto.nome);

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_DE_CODIGO; tentativa += 1) {
      const existentes = await this.cursoModel.findAll({
        attributes: ['codigo'],
        where: { codigo: { [Op.iLike]: `${prefixo}%` } },
        raw: true,
      });

      const codigo = proximoCodigo(
        prefixo,
        existentes.map((linha) => linha.codigo),
      );

      try {
        const curso = await this.cursoModel.create({ codigo, nome: dto.nome });
        return CursoRespostaDto.deModelo(curso);
      } catch (erro) {
        // So a colisao de codigo justifica nova tentativa. Qualquer outro erro
        // sobe — engoli-lo aqui transformaria falha de banco em laco inutil.
        if (!(erro instanceof UniqueConstraintError)) {
          throw erro;
        }
      }
    }

    throw new ConflictException(
      'Nao foi possivel gerar um codigo livre para o curso. Tente novamente.',
    );
  }

  async listar(filtro: FiltroCursosDto): Promise<RespostaPaginada<CursoRespostaDto>> {
    const where: Record<string, unknown> = {};

    if (filtro.ativo !== undefined) {
      where.ativo = filtro.ativo;
    }

    if (filtro.busca) {
      where[Op.or as unknown as string] = [
        { codigo: { [Op.iLike]: `%${filtro.busca}%` } },
        { nome: { [Op.iLike]: `%${filtro.busca}%` } },
      ];
    }

    const { rows, count } = await this.cursoModel.findAndCountAll({
      where,
      order: [['nome', 'ASC']],
      limit: filtro.limite,
      offset: filtro.offset,
    });

    return new RespostaPaginada(
      rows.map(CursoRespostaDto.deModelo),
      count,
      filtro.pagina,
      filtro.limite,
    );
  }

  async buscarOuFalhar(id: string): Promise<Curso> {
    const curso = await this.cursoModel.findByPk(id);

    if (!curso) {
      throw new NotFoundException('Curso nao encontrado.');
    }

    return curso;
  }

  /**
   * Garante que o curso existe e esta ATIVO.
   *
   * Usado por quem cria vinculo novo (disciplina, aluno). Curso desativado
   * continua valendo para o que ja existe — a RN10 nao apaga nada —, mas nao
   * deve receber cadastros novos.
   */
  async exigirAtivo(id: string): Promise<Curso> {
    const curso = await this.buscarOuFalhar(id);

    if (!curso.ativo) {
      throw new ConflictException(
        `O curso "${curso.nome}" esta inativo e nao aceita vinculos novos.`,
      );
    }

    return curso;
  }

  async detalhar(id: string): Promise<CursoRespostaDto> {
    return CursoRespostaDto.deModelo(await this.buscarOuFalhar(id));
  }

  async atualizar(id: string, dto: AtualizarCursoDto): Promise<CursoRespostaDto> {
    const curso = await this.buscarOuFalhar(id);

    // Desativar nao apaga: monitorias passadas continuam apontando para ela (RN10).
    await curso.update({
      ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
      ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
    });

    return CursoRespostaDto.deModelo(curso);
  }
}
