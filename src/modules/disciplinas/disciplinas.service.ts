import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';

import { RespostaPaginada } from '../../common/dto/resposta-paginada.dto';
import { AtualizarDisciplinaDto } from './dto/atualizar-disciplina.dto';
import { CriarDisciplinaDto } from './dto/criar-disciplina.dto';
import { DisciplinaRespostaDto } from './dto/disciplina-resposta.dto';
import { FiltroDisciplinasDto } from './dto/filtro-disciplinas.dto';
import { Disciplina } from './entities/disciplina.model';
import { prefixoDoNome, proximoCodigo } from './gerador-de-codigo';

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
  constructor(@InjectModel(Disciplina) private readonly disciplinaModel: typeof Disciplina) {}

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
        const disciplina = await this.disciplinaModel.create({ codigo, nome: dto.nome });
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

    const { rows, count } = await this.disciplinaModel.findAndCountAll({
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
    const disciplina = await this.disciplinaModel.findByPk(id);

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

    return DisciplinaRespostaDto.deModelo(disciplina);
  }
}
